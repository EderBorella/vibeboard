import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { WIZARD_FILE } from '../../core/layout.js';
import type { ScaffoldMode } from './scaffold.js';

// The union is the contract the web mirrors by hand. A LIST and not a bare union, because a type has
// no runtime value for test/mirror.test.ts to compare the two sides against — the `BOX_KINDS`
// precedent. The order is the order they are walked, and the three agent moments sit where they act:
// `scan` reads the repository before the form it prefills, `stack` proposes once the form has been
// answered, and `gates` holds the person at the commands the copilot just wrote. decision 77.
export const WIZARD_STEPS = ['backend', 'scan', 'form', 'stack', 'docs', 'gates', 'handoff'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export interface WizardAnswers {
  what?: string;
  who?: string;
  done?: string;
}

// Free strings rather than the narrower types config uses for the same two facts: this arrives from a
// repository scan over HTTP, and a `kind` the product does not know must be showable to the person who
// will overrule it rather than refused at the door — nothing here reaches config without their word.
export interface WizardSuggestions {
  answers?: WizardAnswers;
  kind?: string;
  stack?: string;
  packages?: string[];
}

export interface WizardState {
  mode: ScaffoldMode;
  step: WizardStep;
  answers?: WizardAnswers;
  // What an agent proposed, kept apart from what the person said: the form prefills FROM here into
  // empty fields only, so a suggestion can never silently overwrite an answer. decision 77.
  suggested?: WizardSuggestions;
  // The stack as AGREED — after the person approved or overruled the suggestion (W9's whole point:
  // the box's needs are known upfront, from this).
  stack?: string;
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
export const WIZARD_STATE_KEYS = ['mode', 'step', 'answers', 'suggested', 'stack', 'resumes'] as const;
export const WIZARD_ANSWER_KEYS = ['what', 'who', 'done'] as const;
// The nested block gets the same treatment, and it is the one an AGENT fills: `PUT /api/wizard/prefill`
// filters its body to these keys, so this list is a boundary as well as a mirror.
export const WIZARD_SUGGESTION_KEYS = ['answers', 'kind', 'stack', 'packages'] as const;

// `never` when every field is listed; otherwise these lines fail to compile and name the one missed.
type UnlistedWizardField = Exclude<keyof WizardState, (typeof WIZARD_STATE_KEYS)[number]>;
const _everyWizardFieldIsListed: UnlistedWizardField extends never ? true : UnlistedWizardField = true;
void _everyWizardFieldIsListed;
type UnlistedAnswerField = Exclude<keyof WizardAnswers, (typeof WIZARD_ANSWER_KEYS)[number]>;
const _everyAnswerFieldIsListed: UnlistedAnswerField extends never ? true : UnlistedAnswerField = true;
void _everyAnswerFieldIsListed;
type UnlistedSuggestionField = Exclude<keyof WizardSuggestions, (typeof WIZARD_SUGGESTION_KEYS)[number]>;
const _everySuggestionFieldIsListed: UnlistedSuggestionField extends never ? true : UnlistedSuggestionField =
  true;
void _everySuggestionFieldIsListed;

// WHAT A RUN IS ALLOWED TO HAVE SAID. The prefill route spreads its body into a file the browser reads
// back and PUTs whole, so an invented key would ride in `suggested` for the rest of setup — and a
// `step` or a `mode` among them would be a run steering the wizard through the one route it has.
// Filtered rather than refused: a scan that guessed one extra field should still deliver the six that
// were right. decision 77.
export function knownSuggestions(body: unknown): WizardSuggestions {
  // `in` throws on a primitive, and a JSON body is whatever the sender serialised.
  const source = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of WIZARD_SUGGESTION_KEYS) if (key in source) picked[key] = source[key];
  const answers = picked.answers;
  if (answers && typeof answers === 'object') {
    const given = answers as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    for (const key of WIZARD_ANSWER_KEYS) if (key in given) kept[key] = given[key];
    picked.answers = kept;
  }
  return picked as WizardSuggestions;
}

const wizardPath = (root: string): string => join(root, WIZARD_FILE);

// WHAT A MODE IS, SAID ONCE. Both ends of this file's life hand it an `unknown` dressed as a
// `WizardState` — `parse` below, and `req.body` a layer up — and every step after the first branches
// on the answer. A second copy of the pair, in the route, is a second place to change when the type
// gains a third member.
export const isScaffoldMode = (value: unknown): value is ScaffoldMode =>
  value === 'greenfield' || value === 'brownfield';

// Null for absent AND for unreadable, and the CALLER is the reason: `GET /api/wizard` is the only one,
// so a stray brace in this scratch file has to come back as "no setup in progress" and never as a 500.
// Nothing here is in the path of opening a project. What a corrupt file costs is a place in setup,
// which the next step writes back; what a 500 would cost is a browser that cannot tell an absent file
// from an unreachable one — and both of the wizard's Continue buttons are gated on that difference.
export async function readWizardState(root: string): Promise<WizardState | null> {
  try {
    const parsed = parse(await readFile(wizardPath(root), 'utf8')) as WizardState;
    return parsed && typeof parsed === 'object' && isScaffoldMode(parsed.mode) ? parsed : null;
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
