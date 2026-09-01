import { describe, expect, it } from 'vitest';
import { BoxManager } from '../src/server/boxes/box-manager.js';
import { boxMounts, type DockerRun, specDigest, workdirProbeArgs } from '../src/server/boxes/containers.js';

// A RUNNING BOX WHOSE PROJECT DIRECTORY WAS REPLACED UNDER IT — and why the spec digest cannot see it.
//
// The digest is over mount SOURCES, which are paths. Replace the directory at that path and the path is
// unchanged, so a box adopted on name-and-spec looks perfectly healthy while its bind mount still points
// at the deleted inode. Every exec into it then dies before the agent binary runs, and until 2026-09-01
// that was recorded as the card's failure: measured 2026-08-14, `derive-features` burned all three
// attempts in under four seconds and auto-pilot said the README might be too thin to derive from.

const ROOT = '/tmp/vibeboard-probe-project';
const PATHS = { projectRoot: ROOT, stateDir: '/tmp/vibeboard-probe-state' };
const IMAGE = 'vibeboard-agent:test';

// The digest of the box we are pretending is already running, so `ensure` adopts rather than rebuilds on
// the spec and the probe is the only thing left that can reject it. Derived, never hand-written: a
// literal would drift the day a mount is added and the test would silently stop adopting.
const LIVE_SPEC = specDigest({
  image: IMAGE,
  mounts: boxMounts(PATHS),
  env: {},
  publish: undefined,
  command: undefined,
});

// A daemon holding one running box with the right spec. `probeCode` is what `docker exec -w /work` says.
function daemon(probeCode: number): { docker: DockerRun; calls: string[][] } {
  const calls: string[][] = [];
  const docker: DockerRun = async (args) => {
    calls.push(args);
    if (args[0] === 'inspect') return { code: 0, stdout: `true ${LIVE_SPEC}\n`, stderr: '' };
    if (args[0] === 'exec') {
      return probeCode === 0
        ? { code: 0, stdout: '', stderr: '' }
        : {
            code: probeCode,
            stdout: '',
            stderr:
              'OCI runtime exec failed: exec failed: unable to start container process: current ' +
              'working directory is outside of container mount namespace root -- possible container ' +
              'breakout detected: unknown',
          };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { docker, calls };
}

const ensure = (docker: DockerRun, onRebuild?: (name: string) => void) =>
  new BoxManager({
    docker,
    user: '1000:1000',
    ...(onRebuild ? { onRebuild } : {}),
  }).ensure({ projectRoot: ROOT, backend: 'claude-code', paths: PATHS, image: IMAGE });

describe('adopting a box whose working directory is gone', () => {
  it('rebuilds it, rather than handing the loop a container that cannot exec', async () => {
    const { docker, calls } = daemon(126);
    const rebuilt: string[] = [];
    await ensure(docker, (name) => rebuilt.push(name));

    // The probe went in, and it went in with the working directory the agent will use — a probe that
    // omitted `-w /work` would succeed against exactly the box this exists to catch.
    const probe = calls.find((c) => c[0] === 'exec');
    expect(probe).toEqual(workdirProbeArgs(probe?.[3] ?? ''));
    expect(probe).toContain('-w');

    // Removed and remade, and the rebuild was reported rather than done in silence.
    expect(calls.some((c) => c[0] === 'rm' && c[1] === '-f')).toBe(true);
    expect(calls.some((c) => c[0] === 'run')).toBe(true);
    expect(rebuilt).toHaveLength(1);
  });

  // THE OTHER HALF. Without it the assertion above would pass against a manager that rebuilt every box
  // on every dispatch — which is the behaviour `ensure`'s whole "adopt rather than recreate" comment
  // exists to prevent, and would throw away an agent's in-flight session state on every run.
  it('adopts a healthy box untouched, removing nothing', async () => {
    const { docker, calls } = daemon(0);
    const rebuilt: string[] = [];
    await ensure(docker, (name) => rebuilt.push(name));

    expect(calls.some((c) => c[0] === 'exec')).toBe(true); // it was asked
    expect(calls.some((c) => c[0] === 'rm')).toBe(false);
    expect(calls.some((c) => c[0] === 'run')).toBe(false);
    expect(rebuilt).toHaveLength(0);
  });
});
