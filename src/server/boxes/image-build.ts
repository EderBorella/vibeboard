import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProbeResult } from './box-manager.js';
import { type CliVersions, cliDrift, describePins, pinFlags } from './cli-versions.js';
import { BASE_IMAGE, DEFAULT_IMAGE, dockerBin } from './containers.js';

// BUILDING THE AGENT IMAGE, from inside the product rather than from a developer's terminal.
//
// The product used to DETECT the missing prerequisite, NAME it, and have no code path that could satisfy
// it: `probe()` printed "run `npm run box:build`", which is a developer command. Anyone running an
// installed VibeBoard has no npm scripts, no Dockerfile and no repository to build from — so on that
// machine the app was bricked, no agents and no copilot, with the single instruction it gave being one
// that could not be followed.
//
// THE CONTEXT IS `tools/docker/` AND NOT THE REPOSITORY ROOT. The Dockerfile copies three files, all of
// them from that directory, so the root was never needed — it was simply what `npm run box:build` passed.
// Narrowing it is what makes the build work from an installed tree, and it drops the context from about
// 7 MB to a few kilobytes.
//
// RESOLVED FROM THIS MODULE, never from the working directory, for the reason `logging.ts` gives about
// its own root: `dist/server/boxes/image-build.js` and `src/server/boxes/image-build.ts` both sit three
// levels below the install root, so the same expression finds `tools/docker` either way.
export function agentBuildContext(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..', 'tools', 'docker');
}

// Exported for its own test: the argv is the whole of what this does, and a wrong flag here fails as a
// multi-minute build that produces the wrong thing.
export function buildArgs(
  image: string = DEFAULT_IMAGE,
  context = agentBuildContext(),
  // Named, because there are two of them now — the base and the web layer that stands on it. The
  // default is the web layer, so every caller that predates the split asks for what it always did.
  file = 'Dockerfile.agent',
  // THE CLI VERSIONS THIS IMAGE HOLDS, passed in rather than read here so the argv stays a pure function
  // of its arguments. Only Dockerfile.base consumes the build args; the web layer is given them too and
  // ignores them, so one rule covers both images: each is labelled with what it holds.
  versions: CliVersions = {},
): string[] {
  // `-f` as well as the context, because the file is not named `Dockerfile`. Both are inside the context
  // directory, which is what lets the whole thing travel with the package.
  return ['build', '-f', join(context, file), '-t', image, ...pinFlags(versions), context];
}

export interface BuildResult {
  ok: boolean;
  // The last line docker printed, which is the one worth reporting when it failed.
  last: string;
}

// LINE BY LINE, TO A CALLBACK, because this takes minutes and a step that shows nothing for minutes is
// indistinguishable from one that has hung. Both callers stream it: the start script to the terminal it
// was run from, and the route to the browser over the socket a run's transcript already uses.
//
// BOTH STREAMS. `docker build` writes its progress to stderr and its result to stdout, so reading only
// one produces either a build with no progress or progress with no outcome.
export function buildAgentImage(
  onLine: (line: string) => void,
  image: string = DEFAULT_IMAGE,
  file = 'Dockerfile.agent',
  versions: CliVersions = {},
): Promise<BuildResult> {
  return new Promise((settle) => {
    const child = spawn(dockerBin(), buildArgs(image, agentBuildContext(), file, versions), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let last = '';
    // One buffer per stream: interleaving two partial lines into a single buffer splices them.
    const reader = (): ((chunk: Buffer) => void) => {
      let buf = '';
      return (chunk) => {
        buf += chunk.toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const text = line.trimEnd();
          if (text === '') continue;
          last = text;
          onLine(text);
        }
      };
    };
    child.stdout?.on('data', reader());
    child.stderr?.on('data', reader());
    child.on('error', (err) => settle({ ok: false, last: err.message }));
    child.on('close', (code) => settle({ ok: code === 0, last }));
  });
}

type Prober = { probe(image?: string): Promise<ProbeResult> };
type Builder = (
  onLine: (line: string) => void,
  image?: string,
  file?: string,
  versions?: CliVersions,
) => Promise<BuildResult>;
type Ensured = 'present' | 'built' | 'failed' | 'no-docker';

// WHAT A PRESENT IMAGE THAT HAS DRIFTED FROM THE HOST GETS. The button rebuilds it — that is what it is
// pressed for. The start only says so: a rebuild there is minutes of `npm install` after every host
// update, `npm run dev` restarts on every save and would kill it half way, and the image it replaces still
// runs agents. So each caller states which, and there is no default for one to inherit by accident.
export type WhenStale = 'rebuild' | 'report';

interface Step {
  service: Prober;
  onLine: (line: string) => void;
  build: Builder;
  image: string;
  file: string;
  host: () => Promise<CliVersions>;
  // What this image should hold if it is built: the host's for the base, the base's for the web layer.
  pins: () => Promise<CliVersions>;
  whenStale: WhenStale;
  // Set for the web layer once the base has been reported: it stands on the base and holds the same
  // CLIs, so a second line would be the same news.
  quiet: boolean;
}

// And what the image holds afterwards, which is what the layer above it is labelled with.
interface Stepped {
  outcome: Ensured;
  holds: CliVersions;
  reported: boolean;
}

// BUILD IT IF IT IS NOT THERE, rebuild it if it has drifted and the caller asked for that, and otherwise
// do nothing at all.
//
// A MISSING DAEMON IS NOT A MISSING IMAGE. `probe()` answers both as "not ok", and building against a
// daemon that is not running would spend a failed `docker build` to discover what the probe already
// knew — so this asks specifically whether the image is the thing that is absent.
async function ensureOneImage(step: Step): Promise<Stepped> {
  const { image, onLine } = step;
  const before = await step.service.probe(image);
  if (!before.ok && before.missing !== 'image') return { outcome: 'no-docker', holds: {}, reported: false };
  const drift = before.ok ? cliDrift(before.built ?? {}, await step.host()) : null;
  if (before.ok && (drift === null || step.whenStale === 'report')) {
    if (drift !== null && !step.quiet) onLine(`${image} ${drift}. Rebuild it from Settings › Agent sandbox.`);
    return { outcome: 'present', holds: before.built ?? {}, reported: drift !== null };
  }
  onLine(
    drift === null
      ? `Building the agent image ${image}. This takes a few minutes the first time.`
      : `Rebuilding ${image}, which ${drift}. This takes a few minutes.`,
  );
  const pins = await step.pins();
  const result = await step.build(onLine, image, step.file, pins);
  if (result.ok) {
    onLine(`Built ${image}.`);
    return { outcome: 'built', holds: pins, reported: false };
  }
  onLine(`Could not build ${image}: ${result.last}`);
  return { outcome: 'failed', holds: {}, reported: false };
}

// BASE FIRST, because the web layer's FROM names it — built the other way round, the web build fails
// on a fresh machine with "pull access denied", which reads like a registry problem rather than an
// ordering one. Idempotent for the same reason the one-image version was: an ordinary start costs two
// `docker image inspect`s and one reading of the host's CLIs. The builder is injectable ONLY so the
// ordering is testable without a daemon; production callers never pass it. decision 75.
//
// THE HOST IS READ AT MOST ONCE, and only once docker has answered: two spawns to learn nothing, on a
// machine whose daemon is down, is the probe-before-build argument again.
export async function ensureAgentImages(
  service: Prober,
  onLine: (line: string) => void,
  opts: { host: () => Promise<CliVersions>; whenStale: WhenStale; build?: Builder },
): Promise<Ensured> {
  const build = opts.build ?? buildAgentImage;
  let reading: Promise<CliVersions> | undefined;
  const host = (): Promise<CliVersions> => {
    reading ??= opts.host();
    return reading;
  };
  const common = { service, onLine, build, host, whenStale: opts.whenStale };
  const base = await ensureOneImage({
    ...common,
    image: BASE_IMAGE,
    file: 'Dockerfile.base',
    pins: async () => {
      const versions = await host();
      for (const line of describePins(versions)) onLine(line);
      return versions;
    },
    quiet: false,
  });
  if (base.outcome === 'failed' || base.outcome === 'no-docker') return base.outcome;
  const web = await ensureOneImage({
    ...common,
    image: DEFAULT_IMAGE,
    file: 'Dockerfile.agent',
    pins: async () => base.holds,
    quiet: base.reported,
  });
  if (web.outcome === 'present' && base.outcome === 'built') return 'built';
  return web.outcome;
}
