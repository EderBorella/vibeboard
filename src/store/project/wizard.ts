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
