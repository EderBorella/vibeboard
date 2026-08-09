import { describe, expect, it } from 'vitest';
import { BoxManager } from '../src/server/box-manager.js';
import {
  BACKEND_LABEL,
  BOX_LABEL,
  boxMounts,
  boxName,
  createArgs,
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
  WORK_DIR,
} from '../src/server/containers.js';

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
      '-w',
      WORK_DIR,
      'box',
      'claude',
      '-p',
      'hello world',
    ]);
  });
});

describe('the network rules', () => {
  const args = netRuleArgs('vibeboard-abc-claude-code', 'vibeboard-agent:latest');
  const joined = args.join(' ');

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
      docker: fakeDocker({ inspect: { code: 0, stdout: 'true\n', stderr: '' } }, calls),
      user: '1000:1000',
    });
    await mgr.ensure(opts);
    expect(createdBox(calls)).toBe(false);
    expect(calls.some((c) => c[0] === 'start')).toBe(false);
  });

  it('starts a stopped box rather than rebuilding it', async () => {
    const calls: string[][] = [];
    const mgr = new BoxManager({
      docker: fakeDocker({ inspect: { code: 0, stdout: 'false\n', stderr: '' } }, calls),
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
      docker: fakeDocker({ inspect: { code: 0, stdout: 'false\n', stderr: '' } }, calls),
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
