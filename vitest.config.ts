import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The web build gets this from @vitejs/plugin-react; the test transform needs it stated, or JSX
  // compiles to React.createElement and fails with "React is not defined".
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    // Opening a project records it as "last opened" so it can be reopened on restart. Point
    // that at a temp file during tests so the suite never touches the real ~/.vibeboard.
    // Per-process, so concurrent runs (Stryker spawns one per worker) don't share one file.
    env: {
      VIBEBOARD_STATE_FILE: join(mkdtempSync(join(tmpdir(), 'vibeboard-state-')), 'state.json'),
      // The server's logger is on by default (src/server/logging.ts). Silence it for the suite —
      // every file that builds an app, directly or through openTestProject, would otherwise bury
      // the test output in request lines. test/logging.test.ts passes its own logger instead.
      VIBEBOARD_LOG_LEVEL: 'silent',
    },
  },
});
