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
    env: {
      VIBEBOARD_STATE_FILE: join(tmpdir(), 'vibeboard-test-state.json'),
    },
  },
});
