import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ScaffoldMode } from '../src/store/project/scaffold.js';
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

  // A MODE IS ONE OF TWO THINGS AND EVERY STEP AFTER THE FIRST BRANCHES ON IT. The file is on a
  // person's disk and hand-editable, and a third value would reach the browser as a `ScaffoldMode`
  // the compiler believes in — so it is refused here, where the lie is made, rather than by whichever
  // component happens to read it first.
  it('a mode it does not recognise reads as no wizard', async () => {
    await writeWizardState(root, { mode: 'sideways' as ScaffoldMode, step: 'form' });

    expect(await readWizardState(root)).toBeNull();
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
