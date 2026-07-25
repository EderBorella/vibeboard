import { defineConfig } from 'vitest/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Opening a project records it as "last opened" so it can be reopened on restart. Point
    // that at a temp file during tests so the suite never touches the real ~/.vibeboard.
    env: {
      VIBEBOARD_STATE_FILE: join(tmpdir(), 'vibeboard-test-state.json'),
    },
  },
});
