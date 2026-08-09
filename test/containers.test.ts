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

  it('drops privileges an agent never needs', () => {
    expect(joined).toContain('--security-opt no-new-privileges');
    expect(joined).toContain('--cap-drop ALL');
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

  it('creates a box that is not there', async () => {
    const calls: string[][] = [];
    const mgr = new BoxManager({
      docker: fakeDocker({ inspect: { code: 1, stdout: '', stderr: 'No such object' } }, calls),
      user: '1000:1000',
    });
    await mgr.ensure(opts);
    expect(calls.some((c) => c[0] === 'run')).toBe(true);
  });

  it('ADOPTS a running box rather than recreating it — a server restart must not bin live work', async () => {
    const calls: string[][] = [];
    const mgr = new BoxManager({
      docker: fakeDocker({ inspect: { code: 0, stdout: 'true\n', stderr: '' } }, calls),
      user: '1000:1000',
    });
    await mgr.ensure(opts);
    expect(calls.some((c) => c[0] === 'run')).toBe(false);
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
    expect(calls.some((c) => c[0] === 'run')).toBe(false);
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
