import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// One directory per test RUN, holding every temp project the suite creates, removed by
// test/global-teardown.ts when the run ends.
//
// This exists because the suite leaked its working directories: `mkdtemp` per test with nothing ever
// removing them left 440,653 `/tmp/vibeboard-*` trees behind over four weeks and filled the
// filesystem's INODE table (9.43M of 9.83M) while 61G of block space sat free. Every file-creating
// call then had a chance of ENOSPC, so an arbitrary single test failed while the rest passed — an
// intermittent failure nobody could attribute. One run creates ~764 of these directories.
//
// A per-RUN root rather than a shared prefix, because a teardown that swept `/tmp/vibeboard-*`
// wholesale would delete the live directories of any suite running beside it — and Stryker spawns one
// worker process per core.
//
// On process.env as well as in `env`: the workers read the latter, and the global teardown, which runs
// in this process, reads the former.
const RUN_TMP = mkdtempSync(join(tmpdir(), 'vibeboard-run-'));
process.env.VIBEBOARD_TEST_TMP = RUN_TMP;

export default defineConfig({
  // The web build gets this from @vitejs/plugin-react; the test transform needs it stated, or JSX
  // compiles to React.createElement and fails with "React is not defined".
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    // Opening a project records it as "last opened" so it can be reopened on restart. Point
    // that at a temp file during tests so the suite never touches the real ~/.vibeboard.
    // Per-process, so concurrent runs (Stryker spawns one per worker) don't share one file.
    globalSetup: ['./test/global-teardown.ts'],
    env: {
      // Inside the run root, so it goes with everything else.
      VIBEBOARD_TEST_TMP: RUN_TMP,
      // `docker` is the suite's stand-in (test/fake-docker.mjs), which strips the exec prefix and runs
      // the rest on the host. `wrapCommand` still builds a real `docker exec` argv and the spawn still
      // happens, so the argv stays under assertion — there is no bypass inside the wrapper for anyone
      // to reach for later. What this does NOT simulate is the isolation; that is checked against a
      // real container in test/box-integration.test.ts, which uses the real binary explicitly.
      //
      // Set HERE rather than in a setup file: a setup file also runs under jsdom, where import.meta.url
      // is an http URL and `fileURLToPath` throws — which failed the collection of every .tsx suite.
      VIBEBOARD_DOCKER_BIN: fileURLToPath(new URL('./test/fake-docker.mjs', import.meta.url)),
      VIBEBOARD_STATE_FILE: join(mkdtempSync(join(RUN_TMP, 'state-')), 'state.json'),
      // The server's logger is on by default (src/server/logging.ts). Silence it for the suite —
      // every file that builds an app, directly or through openTestProject, would otherwise bury
      // the test output in request lines. test/logging.test.ts passes its own logger instead.
      VIBEBOARD_LOG_LEVEL: 'silent',
      // And belt-and-braces: even a test that raises the level writes no file into the repo.
      VIBEBOARD_LOG_DIR: '',
    },
  },
});
