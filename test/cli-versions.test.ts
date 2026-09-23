import { describe, expect, it } from 'vitest';
import {
  type CliVersions,
  cliDrift,
  describePins,
  HOST_CLI_TTL_MS,
  hostCliCache,
  inspectVersions,
  parseVersion,
  pinFlags,
  readHostCliVersions,
} from '../src/server/boxes/cli-versions.js';

// THE AGENT IMAGE'S CLIs FOLLOW THE HOST'S. The pin in Dockerfile.base was a hand-copied number: it
// was the host's on the day it was written, the host moved to 2.1.280, and every agent run went on
// reporting the model the box's 2.1.221 resolved `opus` to. The pin exists to prevent a skew between
// the host and the box over state they share, and a number nobody remembers to bump guarantees one.

const HOST: CliVersions = { claude: '2.1.280', opencode: '1.17.18' };

describe('reading a version out of what a CLI prints', () => {
  // The strings the two host CLIs actually printed, not ones invented from their documentation.
  it('finds the version in what each host CLI really prints', () => {
    expect(parseVersion('2.1.280 (Claude Code)\n')).toBe('2.1.280');
    expect(parseVersion('1.17.18\n')).toBe('1.17.18');
  });

  it('finds nothing in output that carries no version', () => {
    expect(parseVersion('')).toBeUndefined();
    expect(parseVersion('command not found\n')).toBeUndefined();
  });

  // THE VALUE LANDS IN A SHELL. Dockerfile.base installs `@anthropic-ai/claude-code@${CLAUDE_VERSION}`
  // in a RUN line, which is `sh -c`, so anything but a version reaching it is a command.
  it('never carries anything past the version itself', () => {
    expect(parseVersion('2.1.280; touch /tmp/owned')).toBe('2.1.280');
    expect(parseVersion('2.1.280$(touch /tmp/owned)')).toBe('2.1.280');
  });
});

describe('the flags a build is pinned with', () => {
  it('passes each version as the build arg Dockerfile.base reads, and records it as a label', () => {
    expect(pinFlags(HOST)).toEqual([
      '--build-arg',
      'CLAUDE_VERSION=2.1.280',
      '--label',
      'io.vibeboard.cli.claude-code=2.1.280',
      '--build-arg',
      'OPENCODE_VERSION=1.17.18',
      '--label',
      'io.vibeboard.cli.opencode=1.17.18',
    ]);
  });

  // No flag at all, so the Dockerfile's own ARG default applies — and no label, because the version that
  // default installs is not known here and a label is a claim.
  it('leaves out a CLI the host has no version for', () => {
    expect(pinFlags({ claude: '2.1.280' })).toEqual([
      '--build-arg',
      'CLAUDE_VERSION=2.1.280',
      '--label',
      'io.vibeboard.cli.claude-code=2.1.280',
    ]);
  });

  it('refuses to put anything but a version into a build arg', () => {
    expect(pinFlags({ claude: '2.1.280; touch /tmp/owned' })).toEqual([]);
  });
});

// The shape `docker image inspect` printed for the real images on a docker 29.6.0 daemon, trimmed to
// the keys this reads. An unlabelled image has NO `Labels` key at all — not an empty object, not null.
const inspected = (labels?: Record<string, string>): string =>
  JSON.stringify([
    {
      Id: 'sha256:0f3c',
      RepoTags: ['vibeboard-agent:base'],
      Config: {
        Env: ['PATH=/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin'],
        Entrypoint: ['/opt/vibeboard/entrypoint.sh'],
        Cmd: ['sleep', 'infinity'],
        WorkingDir: '/work',
        ...(labels ? { Labels: labels } : {}),
      },
    },
  ]);

describe('reading the versions back off an image', () => {
  it('reads what the build recorded', () => {
    const labels = { 'io.vibeboard.cli.claude-code': '2.1.280', 'io.vibeboard.cli.opencode': '1.17.18' };
    expect(inspectVersions(inspected(labels))).toEqual(HOST);
  });

  it('reads nothing off an image built before the versions were recorded', () => {
    expect(inspectVersions(inspected())).toEqual({});
  });

  // UNREADABLE IS UNRECORDED. A probe that cannot parse what docker said has not learned the image is
  // current, so it must not say so.
  it('reads nothing out of output it cannot parse, rather than throwing', () => {
    expect(inspectVersions('sha256:fake\n')).toEqual({});
    expect(inspectVersions('[]')).toEqual({});
    expect(inspectVersions('[{"Config":null}]')).toEqual({});
  });

  it('ignores a label that does not hold a version', () => {
    expect(inspectVersions(inspected({ 'io.vibeboard.cli.claude-code': 'latest' }))).toEqual({});
  });
});

describe('whether an image has drifted from the host', () => {
  it('has not when every version the host has is the one the image holds', () => {
    expect(cliDrift(HOST, HOST)).toBeNull();
  });

  it('names the CLI and both versions when one differs', () => {
    expect(cliDrift({ claude: '2.1.221', opencode: '1.17.18' }, HOST)).toBe(
      'has Claude Code 2.1.221 where this machine has 2.1.280',
    );
  });

  it('names both when both differ', () => {
    expect(cliDrift({ claude: '2.1.221', opencode: '1.17.0' }, HOST)).toBe(
      'has Claude Code 2.1.221 where this machine has 2.1.280, and OpenCode 1.17.0 where this machine has 1.17.18',
    );
  });

  // THE FAIL-SAFE READING OF AN UNLABELLED IMAGE: it cannot be shown to match, so it is offered the
  // rebuild. Every image built before this change is in this state, including the one whose drift found
  // the defect, so reading it as current would hide the bug from exactly the machines that have it.
  it('has, when the image predates the labels — it cannot be shown to match', () => {
    expect(cliDrift({}, HOST)).toBe(
      "was built before VibeBoard recorded CLI versions on its images, so it cannot be shown to match this machine's Claude Code 2.1.280 and OpenCode 1.17.18",
    );
  });

  // AND NO NAG WHERE THERE IS NOTHING TO MATCH. A machine with neither CLI installed shares no CLI state
  // with the box, so the pin's reason does not apply — and an unlabelled image there must not be offered
  // a rebuild on every start that could never clear it.
  it('has not, when the host has no version to compare against', () => {
    expect(cliDrift({}, {})).toBeNull();
  });

  // Only what the host has is compared: a box's Claude Code is nobody's business on a machine without
  // one. The OpenCode here was installed from the Dockerfile default and so carries no label, and the
  // host has since gained one — which is a skew, and nothing recorded says otherwise.
  it('compares only the CLIs the host has, and a missing label among them is a drift', () => {
    expect(cliDrift({ claude: '2.1.221' }, { opencode: '1.17.18' })).toBe(
      'has no recorded OpenCode version where this machine has 1.17.18',
    );
  });
});

describe("the host's versions", () => {
  it('reads each CLI the host has, and leaves out one it does not', async () => {
    const asked: string[] = [];
    const versions = await readHostCliVersions(async (bin) => {
      asked.push(bin);
      return bin === 'claude' ? '2.1.280 (Claude Code)\n' : undefined;
    });
    expect(versions).toEqual({ claude: '2.1.280' });
    expect(asked.sort()).toEqual(['claude', 'opencode']);
  });

  it('says so in the build output when it falls back to the Dockerfile default', () => {
    expect(describePins({ claude: '2.1.280' })).toEqual([
      "Pinning the agent CLIs to this machine's: Claude Code 2.1.280.",
      "Could not read this machine's OpenCode version (`opencode --version`), so the image gets the one Dockerfile.base pins.",
    ]);
  });
});

// THE SANDBOX ROUTE IS POLLED, AND READING THE HOST SPAWNS TWO PROCESSES. `opencode --version` took
// 0.37s measured; asked behind the sandbox's own one-second TTL it would be spawning for a third of
// every second something is watching.
describe('the cache in front of the host', () => {
  const counting = () => {
    let reads = 0;
    let clock = 0;
    const cache = hostCliCache({
      ttlMs: 60_000,
      now: () => clock,
      read: async () => {
        reads += 1;
        return { claude: `2.1.${reads}` };
      },
    });
    return {
      cache,
      reads: () => reads,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  };

  it('reads once for a burst, and not again inside the TTL', async () => {
    const c = counting();
    await Promise.all([c.cache.current(), c.cache.current(), c.cache.current()]);
    expect(c.reads()).toBe(1);
    c.advance(59_999);
    await c.cache.current();
    expect(c.reads()).toBe(1);
  });

  it('reads again once the TTL has passed', async () => {
    const c = counting();
    await c.cache.current();
    c.advance(60_000);
    expect(await c.cache.current()).toEqual({ claude: '2.1.2' });
    expect(c.reads()).toBe(2);
  });

  // A BUILD READS FRESH AND LEAVES WHAT IT READ BEHIND, so the versions the image was just labelled
  // with are the ones the next probe compares it against — never a reading from before the host moved.
  it('is replaced by a refresh, which is what a build asks for', async () => {
    const c = counting();
    await c.cache.current();
    expect(await c.cache.refresh()).toEqual({ claude: '2.1.2' });
    expect(await c.cache.current()).toEqual({ claude: '2.1.2' });
    expect(c.reads()).toBe(2);
  });

  it('defaults to a TTL long enough that polling does not spawn', () => {
    expect(HOST_CLI_TTL_MS).toBeGreaterThanOrEqual(60_000);
  });
});
