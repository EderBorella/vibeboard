import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProbeResult } from './box-manager.js';
import { DEFAULT_IMAGE, dockerBin } from './containers.js';

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
export function buildArgs(image: string = DEFAULT_IMAGE, context = agentBuildContext()): string[] {
  // `-f` as well as the context, because the file is not named `Dockerfile`. Both are inside the context
  // directory, which is what lets the whole thing travel with the package.
  return ['build', '-f', join(context, 'Dockerfile.agent'), '-t', image, context];
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
): Promise<BuildResult> {
  return new Promise((settle) => {
    const child = spawn(dockerBin(), buildArgs(image), { stdio: ['ignore', 'pipe', 'pipe'] });
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

// BUILD IT IF IT IS NOT THERE, and do nothing at all if it is. The idempotent half of the ruling: this
// runs on every start, so the ordinary cost has to be one `docker image inspect`.
//
// A MISSING DAEMON IS NOT A MISSING IMAGE. `probe()` answers both as "not ok", and building against a
// daemon that is not running would spend a failed `docker build` to discover what the probe already
// knew — so this asks specifically whether the image is the thing that is absent.
export async function ensureAgentImage(
  service: { probe(image?: string): Promise<ProbeResult> },
  onLine: (line: string) => void,
  image: string = DEFAULT_IMAGE,
): Promise<'present' | 'built' | 'failed' | 'no-docker'> {
  const before = await service.probe(image);
  if (before.ok) return 'present';
  if (before.missing !== 'image') return 'no-docker';
  onLine(`Building the agent image ${image}. This takes a few minutes the first time.`);
  const result = await buildAgentImage(onLine, image);
  if (result.ok) {
    onLine(`Built ${image}.`);
    return 'built';
  }
  onLine(`Could not build ${image}: ${result.last}`);
  return 'failed';
}
