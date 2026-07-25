import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_DIR, defaultConfig, readConfig, writeConfig } from '../src/core/config.js';
import { tempDir } from './helpers.js';

describe('config', () => {
  it('defaultConfig has both boards and sane defaults', () => {
    const c = defaultConfig('Demo');
    expect(c.name).toBe('Demo');
    expect(c.boards.product.columns).toContain('In Progress');
    expect(c.boards.engineering.columns).toContain('Review');
    expect(c.idPadding).toBe(3);
    expect(c.copilot.backend).toBe('claude-code');
  });

  it('round-trips through write then read', async () => {
    const root = await tempDir();
    await mkdir(join(root, CONFIG_DIR), { recursive: true });
    const c = defaultConfig('Round Trip');
    await writeConfig(root, c);
    const back = await readConfig(root);
    expect(back).toEqual(c);
  });
});
