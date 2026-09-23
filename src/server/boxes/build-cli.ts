// `npm run box:build`, and it exists so there is ONE definition of how the images are built.
//
// The script used to spell the whole `docker build` invocation in `package.json`, which meant the
// server could not build the image without a second copy of that command — and two copies of a build
// are two builds that will eventually differ in the flag that matters. This runs the same function the
// start script and the settings route run.
//
// Kept in `src/server/boxes/` rather than `tools/`, beside `image-build.ts`, because it is a handful of
// lines of entry point around that module and moving it away would put the CLI and its subject in
// different trees for no gain.
import { describePins, readHostCliVersions } from './cli-versions.js';
import { BASE_IMAGE, DEFAULT_IMAGE } from './containers.js';
import { buildAgentImage } from './image-build.js';

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

// PINNED TO THE HOST'S CLIs, like every other build: this is the one path that always builds, and
// before the versions were read here it was also the one that kept producing the hand-copied pin. Both
// images get the same versions because the base is built first with them and the loop stops if it fails,
// so the web layer is labelled with what the base it stands on really holds.
const versions = await readHostCliVersions();
for (const line of describePins(versions)) say(line);

// BASE FIRST, because the web layer's `FROM` names it: the other order fails on a fresh machine with
// docker trying to pull `vibeboard-agent:base` from a registry, which reads like a network fault.
// decision 75.
for (const [image, file] of [
  [BASE_IMAGE, 'Dockerfile.base'],
  [DEFAULT_IMAGE, 'Dockerfile.agent'],
] as const) {
  const result = await buildAgentImage(say, image, file, versions);
  if (!result.ok) {
    // NAMES WHICH of the two: they are built in sequence from different Dockerfiles, and a failure
    // that said only "the build failed" left the reader guessing which file to look in.
    process.stderr.write(`\nThe build of ${image} failed: ${result.last}\n`);
    process.exit(1);
  }
}
