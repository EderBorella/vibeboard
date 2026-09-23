import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// WHICH AGENT CLIs AN IMAGE HOLDS, AND WHICH ONES THE HOST HAS.
//
// Dockerfile.base pins both CLIs to the host's because they resume sessions from state the host and the
// box share over a bind mount. The pin used to be a number copied by hand: it matched on the day it was
// written, the host moved on, and it went on guaranteeing exactly the skew it exists to prevent — every
// run reported the model the box's older CLI resolved `opus` to. So the build now reads the host's
// versions and passes them in, and records them on the image as labels the probe can read back without
// starting a container.

export interface CliVersions {
  claude?: string;
  opencode?: string;
}

type Cli = keyof CliVersions;

// The labels are keyed by the backend names containers.ts gives the boxes, so each reads as "the CLI
// that backend's box runs".
const CLIS: readonly { key: Cli; bin: string; name: string; arg: string; label: string }[] = [
  {
    key: 'claude',
    bin: 'claude',
    name: 'Claude Code',
    arg: 'CLAUDE_VERSION',
    label: 'io.vibeboard.cli.claude-code',
  },
  {
    key: 'opencode',
    bin: 'opencode',
    name: 'OpenCode',
    arg: 'OPENCODE_VERSION',
    label: 'io.vibeboard.cli.opencode',
  },
];

// NOTHING BUT A VERSION, because the value ends up in a shell: Dockerfile.base installs
// `claude-code@${CLAUDE_VERSION}` in a RUN line, which docker hands to `sh -c`.
const VERSION = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/;
const EXACT = new RegExp(`^${VERSION.source}$`);

const isVersion = (value: unknown): value is string => typeof value === 'string' && EXACT.test(value);

// `claude --version` prints `2.1.280 (Claude Code)` and `opencode --version` prints `1.17.18`.
export function parseVersion(output: string): string | undefined {
  return VERSION.exec(output)?.[0];
}

// A CLI with no version passes no flag, so the Dockerfile's own ARG default is installed — and gets no
// label, because which version that default is is not known here and a label is a claim.
export function pinFlags(versions: CliVersions): string[] {
  return CLIS.flatMap(({ key, arg, label }) => {
    const version = versions[key];
    return isVersion(version) ? ['--build-arg', `${arg}=${version}`, '--label', `${label}=${version}`] : [];
  });
}

// The versions an image records, out of the JSON `docker image inspect` prints. ANYTHING UNREADABLE IS
// UNRECORDED: output that does not parse has not shown the image to be current, so it must not say so.
// An unlabelled image has no `Labels` key at all, which lands here too.
export function inspectVersions(stdout: string): CliVersions {
  let labels: unknown;
  try {
    labels = (JSON.parse(stdout) as { Config?: { Labels?: unknown } | null }[])[0]?.Config?.Labels;
  } catch {
    return {};
  }
  if (typeof labels !== 'object' || labels === null) return {};
  const found: CliVersions = {};
  for (const { key, label } of CLIS) {
    const version = (labels as Record<string, unknown>)[label];
    if (isVersion(version)) found[key] = version;
  }
  return found;
}

// WHY AN IMAGE IS BEHIND THE HOST, as a clause to follow the image's name — or null when it is not.
//
// Only CLIs the host has are compared. A machine with no Claude Code shares no Claude state with the box,
// so the pin's reason does not reach it, and a question a rebuild could never clear is not asked.
//
// AN IMAGE WITH NO LABELS AT ALL IS BEHIND: it cannot be shown to match. Every image built before the
// labels existed is in this state, the one that found the defect among them, so reading it as current
// would hide the drift from exactly the machines that have it. It costs one rebuild per install.
export function cliDrift(built: CliVersions, host: CliVersions): string | null {
  const known = CLIS.filter(({ key }) => host[key] !== undefined);
  const differing = known.filter(({ key }) => built[key] !== host[key]);
  if (differing.length === 0) return null;
  if (CLIS.every(({ key }) => built[key] === undefined)) {
    const theirs = known.map(({ key, name }) => `${name} ${host[key]}`).join(' and ');
    return `was built before VibeBoard recorded CLI versions on its images, so it cannot be shown to match this machine's ${theirs}`;
  }
  const clauses = differing.map(({ key, name }) => {
    const have = built[key];
    return have
      ? `${name} ${have} where this machine has ${host[key]}`
      : `no recorded ${name} version where this machine has ${host[key]}`;
  });
  return `has ${clauses.join(', and ')}`;
}

// What a build is about to pin, for its own output. A CLI the host could not answer for falls back to the
// Dockerfile's ARG default rather than refusing to build: an OpenCode-only machine has no Claude Code at
// all, and refusing would leave it with no agents to protect a skew it cannot have. But it is SAID, so a
// build log never shows a fallback as though it were a match.
export function describePins(versions: CliVersions): string[] {
  const pinned = CLIS.filter(({ key }) => versions[key] !== undefined)
    .map(({ key, name }) => `${name} ${versions[key]}`)
    .join(', ');
  const lines = pinned ? [`Pinning the agent CLIs to this machine's: ${pinned}.`] : [];
  for (const { key, bin, name } of CLIS) {
    if (versions[key] !== undefined) continue;
    lines.push(
      `Could not read this machine's ${name} version (\`${bin} --version\`), so the image gets the one Dockerfile.base pins.`,
    );
  }
  return lines;
}

// What `<bin> --version` printed, or undefined when it could not be run — not installed, not on the
// server's PATH, or not answering.
type VersionRun = (bin: string) => Promise<string | undefined>;

const run = promisify(execFile);

const versionOf: VersionRun = async (bin) => {
  try {
    return (await run(bin, ['--version'], { timeout: 10_000 })).stdout;
  } catch {
    return undefined;
  }
};

// The PATH's `claude` and `opencode`, and deliberately not `VIBEBOARD_CLAUDE_BIN`: that names the binary
// an agent turn execs, which is the one inside the box.
export async function readHostCliVersions(runVersion: VersionRun = versionOf): Promise<CliVersions> {
  const read = await Promise.all(
    CLIS.map(async ({ key, bin }) => [key, parseVersion((await runVersion(bin)) ?? '')] as const),
  );
  const found: CliVersions = {};
  for (const [key, version] of read) if (version !== undefined) found[key] = version;
  return found;
}

// A MINUTE, and a cache of its own rather than a seat under the sandbox's one-second TTL. Reading the host
// is two process spawns — `opencode --version` took 0.37s measured — and the sandbox route is polled, so
// under that TTL it would be spawning for a third of every second something is watching. What a minute
// costs is how long a host update takes to surface as the rebuild button, and the drift gates nothing.
export const HOST_CLI_TTL_MS = 60_000;

// What invalidates it: the TTL, and a `refresh`, which every build calls before it pins. The build's own
// reading is then the one the next probe compares against, so an image is never measured against a
// reading older than the versions it was just labelled with.
export function hostCliCache(
  opts: { read?: () => Promise<CliVersions>; ttlMs?: number; now?: () => number } = {},
): { current: () => Promise<CliVersions>; refresh: () => Promise<CliVersions> } {
  const read = opts.read ?? (() => readHostCliVersions());
  const ttl = opts.ttlMs ?? HOST_CLI_TTL_MS;
  const now = opts.now ?? Date.now;
  let cached: { at: number; versions: CliVersions } | undefined;
  // Shared, so a burst of probes that all find the entry expired spawns one pair between them.
  let inFlight: Promise<CliVersions> | undefined;
  const refresh = (): Promise<CliVersions> => {
    inFlight ??= read()
      .then((versions) => {
        cached = { at: now(), versions };
        return versions;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
  const current = async (): Promise<CliVersions> =>
    cached && now() - cached.at < ttl ? cached.versions : refresh();
  return { current, refresh };
}

// The one the server uses. One per process, so the sandbox probe and a build share a reading.
export const hostCli = hostCliCache();
