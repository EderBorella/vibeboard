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
// The nested block gets the same treatment, and it is the one an AGENT fills. A MIRROR AND NOT THE
// BOUNDARY, which is the correction: the prefill route filtered its body to these keys and spread
// whatever was under them, and a key list cannot say what a value may be. `SUGGESTION_READERS` below
// is the boundary now, and its own mapped type is what keeps it complete.
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
//
// AND THE VALUE AS WELL AS THE KEY, which it did not check. A model answering "what should the box
// install" in prose puts a STRING under `packages`, where the browser reads a list — `csv()` calls
// `.join` on it and throws while rendering, with no error boundary above the wizard. The screen goes
// blank and STAYS blank, because the bad value is on disk and every reload reproduces it: setup is
// dead until somebody finds and deletes a file they were never told about. Reproduced in review.
//
// A sentence rather than a type: these fields are shown to the person who will overrule them, so a
// `kind` the product has never heard of is a perfectly good suggestion and only a `kind` that is not
// WORDS is not.
const words = (value: unknown): value is string => typeof value === 'string';

// One member at a time, so a list with one bad name still delivers the good ones — the same reading
// the key filter takes. A value that is not a list at all has nothing to salvage and goes whole.
function nameList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter(words) : undefined;
}

function knownAnswers(value: unknown): WizardAnswers | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const given = value as Record<string, unknown>;
  const kept: WizardAnswers = {};
  for (const key of WIZARD_ANSWER_KEYS) {
    const answer = given[key];
    if (words(answer)) kept[key] = answer;
  }
  return kept;
}

// EVERY SUGGESTION FIELD, WITH THE READING THAT MAKES IT SAFE. A map rather than a loop over
// `WIZARD_SUGGESTION_KEYS`, because a list of keys cannot say what a value may BE — and the value is
// the half that was missing. `Required` makes a new field on `WizardSuggestions` fail to compile
// until it has a reader here, which is the guarantee `_everySuggestionFieldIsListed` gives the list.
const SUGGESTION_READERS: {
  [K in keyof Required<WizardSuggestions>]: (value: unknown) => WizardSuggestions[K] | undefined;
} = {
  answers: knownAnswers,
  kind: (value) => (words(value) ? value : undefined),
  stack: (value) => (words(value) ? value : undefined),
  packages: nameList,
};

export function knownSuggestions(body: unknown): WizardSuggestions {
  // Indexing throws on a primitive, and a JSON body is whatever the sender serialised.
  const source = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const [key, reader] of Object.entries(SUGGESTION_READERS)) {
    const value = reader(source[key]);
    if (value !== undefined) picked[key] = value;
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
