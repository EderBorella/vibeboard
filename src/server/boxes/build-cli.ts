// `npm run box:build`, and it exists so there is ONE definition of how the image is built.
//
// The script used to spell the whole `docker build` invocation in `package.json`, which meant the
// server could not build the image without a second copy of that command — and two copies of a build
// are two builds that will eventually differ in the flag that matters. This runs the same function the
// start script and the settings route run.
//
// Kept in `src/server/boxes/` rather than `tools/`, beside `image-build.ts`, because it is three lines
// of entry point around that module and moving it away would put the CLI and its subject in different
// trees for no gain.
import { buildAgentImage } from './image-build.js';

const result = await buildAgentImage((line) => process.stdout.write(`${line}\n`));
if (!result.ok) {
  process.stderr.write(`\nThe build failed: ${result.last}\n`);
  process.exit(1);
}
