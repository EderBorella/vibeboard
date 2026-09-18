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
import { BASE_IMAGE, DEFAULT_IMAGE } from './containers.js';
import { buildAgentImage } from './image-build.js';

// BASE FIRST, because the web layer's `FROM` names it: the other order fails on a fresh machine with
// docker trying to pull `vibeboard-agent:base` from a registry, which reads like a network fault.
// decision 75.
for (const [image, file] of [
  [BASE_IMAGE, 'Dockerfile.base'],
  [DEFAULT_IMAGE, 'Dockerfile.agent'],
] as const) {
  const result = await buildAgentImage((line) => process.stdout.write(`${line}\n`), image, file);
  if (!result.ok) {
    // NAMES WHICH of the two: they are built in sequence from different Dockerfiles, and a failure
    // that said only "the build failed" left the reader guessing which file to look in.
    process.stderr.write(`\nThe build of ${image} failed: ${result.last}\n`);
    process.exit(1);
  }
}
