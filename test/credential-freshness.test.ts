import { describe, expect, it } from 'vitest';
import type { DockerResult } from '../src/server/boxes/containers.js';
import { credentialFreshness } from '../src/server/boxes/credential-freshness.js';

// The probe, as a decision. It needs no daemon and no credential file: every input is injected, and the
// only thing crossing the boundary in the real one is an inode NUMBER — nothing here ever reads, logs
// or asserts on any credential content, because the real probe never obtains any.

const CRED = '/home/someone/.claude/.credentials.json';
const BOX = 'vibeboard-abc123def456-claude-code';

// A docker that answers from a script and records every argv it was handed. The recording is half the
// point: "never consulted" and "asked once" are claims about calls, and only the log can tell them
// apart from a probe that ran and happened to agree.
function fakeDocker(reply: (args: string[]) => DockerResult) {
  const calls: string[][] = [];
  return {
    calls,
    run: async (args: string[]): Promise<DockerResult> => {
      calls.push(args);
      return reply(args);
    },
  };
}

// `docker inspect -f '{{.State.Running}} …'` and `docker exec … stat -c %i`, which is the whole
// conversation. `spec` is not empty, because a real box carries one and a fixture that omits it would
// be a fixture that could not tell a running box from a mangled inspect.
function daemon(opts: { state?: 'running' | 'stopped' | 'absent'; inode?: string; statCode?: number } = {}) {
  const state = opts.state ?? 'running';
  return fakeDocker((args) => {
    if (args[0] === 'inspect') {
      if (state === 'absent') return { code: 1, stdout: '', stderr: 'No such object' };
      return { code: 0, stdout: `${state === 'running'} a1b2c3d4e5f60718\n`, stderr: '' };
    }
    if (args[0] === 'exec') {
      return { code: opts.statCode ?? 0, stdout: `${opts.inode ?? ''}\n`, stderr: '' };
    }
    throw new Error(`unexpected docker call: ${args.join(' ')}`);
  });
}

const probe = (docker: (args: string[]) => Promise<DockerResult>, over: Record<string, unknown> = {}) =>
  credentialFreshness({
    docker,
    box: BOX,
    backend: 'claude-code',
    path: CRED,
    hostInode: () => 5280206,
    ...over,
  });

describe('the box is holding the credential the host has', () => {
  it('is fresh when the inode inside the box is the one on the host', async () => {
    const d = daemon({ inode: '5280206' });
    expect(await probe(d.run)).toEqual({ fresh: true });
  });

  // THE MEASURED FAILURE. Claude Code refreshes its token by atomic replace, which makes a new inode;
  // a file bind-mount stays pinned to the old one, now unlinked. Host 5280206 / box 5303483 are the
  // numbers observed on the machine this was found on, link counts 1 and 0.
  it('is stale when the box is pinned to a replaced file, and says to rebuild the boxes', async () => {
    const d = daemon({ inode: '5303483' });
    const answer = await probe(d.run);
    expect(answer.fresh).toBe(false);
    expect(answer.fresh === false && answer.reason).toContain('Rebuild the agent boxes');
    // And it names the thing that is wrong, not only the button. A sentence that says "press this"
    // without saying why is the reason nobody presses it.
    expect(answer.fresh === false && answer.reason).toContain('replaced');
  });

  // Nothing on either side of this may be the file's contents. The probe compares numbers, and this
  // pins that: the argv asks for `%i` and for nothing else.
  it('asks docker for an inode number and never for the file', async () => {
    const d = daemon({ inode: '5303483' });
    await probe(d.run);
    const exec = d.calls.find((c) => c[0] === 'exec');
    expect(exec).toEqual(['exec', BOX, 'stat', '-c', '%i', CRED]);
    expect(d.calls.flat().join(' ')).not.toContain('cat');
  });
});

// EVERY UNKNOWN ANSWERS FRESH, and each of these is a case where the alternative disables a machine
// that works. The gate's other rules fail closed because a wrong yes runs an agent unconfined; this one
// fails open because a wrong no is an outage with a fabricated cause on it.
describe('what it does when it has observed nothing', () => {
  it('calls an absent box fresh, because ensure() is about to build one against the current file', async () => {
    const d = daemon({ state: 'absent' });
    expect(await probe(d.run)).toEqual({ fresh: true });
    // And it does not go on to exec into a container that is not there.
    expect(d.calls.filter((c) => c[0] === 'exec')).toHaveLength(0);
  });

  it('calls a stopped box fresh, because starting it is not what re-pins the mount — creating it is', async () => {
    const d = daemon({ state: 'stopped' });
    expect(await probe(d.run)).toEqual({ fresh: true });
    expect(d.calls.filter((c) => c[0] === 'exec')).toHaveLength(0);
  });

  // A docker that will not answer is not evidence of staleness. It is evidence of nothing, and the
  // sandbox status has a separate, better message for a daemon that is not there.
  //
  // THE FIXTURE CARRIES A DIFFERING NUMBER ON STDOUT, and that is the whole reason it is written this
  // way. The first version left stdout empty, which is what a failing `docker exec` usually does — and
  // it proved nothing at all: deleting the exit-code guard kept every test green, because the parse
  // guard below caught the empty string instead. Two guards each catching what the other misses is two
  // guards nothing tests. Giving this one an output the parse guard would happily accept separates them.
  it('does not invent staleness when the stat itself fails', async () => {
    const d = daemon({ statCode: 1, inode: '5303483' });
    expect(await probe(d.run)).toEqual({ fresh: true });
  });

  // And the other half of that pair: a stat that SUCCEEDS and says something unparseable.
  it('does not invent staleness when the stat answers something that is not a number', async () => {
    const d = daemon({ statCode: 0, inode: 'no such file' });
    expect(await probe(d.run)).toEqual({ fresh: true });
  });

  // No credential on the host is a different fault with a different fix, and there is no inode for the
  // box's to disagree with.
  it('says nothing about a host that has no credential at all', async () => {
    const d = daemon({ inode: '5303483' });
    expect(await probe(d.run, { hostInode: () => undefined })).toEqual({ fresh: true });
    expect(d.calls).toHaveLength(0);
  });
});

describe('only the backend that mounts the credential is asked about it', () => {
  // S2: the OpenCode box has no Claude credential mounted, so this path is simply not there. Asserted
  // on the CALL LOG rather than on the answer — a probe that ran, found nothing and said "fresh" would
  // give the same answer while spending a docker round trip per second on every project.
  it('never consults docker for an opencode box', async () => {
    const d = daemon({ inode: '5303483' });
    expect(await probe(d.run, { backend: 'opencode' })).toEqual({ fresh: true });
    expect(d.calls).toHaveLength(0);
  });
});
