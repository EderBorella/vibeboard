import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { clearWizardState, readWizardState, writeWizardState } from '../src/store/project/wizard.js';
import { testTmp } from './helpers.js';

// Inside the run's own root rather than the system temp dir: see testTmp, and the inode incident it
// records.
const root = mkdtempSync(join(testTmp(), 'vb-wiz-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('the wizard state file', () => {
  it('is absent until written, round-trips, and is gone after clearing', async () => {
    expect(await readWizardState(root)).toBeNull();
    await writeWizardState(root, { mode: 'brownfield', step: 'backend', answers: { what: 'a game' } });
    expect((await readWizardState(root))?.answers?.what).toBe('a game');
    await clearWizardState(root);
    expect(await readWizardState(root)).toBeNull();
    // Clearing twice is not an error — the wizard may be abandoned from two tabs.
    await clearWizardState(root);
  });

  it('an unreadable file reads as no wizard, never as a crash', async () => {
    await writeWizardState(root, { mode: 'greenfield', step: 'form' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(root, '.vibeboard', 'wizard.yaml'), '{:::', 'utf8');
    expect(await readWizardState(root)).toBeNull();
    await clearWizardState(root);
  });
});
