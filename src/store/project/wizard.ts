import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { WIZARD_FILE } from '../../core/layout.js';
import type { ScaffoldMode } from './scaffold.js';

// Extended by later phases; the union is the contract the web mirrors by hand. A LIST and not a bare
// union, because a type has no runtime value for test/mirror.test.ts to compare the two sides against
// — the `BOX_KINDS` precedent.
export const WIZARD_STEPS = ['backend', 'form', 'handoff'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export interface WizardAnswers {
  what?: string;
  who?: string;
  done?: string;
}

export interface WizardState {
  mode: ScaffoldMode;
  step: WizardStep;
  answers?: WizardAnswers;
  // Plain-language summaries of the foundation documents, written by the copilot during the loop and
  // dying with this file — stored here rather than beside the documents so they cannot outlive the
  // wizard and drift from what they summarise. decision 76.
  resumes?: Record<string, string>;
}

// THE FIELD SETS AS DATA, so test/mirror.test.ts can hold the browser's hand-mirror to them — an
// interface has no runtime keys, which is the `SNAPSHOT_KEYS` precedent. The steps were already
// guarded and the fields were not, and this is where drift costs the most: `PUT /api/wizard` REPLACES
// the file, so a key the browser's type does not carry is deleted on the next Continue with nothing
// anywhere reporting it. `resumes` is exactly that shape — written by a later phase of the wizard,
// read by this one.
export const WIZARD_STATE_KEYS = ['mode', 'step', 'answers', 'resumes'] as const;
export const WIZARD_ANSWER_KEYS = ['what', 'who', 'done'] as const;

// `never` when every field is listed; otherwise these lines fail to compile and name the one missed.
type UnlistedWizardField = Exclude<keyof WizardState, (typeof WIZARD_STATE_KEYS)[number]>;
const _everyWizardFieldIsListed: UnlistedWizardField extends never ? true : UnlistedWizardField = true;
void _everyWizardFieldIsListed;
type UnlistedAnswerField = Exclude<keyof WizardAnswers, (typeof WIZARD_ANSWER_KEYS)[number]>;
const _everyAnswerFieldIsListed: UnlistedAnswerField extends never ? true : UnlistedAnswerField = true;
void _everyAnswerFieldIsListed;

const wizardPath = (root: string): string => join(root, WIZARD_FILE);

// Null for absent AND for unreadable, and the CALLER is the reason: `GET /api/wizard` is the only one,
// so a stray brace in this scratch file has to come back as "no setup in progress" and never as a 500.
// Nothing here is in the path of opening a project. What a corrupt file costs is a place in setup,
// which the next step writes back; what a 500 would cost is a browser that cannot tell an absent file
// from an unreachable one — and both of the wizard's Continue buttons are gated on that difference.
export async function readWizardState(root: string): Promise<WizardState | null> {
  try {
    const parsed = parse(await readFile(wizardPath(root), 'utf8')) as WizardState;
    return parsed && typeof parsed === 'object' && typeof parsed.mode === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeWizardState(root: string, state: WizardState): Promise<void> {
  await mkdir(dirname(wizardPath(root)), { recursive: true });
  await writeFile(wizardPath(root), stringify(state), 'utf8');
}

export async function clearWizardState(root: string): Promise<void> {
  await rm(wizardPath(root), { force: true });
}
