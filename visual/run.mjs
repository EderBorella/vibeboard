#!/usr/bin/env node
// The only supported way to run the browser harness: `npm run visual`.
//
// It exists because three things have to be true at once and none of them can be expressed in
// playwright.config.ts alone.
//
// 1. ONE TEMP ROOT PER RUN, REMOVED HERE. The vitest suite once leaked one directory per test and
//    filled the filesystem's inode table (440,653 trees, 9.43M of 9.83M inodes) while 61G of block
//    space sat free — every file-creating call then had a chance of failing, so one arbitrary test
//    died per run and looked like flakiness. The config module is re-evaluated in every worker
//    process, so an `mkdtemp` there would make one root per worker and nothing would own the
//    removal. It is made once, here, in the process that outlives the run. Never a swept shared
//    prefix: a run beside this one has live directories under the same prefix.
// 2. THE ARTEFACT UNDER TEST MUST MATCH THE TREE. The webServer boots `dist/server/main.js` and the
//    UI it serves is `dist/web`, so a stale build means the harness measures the previous commit's
//    CSS — which would make a planted defect pass and the gate worthless.
// 3. THE FIXTURE PROJECT HAS TO EXIST BEFORE THE SERVER STARTS, because the server reopens
//    `lastProject` at boot and the board only renders with a project open.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 4610 is the owner's own board. A harness that bound it would take the port from a live server, so
// the default here is a different one and the value travels to the server and to the tests together.
const PORT = process.env.VB_VISUAL_PORT ?? '4699';

const root = mkdtempSync(join(tmpdir(), 'vibeboard-visual-'));
let cleaned = false;

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  rmSync(root, { recursive: true, force: true });
  // Stated, not assumed: a teardown that silently failed is how the inode incident started.
  if (existsSync(root)) console.error(`  visual: FAILED to remove ${root}`);
  else console.log(`  visual: removed ${root}`);
}

function die(message) {
  console.error(`  visual: ${message}`);
  cleanup();
  process.exit(1);
}

// Both of these, or a Ctrl-C during a 20-second run leaves the tree behind — which is exactly the
// per-run leak this file is built to prevent.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanup();
    process.exit(130);
  });
}

if (process.env.VB_VISUAL_SKIP_BUILD !== '1') {
  const built = spawnSync('npm', ['run', 'build'], { cwd: REPO, stdio: 'inherit' });
  if (built.status !== 0) die('the build failed, so there is nothing current to test');
}

// Imported from `dist/` rather than reimplemented: a fixture built by a second copy of the scaffolder
// would drift, and then the harness would be testing a project shape the product cannot produce.
const { scaffoldProject } = await import(pathToFileURL(join(REPO, 'dist/store/project/scaffold.js')));

const projects = join(root, 'projects');
const project = join(projects, 'harness');
mkdirSync(project, { recursive: true });
// Greenfield, because it writes the sample cards: a board with no cards renders almost no elements,
// and a check that examines nothing passes.
await scaffoldProject(project, { name: 'Harness', mode: 'greenfield', today: '2026-01-01' });

const stateFile = join(root, 'state.json');
writeFileSync(stateFile, `${JSON.stringify({ lastProject: project }, null, 2)}\n`, 'utf8');

const env = {
  ...process.env,
  VB_VISUAL_PORT: PORT,
  VB_VISUAL_ROOT: root,
  VB_VISUAL_PROJECT: project,
  VB_VISUAL_STATE_FILE: stateFile,
  // The server creates this file at boot. The tests read it at that moment and keep the value in
  // memory; nothing here ever writes a credential, and the file goes with the root.
  VB_VISUAL_TOKEN_FILE: join(root, 'creds', 'token'),
};

const playwright = join(REPO, 'node_modules', '.bin', 'playwright');
if (!existsSync(playwright)) die('node_modules/.bin/playwright is missing — run npm install');

const args = ['test', '--config', join(REPO, 'visual', 'playwright.config.ts'), ...process.argv.slice(2)];
const run = spawn(playwright, args, { cwd: REPO, stdio: 'inherit', env });
run.on('exit', (code, signal) => {
  cleanup();
  process.exit(signal ? 1 : (code ?? 1));
});
