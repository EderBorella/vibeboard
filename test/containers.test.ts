import { describe, expect, it } from 'vitest';
import { CONFIG_DIR, RUNS_DIR } from '../src/core/layout.js';
import { BoxManager } from '../src/server/boxes/box-manager.js';
import {
  BACKEND_LABEL,
  BOX_LABEL,
  boxMounts,
  boxName,
  createArgs,
  DEFAULT_IMAGE,
  type DockerResult,
  type DockerRun,
  execArgs,
  INSTALL_HELPER,
  installArgs,
  isPackageName,
  netRuleArgs,
  PRIVATE_RANGES,
  PROJECT_LABEL,
  parsePublishedPort,
  protectedPaths,
  specDigest,
  WORK_DIR,
} from '../src/server/boxes/containers.js';

const PROJECT = '/data/projects/demo';
const PATHS = { projectRoot: PROJECT, stateDir: '/home/u/.vibeboard/copilot/abc' };

// A docker that records what it was asked and answers from a script. The point is that every assertion
// below is about the ARGV we build — the flags here are the containment, and a wrong one fails silently
// at runtime rather than loudly.
function fakeDocker(script: Record<string, DockerResult | undefined>, calls: string[][] = []): DockerRun {
  return async (args) => {
    calls.push(args);
    const key = args.slice(0, 2).join(' ');
    return script[key] ?? script[args[0] ?? ''] ?? { code: 0, stdout: '', stderr: '' };
  };
}

describe('box identity', () => {
  it('is deterministic, so a box is found again after a restart with nothing written down', () => {
    expect(boxName(PROJECT, 'claude-code')).toBe(boxName(PROJECT, 'claude-code'));
  });

  it('separates the backends, because that is what keeps the credentials apart', () => {
    expect(boxName(PROJECT, 'claude-code')).not.toBe(boxName(PROJECT, 'opencode'));
  });

  it('separates projects', () => {
    expect(boxName(PROJECT, 'opencode')).not.toBe(boxName('/data/projects/other', 'opencode'));
  });
});

describe('mounts — the containment boundary', () => {
  it('mounts the project writable and .vibeboard READ-ONLY on top of it', () => {
    const mounts = boxMounts(PATHS);
    const project = mounts.find((m) => m.target === WORK_DIR);
    const config = mounts.find((m) => m.target === `${WORK_DIR}/.vibeboard`);

    expect(project).toEqual({ source: PROJECT, target: WORK_DIR });
    expect(config).toEqual({
      source: `${PROJECT}/.vibeboard`,
      target: `${WORK_DIR}/.vibeboard`,
      readOnly: true,
    });
  });

  it('mounts the socket DIRECTORY, never the socket file — a file mount pins a deleted inode', () => {
    const mounts = boxMounts({ ...PATHS, socketDir: '/home/u/.vibeboard/run' });
    const socket = mounts.find((m) => m.source === '/home/u/.vibeboard/run');
    expect(socket?.target).toBe('/run/vibeboard');
    expect(mounts.some((m) => m.source.endsWith('.sock'))).toBe(false);
  });

  it('pins the git escalation paths read-only, not just .vibeboard', () => {
    // `.git/hooks` is code the HOST runs on your next commit, and `.git/config` repoints hooks
    // somewhere writable via core.hooksPath. The old AppArmor profile denied both; a box that only
    // covered .vibeboard would have handed them back.
    const mounts = boxMounts({ ...PATHS, readOnly: ['.vibeboard', '.git/hooks', '.git/config'] });
    for (const rel of ['.vibeboard', '.git/hooks', '.git/config']) {
      expect(mounts).toContainEqual({
        source: `${PROJECT}/${rel}`,
        target: `${WORK_DIR}/${rel}`,
        readOnly: true,
      });
    }
  });

  it('keeps the REPORT directory writable inside the read-only one', () => {
    // The regression this pins. The old AppArmor profile denied `.vibeboard` and then each governed path
    // by name, deliberately leaving `runs/` writable — "which the suite pins", said its own comment. One
    // blanket read-only mount took that away, so every run came back `attention`: the work was done and
    // there was nowhere to write the report that says so.
    const mounts = boxMounts({ ...PATHS, readOnly: [CONFIG_DIR], writable: [RUNS_DIR] });
    const reports = mounts.find((m) => m.target === `${WORK_DIR}/${RUNS_DIR}`);
    expect(reports).toEqual({ source: `${PROJECT}/${RUNS_DIR}`, target: `${WORK_DIR}/${RUNS_DIR}` });
    expect(reports?.readOnly).toBeUndefined();

    // And its parent is still read-only, which is the point: one hole, not an open folder.
    expect(mounts.find((m) => m.target === `${WORK_DIR}/${CONFIG_DIR}`)?.readOnly).toBe(true);
  });

  it('mounts the report directory AFTER its read-only parent', () => {
    // Docker orders by destination depth regardless, so this is about the argv reading the way the
    // intent reads — parent first, then the single exception punched into it.
    const mounts = boxMounts({ ...PATHS, readOnly: [CONFIG_DIR], writable: [RUNS_DIR] });
    const parent = mounts.findIndex((m) => m.target === `${WORK_DIR}/${CONFIG_DIR}`);
    const child = mounts.findIndex((m) => m.target === `${WORK_DIR}/${RUNS_DIR}`);
    expect(parent).toBeLessThan(child);
  });

  it('opens NOTHING when no writable path is given', () => {
    // `writable` absent must not mean "the whole folder": that is the shape of the bug this fixes, in
    // reverse. Every mount under .vibeboard stays read-only unless it was asked for by name.
    const mounts = boxMounts({ ...PATHS, readOnly: [CONFIG_DIR] });
    const under = mounts.filter((m) => m.target.startsWith(`${WORK_DIR}/${CONFIG_DIR}`));
    expect(under).toHaveLength(1);
    expect(under[0].readOnly).toBe(true);
  });

  it('never mounts a protected path that does not exist — docker would create it, root-owned', () => {
    const present = new Set([`${PROJECT}/.vibeboard`]);
    const rels = protectedPaths(PROJECT, (p) => present.has(p));
    expect(rels).toEqual(['.vibeboard']);
    expect(rels).not.toContain('.git/hooks');
  });

  it('carries only the credential it was given, so the other backend has none', () => {
    const claude = boxMounts({
      ...PATHS,
      credential: {
        source: '/home/u/.claude/.credentials.json',
        target: '/home/u/.claude/.credentials.json',
      },
    });
    expect(claude.some((m) => m.source.includes('.claude'))).toBe(true);

    const opencode = boxMounts(PATHS);
    expect(opencode.some((m) => m.source.includes('.claude'))).toBe(false);
  });
});

describe('the run argv', () => {
  const args = createArgs({
    name: 'vibeboard-abc-claude-code',
    image: 'vibeboard-agent:latest',
    projectRoot: PROJECT,
    backend: 'claude-code',
    mounts: boxMounts(PATHS),
    env: { VIBEBOARD_PORT: '4610' },
    user: '1000:1000',
    publish: { containerPort: 4096 },
    command: ['sleep', 'infinity'],
  });
  const joined = args.join(' ');

  it('runs as the host user, so the bind mount does not fill with root-owned files', () => {
    expect(joined).toContain('--user 1000:1000');
  });

  it('forbids gaining privileges, so an agent turn has no escalation route', () => {
    expect(joined).toContain('--security-opt no-new-privileges');
  });

  it('does NOT drop every capability — the brokered install needs root to work at all', () => {
    // Deliberate, and measured: with the default set, root in the box can `apt-get install` but
    // still cannot write the read-only mounts, remount them, or touch the firewall. The boundary is
    // held by the capabilities the container never had (SYS_ADMIN, NET_ADMIN), not by the user id.
    expect(joined).not.toContain('--cap-drop');
  });

  it('never grants the box NET_ADMIN — its own rules must be beyond its reach', () => {
    expect(joined).not.toContain('NET_ADMIN');
  });

  it('labels the box so it can be found again without a pid file', () => {
    expect(joined).toContain(`${BOX_LABEL}=1`);
    expect(joined).toContain(`${PROJECT_LABEL}=${PROJECT}`);
    expect(joined).toContain(`${BACKEND_LABEL}=claude-code`);
  });

  it('renders the read-only mount with :ro', () => {
    expect(args).toContain(`${PROJECT}/.vibeboard:${WORK_DIR}/.vibeboard:ro`);
    expect(args).toContain(`${PROJECT}:${WORK_DIR}`);
  });

  it('publishes on loopback only — never on every interface', () => {
    expect(args).toContain('127.0.0.1::4096');
    expect(joined).not.toMatch(/-p 0\.0\.0\.0/);
  });

  it('puts the image before the command, or docker reads the command as flags', () => {
    expect(args.indexOf('vibeboard-agent:latest')).toBeLessThan(args.indexOf('sleep'));
  });
});

describe('exec argv', () => {
  it('runs in the work directory and passes the command through unmangled', () => {
    expect(execArgs('box', 'claude', ['-p', 'hello world'])).toEqual([
      'exec',
      '-i',
      '-w',
      WORK_DIR,
      'box',
      'claude',
      '-p',
      'hello world',
    ]);
  });

  it('KEEPS STDIN OPEN with -i, which is the whole way the prompt reaches the agent', () => {
    // `docker exec` without `-i` discards stdin entirely — no error, no warning. The prompt goes in on
    // stdin deliberately, because it carries the run's credential and a command line is world-readable
    // through /proc/<pid>/cmdline. Without this flag `claude -p` exits 1 with "Input must be provided
    // either through stdin or as a prompt argument", which is what happened on a real project: three
    // attempts burned in six seconds and the card left needing a person.
    //
    // Asserted as a POSITION, not just membership: `-i` after the container name would be an argument
    // to the agent's own command instead of a flag to docker.
    const args = execArgs('box', 'claude', ['-p']);
    expect(args).toContain('-i');
    expect(args.indexOf('-i')).toBeLessThan(args.indexOf('box'));
  });
});

describe('the network rules', () => {
  const args = netRuleArgs('vibeboard-abc-claude-code', 'vibeboard-agent:latest');
  const joined = args.join(' ');
  // THE SCRIPT ALONE, which is the last argument. `joined` carries the `docker run … -c` prefix too, so
  // splitting it on ` && ` puts that prefix inside the first "rule" — an assertion anchored with `^`
  // then fails on correct code, which is how this was found.
  const rules = (args.at(-1) ?? '').split(' && ');

  it('runs in a THROWAWAY container sharing the box’s network, not in the box', () => {
    // If these ran inside the box, the box would need NET_ADMIN — and then its own privileged
    // install step, or a package’s post-install script, could flush them.
    expect(joined).toContain('--network=container:vibeboard-abc-claude-code');
    expect(args).toContain('--rm');
    expect(joined).toContain('--cap-add NET_ADMIN');
  });

  it('rejects every private range, so the agent cannot reach the LAN or the machine’s own services', () => {
    // SPELLED OUT, not looped over PRIVATE_RANGES. Iterating the constant asserts the code against
    // itself: deleting a range deletes the assertion with it, and a planted defect proved exactly
    // that — dropping 192.168/16 failed nothing. These four are the contract.
    expect(joined).toContain('-d 10.0.0.0/8 -j REJECT'); // most home and corporate LANs
    expect(joined).toContain('-d 172.16.0.0/12 -j REJECT'); // docker's own bridges live here
    expect(joined).toContain('-d 192.168.0.0/16 -j REJECT'); // the usual home router range
    expect(joined).toContain('-d 169.254.0.0/16 -j REJECT'); // link-local, and cloud metadata at .169.254
    expect(PRIVATE_RANGES).toHaveLength(4);
  });

  // EVERY RULE IS AN APPEND TO OUTPUT. This one assertion is worth more than the three below it: a
  // review applied four mutants that fully restore the original bug — rejects switched to `-I`, the
  // accept moved to the INPUT chain, and both together — and ALL FOUR passed every assertion this file
  // had, including one named "or the accept is unreachable". The ordering test compared positions in the
  // SCRIPT STRING, which says nothing about position in the CHAIN, and nothing pinned the verb at all.
  it('appends every rule to OUTPUT, so neither the chain nor the order can be swapped', () => {
    expect(rules.length).toBeGreaterThan(1);
    for (const rule of rules) expect(rule).toMatch(/^iptables -A OUTPUT /);
  });

  // THE REPLY PATH, and its absence cost a whole backend: the rejects carry no state match, so they
  // refused the box's ANSWER to a question the host asked on its published port — Docker's bridge
  // gateway is inside 172.16.0.0/12. The OpenCode model list came back empty because of it.
  it('accepts a reply on the published port, so a box can answer what it was asked', () => {
    expect(joined).toContain('--ctstate ESTABLISHED --ctdir REPLY -j ACCEPT');
  });

  // THE THREE WAYS THE FIRST VERSION OF THAT ACCEPT WAS TOO WIDE, each measured by a review:
  //
  //  * no `--ctdir` — it grandfathered any flow opened in the 0.12–0.14s between `docker run -d`
  //    returning and the rules landing, and conntrack then kept it alive for days. An agent-initiated
  //    flow is the ORIGINAL direction, so REPLY is what excludes it.
  //  * no `--sport` — `-p 127.0.0.1::4096` governs the host loopback mapping, NOT the container's own
  //    address, which every bridge peer can reach on any port. An unpublished listener on :8099 became
  //    reachable.
  //  * `RELATED` — matches conntrack helper expectations, so a hostile public server's payload could
  //    have a helper expect a private address and the box would then be allowed to open it.
  it('confines that accept to TCP, to the published port, and to the reply direction only', () => {
    const accept = rules.find((r) => r.includes('ACCEPT')) ?? '';
    expect(accept).toContain('-p tcp');
    expect(accept).toContain('--sport 4096');
    expect(accept).toContain('--ctdir REPLY');
    expect(accept).not.toContain('RELATED');
  });

  it('still refuses a NEW outbound connection to every private range', () => {
    expect(joined).not.toContain('--ctstate NEW');
    // PER RULE, because the script is one string of `&&`-joined rules: a pattern like
    // /ACCEPT.*-d 10\./ lets `.*` run across the separator and matches the accept in one rule against
    // a range in another. It failed on correct code, which is how it was caught.
    const acceptsARange = rules.filter((r) => r.includes('ACCEPT') && /-d \d/.test(r));
    expect(acceptsARange).toEqual([]);
  });

  it('leaves the public internet alone — the agent still has to reach the model', () => {
    expect(joined).not.toMatch(/-A OUTPUT -j (REJECT|DROP)/);
    expect(joined).not.toContain('0.0.0.0/0');
  });
});

describe('the brokered install', () => {
  it('execs the helper as root, passing packages as ARGV rather than a shell string', () => {
    expect(installArgs('box', ['jq', 'python3'])).toEqual([
      'exec',
      '-u',
      '0:0',
      'box',
      INSTALL_HELPER,
      'jq',
      'python3',
    ]);
  });

  it('refuses a package name that is really a command', async () => {
    const calls: string[][] = [];
    const mgr = new BoxManager({ docker: fakeDocker({}, calls), user: '1000:1000' });
    const res = await mgr.install('box', ['jq; rm -rf /']);
    expect(res.code).toBe(2);
    expect(calls).toHaveLength(0); // never reached docker at all
  });

  it('refuses an empty request rather than running a bare apt-get', async () => {
    const mgr = new BoxManager({ docker: fakeDocker({}), user: '1000:1000' });
    expect((await mgr.install('box', [])).code).toBe(2);
  });

  it.each([['jq'], ['python3'], ['libpq-dev'], ['g++'], ['lib32z1']])(
    'accepts the real package name %s',
    (name) => {
      expect(isPackageName(name)).toBe(true);
    },
  );

  it.each([['../evil'], ['jq&&sh'], ['-rf'], ['$(id)'], ['JQ'], ['']])('rejects %s', (name) => {
    expect(isPackageName(name)).toBe(false);
  });
});

describe('published port', () => {
  it('reads the host port docker chose', () => {
    expect(parsePublishedPort('127.0.0.1:32768\n')).toBe(32768);
  });
  it('survives several lines', () => {
    expect(parsePublishedPort('0.0.0.0:41000\n[::]:41000\n')).toBe(41000);
  });
  it('is undefined rather than NaN when nothing is published', () => {
    expect(parsePublishedPort('')).toBeUndefined();
  });
});

describe('ensure', () => {
  const opts = { projectRoot: PROJECT, backend: 'claude-code' as const, paths: PATHS };

  // What a healthy daemon would report for a box created from exactly these options. Computed rather
  // than hardcoded: the digest is the adoption key, and a literal here would stop tracking it.
  const matchingSpec = specDigest({
    image: DEFAULT_IMAGE,
    mounts: boxMounts(PATHS),
    env: {},
    command: undefined,
    publish: undefined,
  });
  const running = { code: 0, stdout: `true ${matchingSpec}\n`, stderr: '' };
  const stopped = { code: 0, stdout: `false ${matchingSpec}\n`, stderr: '' };

  // `docker run` is no longer a synonym for "made the box": the network sidecar is a `docker run`
  // too. Only a run that NAMES a container creates one, and that is what these assertions mean.
  const createdBox = (calls: string[][]): boolean =>
    calls.some((c) => c[0] === 'run' && c.includes('--name'));

  it('creates a box that is not there', async () => {
    const calls: string[][] = [];
    const mgr = new BoxManager({
      docker: fakeDocker({ inspect: { code: 1, stdout: '', stderr: 'No such object' } }, calls),
      user: '1000:1000',
    });
    await mgr.ensure(opts);
    expect(createdBox(calls)).toBe(true);
  });

  it('ADOPTS a running box rather than recreating it — a server restart must not bin live work', async () => {
    const calls: string[][] = [];
    const mgr = new BoxManager({
      docker: fakeDocker({ inspect: running }, calls),
      user: '1000:1000',
    });
    await mgr.ensure(opts);
    expect(createdBox(calls)).toBe(false);
    expect(calls.some((c) => c[0] === 'start')).toBe(false);
  });

  it('starts a stopped box rather than rebuilding it', async () => {
    const calls: string[][] = [];
    const mgr = new BoxManager({
      docker: fakeDocker({ inspect: stopped }, calls),
      user: '1000:1000',
    });
    await mgr.ensure(opts);
    expect(calls.some((c) => c[0] === 'start')).toBe(true);
    expect(createdBox(calls)).toBe(false);
  });

  it('confines the network of a box it just created', async () => {
    const calls: string[][] = [];
    const mgr = new BoxManager({
      docker: fakeDocker({ inspect: { code: 1, stdout: '', stderr: 'No such object' } }, calls),
      user: '1000:1000',
    });
    await mgr.ensure(opts);
    expect(calls.some((c) => c.some((a) => a.startsWith('--network=container:')))).toBe(true);
  });

  it('re-applies them when a stopped box is started — a restart rebuilds the namespace', async () => {
    const calls: string[][] = [];
    const mgr = new BoxManager({
      docker: fakeDocker({ inspect: stopped }, calls),
      user: '1000:1000',
    });
    await mgr.ensure(opts);
    expect(calls.some((c) => c.some((a) => a.startsWith('--network=container:')))).toBe(true);
  });

  it('DESTROYS the box when its network cannot be confined, rather than serving an open one', async () => {
    const calls: string[][] = [];
    const docker: DockerRun = async (args) => {
      calls.push(args);
      if (args[0] === 'inspect') return { code: 1, stdout: '', stderr: 'No such object' };
      if (args.some((a) => a.startsWith('--network=container:')))
        return { code: 1, stdout: '', stderr: 'iptables: Permission denied' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const mgr = new BoxManager({ docker, user: '1000:1000' });
    await expect(mgr.ensure(opts)).rejects.toThrow(/confine the agent box's network/);
    expect(calls.some((c) => c[0] === 'rm' && c.includes('-f'))).toBe(true);
  });

  it('REBUILDS a running box whose spec no longer matches, rather than adopting it', async () => {
    // The two failures this closes, both silent: an OpenCode server box adopted from the
    // `sleep infinity` box an earlier turn created, which therefore published no port and failed
    // permanently; and a box created before the project had a `.git`, which had no `.git/hooks` pin
    // and never gained one — leaving the host-executed hooks directory writable.
    const calls: string[][] = [];
    const mgr = new BoxManager({
      docker: fakeDocker({ inspect: { code: 0, stdout: 'true otherdigest\n', stderr: '' } }, calls),
      user: '1000:1000',
    });
    await mgr.ensure(opts);
    expect(calls.some((c) => c[0] === 'rm' && c.includes('-f'))).toBe(true);
    expect(createdBox(calls)).toBe(true);
  });

  it('rebuilds when the protected set has grown — a .git that did not exist at creation', async () => {
    const calls: string[][] = [];
    const mgr = new BoxManager({
      docker: fakeDocker({ inspect: running }, calls),
      user: '1000:1000',
    });
    // Same box name, but `.git/hooks` is now pinned. The digest must differ, or the pin never lands.
    await mgr.ensure({
      ...opts,
      paths: { ...PATHS, readOnly: ['.vibeboard', '.git/hooks', '.git/config'] },
    });
    expect(createdBox(calls)).toBe(true);
    expect(calls.some((c) => c[0] === 'rm')).toBe(true);
  });

  it('says which digests disagreed, so a rebuild is not a mystery', async () => {
    const notices: string[][] = [];
    const mgr = new BoxManager({
      docker: fakeDocker({ inspect: { code: 0, stdout: 'true otherdigest\n', stderr: '' } }),
      user: '1000:1000',
      onRebuild: (name, was, now) => notices.push([name, was, now]),
    });
    await mgr.ensure(opts);
    expect(notices).toHaveLength(1);
    expect(notices[0][1]).toBe('otherdigest');
    expect(notices[0][2]).toBe(matchingSpec);
  });

  it('treats a box with no spec label as unusable — it predates the check', async () => {
    const calls: string[][] = [];
    const mgr = new BoxManager({
      docker: fakeDocker({ inspect: { code: 0, stdout: 'true <no value>\n', stderr: '' } }, calls),
      user: '1000:1000',
    });
    await mgr.ensure(opts);
    expect(createdBox(calls)).toBe(true);
  });

  it('fails with docker’s own reason rather than a generic one', async () => {
    const mgr = new BoxManager({
      docker: fakeDocker({
        inspect: { code: 1, stdout: '', stderr: 'no such object' },
        run: { code: 125, stdout: '', stderr: 'docker: invalid mount config\nSee docker run --help' },
      }),
      user: '1000:1000',
    });
    await expect(mgr.ensure(opts)).rejects.toThrow(/invalid mount config/);
  });
});

describe('probe', () => {
  it('says so when the daemon is not there', async () => {
    const mgr = new BoxManager({
      docker: fakeDocker({ version: { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' } }),
    });
    expect(await mgr.probe()).toEqual({ ok: false, reason: expect.stringContaining('Cannot connect') });
  });

  it('names the fix when the image has not been built', async () => {
    const mgr = new BoxManager({
      docker: fakeDocker({
        version: { code: 0, stdout: '29.6.0\n', stderr: '' },
        'image inspect': { code: 1, stdout: '', stderr: 'No such image' },
      }),
    });
    const res = await mgr.probe();
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/box:build/);
  });

  it('is ok when both are present', async () => {
    const mgr = new BoxManager({
      docker: fakeDocker({
        version: { code: 0, stdout: '29.6.0\n', stderr: '' },
        'image inspect': { code: 0, stdout: 'sha256:abc\n', stderr: '' },
      }),
    });
    expect(await mgr.probe()).toEqual({ ok: true });
  });
});
