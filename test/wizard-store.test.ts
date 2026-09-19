import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ScaffoldMode } from '../src/store/project/scaffold.js';
import {
  clearWizardState,
  knownSuggestions,
  readWizardState,
  WIZARD_STATE_KEYS,
  WIZARD_STEPS,
  type WizardState,
  writeWizardState,
} from '../src/store/project/wizard.js';
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

  // THE JOURNEY IN ORDER, asserted as a whole list rather than by membership: the steps are walked in
  // this sequence and a resumed setup comes back to one of them by name, so a step inserted in the
  // wrong place is a person sent to the wrong screen. The three agent moments sit where they act —
  // the scan before the form fills it, the stack after the form answers it. decision 77.
  it('names a step for each of the wizard journey, in the order they are walked', () => {
    expect([...WIZARD_STEPS]).toEqual(['backend', 'scan', 'form', 'stack', 'docs', 'gates', 'handoff']);
  });

  // WHAT AN AGENT PROPOSED AND WHAT WAS AGREED, round-tripped — and every key checked against the
  // declared set, because this file is schema-agnostic: `stringify` would happily carry a field
  // neither side has heard of, and `PUT /api/wizard` REPLACES the whole file, so an undeclared key is
  // one the browser deletes on the next Continue with nothing reporting it. decision 77.
  it('round-trips an agent suggestion beside the agreed stack, and declares every field it wrote', async () => {
    const state: WizardState = {
      mode: 'brownfield',
      step: 'stack',
      answers: { what: 'a timeline' },
      suggested: {
        answers: { what: 'a timeline of releases', who: 'the team' },
        kind: 'web',
        stack: 'TypeScript and Vite',
        packages: ['imagemagick'],
      },
      stack: 'TypeScript, Vite and nothing else',
    };
    await writeWizardState(root, state);

    expect(await readWizardState(root)).toEqual(state);
    const declared: readonly string[] = WIZARD_STATE_KEYS;
    for (const key of Object.keys(state)) expect(declared, key).toContain(key);
    await clearWizardState(root);
  });

  // A setup begun before the suggestion fields existed is on somebody's disk right now, and it resumes
  // rather than restarts — so the new fields must read as absent and not as anything else.
  it('a file written before the suggestion fields existed still reads', async () => {
    await writeWizardState(root, { mode: 'greenfield', step: 'form', answers: { what: 'a game' } });

    const read = await readWizardState(root);
    expect(read).toEqual({ mode: 'greenfield', step: 'form', answers: { what: 'a game' } });
    expect(read?.suggested).toBeUndefined();
    expect(read?.stack).toBeUndefined();
    await clearWizardState(root);
  });
});

// WHAT A RUN IS ALLOWED TO HAVE SAID, and it is a question about VALUES as well as keys. The filter
// checked the key and spread whatever was under it, so a model answering the packages question in
// prose put a STRING where the browser reads a list — `csv('git, ripgrep')` calls `.join` on it and
// throws during render, with no error boundary above the wizard. The screen goes blank and stays
// blank, because the state is on disk and the next read produces the same throw: setup is dead until
// somebody deletes a file they do not know about. Reproduced by a reviewer.
//
// Dropped rather than coerced, for the reason the keys are filtered rather than refused: a scan that
// got one field wrong should still deliver the ones it got right, and a suggestion that is not there
// is a field the person fills in themselves.
describe('knownSuggestions', () => {
  it('keeps a whole, well-typed suggestion', () => {
    const body = {
      answers: { what: 'a timeline of releases', who: 'the team' },
      kind: 'web',
      stack: 'TypeScript and Vite',
      packages: ['git', 'ripgrep'],
    };

    expect(knownSuggestions(body)).toEqual(body);
  });

  // THE REVIEWER'S OWN CASE. A list answered as prose is the likeliest thing a model does here, and
  // it is the one that killed the screen.
  it('drops a packages list answered as a sentence', () => {
    expect(knownSuggestions({ packages: 'git, ripgrep', kind: 'web' })).toEqual({ kind: 'web' });
  });

  it('drops the members of a list that are not names, and keeps the rest', () => {
    expect(knownSuggestions({ packages: ['git', 7, null, 'ripgrep'] })).toEqual({
      packages: ['git', 'ripgrep'],
    });
  });

  it('drops a kind or a stack that is not a sentence', () => {
    expect(knownSuggestions({ kind: { name: 'web' }, stack: ['TypeScript'] })).toEqual({});
    expect(knownSuggestions({ kind: 42, stack: null })).toEqual({});
  });

  it('drops an answer that is not a sentence, and keeps its siblings', () => {
    expect(knownSuggestions({ answers: { what: 'a timeline', who: { name: 'the team' }, done: 3 } })).toEqual(
      { answers: { what: 'a timeline' } },
    );
  });

  // The keys it always filtered, still filtered: a `step` or a `mode` among them is a run steering
  // the wizard through the one route it has.
  it('still keeps only the keys a suggestion has', () => {
    expect(knownSuggestions({ kind: 'web', step: 'handoff', mode: 'greenfield' })).toEqual({ kind: 'web' });
  });

  it('takes nothing at all from a body that is not an object', () => {
    for (const body of ['a stack, honestly', 42, null, undefined, ['web']]) {
      expect(knownSuggestions(body), JSON.stringify(body) ?? 'undefined').toEqual({});
    }
  });
});
