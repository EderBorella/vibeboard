import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { THEMES, type VisualOptions } from './support/fixtures.js';

// The browser harness. Everything it needs to be hermetic is an environment variable set by
// visual/run.mjs, which owns the per-run temp root — see that file for why the root cannot be made
// here (this module is re-evaluated in every worker process).

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function required(name: string): string {
  const value = process.env[name];
  // Loud rather than defaulted. A default here would let `playwright test` run against the owner's
  // own `~/.vibeboard` and their live board, which is the one outcome this file must make impossible.
  if (!value) throw new Error(`${name} is not set — run the harness with \`npm run visual\``);
  return value;
}

const root = required('VB_VISUAL_ROOT');
const port = process.env.VB_VISUAL_PORT ?? '4699';

// A copy with the holes taken out: `process.env` is `string | undefined` and webServer.env is not.
// Kept rather than replaced, because the server's own boot needs PATH and HOME.
const inherited: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) inherited[key] = value;
}

export default defineConfig<VisualOptions>({
  testDir: './checks',
  // Failure artefacts go under the per-run temp root, so they are removed with it and nothing lands
  // in the repository. Playwright's default is `test-results/` beside the working directory, which
  // would leave an untracked directory behind after every red run.
  outputDir: join(root, 'results'),
  // One worker and one server. The checks measure a shared board through one process; a second
  // worker would mean a second browser competing for the same snapshot socket, and a flaky harness
  // is worse than none because its failures stop being read.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // No trace, no video, no HAR — deliberately. All three record request headers, and the harness
  // authenticates with a cookie that carries a credential.
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  // Every check, three times. The themes are the considered part of this codebase and a conformance
  // claim about one of them is a claim about none.
  projects: THEMES.map((theme) => ({ name: theme, use: { theme } })),
  webServer: {
    // THE REAL SERVER, from the built artefact — not vite dev, not a mock. The defect this harness
    // exists to catch was a computed font size in the production bundle.
    command: 'node dist/server/main.js',
    cwd: REPO,
    url: `http://127.0.0.1:${port}/`,
    // Never adopt a server we did not start: a running one would be the owner's board, with the
    // owner's projects and the owner's credential.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      ...inherited,
      VIBEBOARD_PORT: port,
      // Loopback, overriding whatever `.env` says: a harness has no reason to be reachable.
      VIBEBOARD_HOST: '127.0.0.1',
      VIBEBOARD_ROOT: join(root, 'projects'),
      VIBEBOARD_STATE_FILE: required('VB_VISUAL_STATE_FILE'),
      // Credentials and the device store live beside each other under this path, so relocating it
      // keeps the harness out of the owner's `~/.vibeboard` entirely — it neither reads their
      // credential nor adds a device row to their board.
      VIBEBOARD_TOKEN_FILE: required('VB_VISUAL_TOKEN_FILE'),
      // Under the run root, so this server cannot take the API socket off the owner's server.
      VIBEBOARD_API_SOCKET_DIR: join(root, 'run'),
      // Also under the run root, and this one is load-bearing rather than tidy: the copilot's clean
      // config home is created per project, and `~/.vibeboard/copilot/projects/` on this machine holds
      // 26,117 directories and 542MB because the vitest suite does not set it. The harness will not add
      // to that.
      VIBEBOARD_COPILOT_HOME: join(root, 'copilot'),
      // NO DOCKER, and this is a safety interlock rather than tidiness: on owning the API socket the
      // server sweeps "old" agent boxes by label, and it cannot tell another instance's boxes from
      // its own — so a harness that could reach the daemon would remove the containers of whatever
      // the owner is running. Pointing the binary at /bin/false makes every docker call fail closed;
      // the cost is that the board renders with agents disabled, which is a banner, not a layout.
      VIBEBOARD_DOCKER_BIN: '/bin/false',
      VIBEBOARD_LOG_LEVEL: 'silent',
      // Explicitly empty means "write no files": the harness must not drop a log into the repo.
      VIBEBOARD_LOG_DIR: '',
    },
  },
});
