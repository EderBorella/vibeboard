import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AutopilotState } from '../../core/autopilot-state.js';
import { unreviewedGatesSentence } from '../../core/autopilot-state.js';
import { isBoxKind } from '../../core/box-kinds.js';
import { resolveCopilotSelection } from '../../core/copilot-choice.js';
import { HALTED_DISPATCH } from '../../core/dispatch-gate.js';
import { foundationRel } from '../../core/layout.js';
import { BOARDS, type ProjectConfig } from '../../core/types.js';
import { boardColumnSlugs } from '../../store/cards/board.js';
import { readResources } from '../../store/project/control-files.js';
import { foundationStatus, readGates } from '../../store/project/foundation.js';
import { readSkills } from '../../store/project/skill-catalogue.js';
import type { Backend } from '../agent-turn.js';
import type { Scope } from '../auth/credentials.js';
import { BASE_IMAGE, imageForKind } from '../boxes/containers.js';
import { attachedOpencodeUrl } from '../boxes/opencode-server.js';
import { agentRefusal } from '../boxes/sandbox.js';
import type { AppCtx } from '../route-context.js';
import type { DispatchInput } from './agent-runner.js';
import type { BoardColumns } from './prompt/index.js';

// WHAT A DISPATCH CARRIES, and it is here rather than in routes.ts because TWO routes compose one now:
// `POST /api/runs` and the wizard's own narrow door, which starts setup's two card-less runs because the
// runs route refuses the browser those by design (decision 77). A route may not import a route —
// test/entry-column.test.ts holds that at zero, and its reason is exactly this shape: the only thing
// anybody reaches for instead is a second copy, and the copy is where the prompt drifts. So the shared
// half moved down here and both routes read it.

export interface DispatchBody {
  board?: string;
  card?: string;
  // A run about the PROJECT rather than a card: the bootstrap, which derives the board from the README and so
  // has no card to be dispatched against (the `bootstrap` row of core/phases.ts). Explicit rather than
  // inferred from a missing `card`, because a request that simply forgot which card it meant must keep getting
  // its 404 — inferring would turn every such mistake into a silently different, more powerful run.
  project?: boolean;
  skill?: string;
  prompt?: string;
  attachments?: string[];
  previous?: string;
  backend?: string;
  model?: string;
  effort?: string;
  mode?: string;
  // WHAT THE LOOP ALREADY DID, for a review run: the gate result and whether the card is in the setup
  // subtree. `unknown` rather than the shape, because a body is whatever was sent — and refused outright
  // from every scope but `service` (ruling 63), which is what stops a review agent talking its own reviewer
  // into a pass.
  review?: unknown;
  // AND WHAT THE LOOP GATHERED for a checkup (ruling 60): its card's children, the blocked ones, the open
  // suggestions and the smoke result. `unknown` and refused from every scope but `service`, for the same reason
  // as `review` — a card run able to supply these could describe its own children.
  checkup?: unknown;
}

// EVERY board's columns, never just the skill's. `Skill.boards` scopes where a skill may be
// dispatched FROM, not where it may write to: the break-down skill is scoped to features and product
// precisely so it can turn one of those cards into engineering cards. Scoping this to `skill.boards`
// would therefore have left the agent guessing at exactly the board it was sent to write to — the
// hole this section exists to close. (An empty `skill.boards` means every board anyway, so half the
// skills would get all three regardless; three short lines is not worth a rule with two answers.)
function everyBoardColumns(config: ProjectConfig): BoardColumns[] {
  return BOARDS.map((board) => {
    // Index-parallel by construction: boardColumnSlugs is a 1:1 map over this same list.
    const slugs = boardColumnSlugs(config, board);
    return {
      board,
      columns: config.boards[board].columns.map((name, i) => ({ name, slug: slugs[i] })),
    };
  });
}

// Everything a dispatch needs that does NOT depend on there being a card: the columns, the resources, the
// foundation documents, and which backend/model/effort a bare request means. One home, because the card path
// and the project path need all of it and a second copy would drift the moment one gained a field.
export async function dispatchFrame(
  root: string,
  config: ProjectConfig,
  body: DispatchBody,
): Promise<
  Pick<
    DispatchInput,
    | 'boardColumns'
    | 'links'
    | 'foundation'
    | 'backend'
    | 'model'
    | 'effort'
    | 'mode'
    | 'attachments'
    | 'express'
    | 'browser'
  >
> {
  // A dispatch may name any of backend/model/effort, or none: the project's saved selection fills
  // the rest, through the same precedence the chat uses.
  const choice = resolveCopilotSelection(config.copilot, {
    backend: body.backend,
    model: body.model,
    effort: body.effort,
  });
  // Only the documents that exist. A path list naming a file that is not there teaches an agent that
  // the paths in this prompt are approximate, and the next one it cannot find it will not look for.
  const foundation = await foundationStatus(root);
  // Inlined under "the gates your work must pass, in full" only if it actually declares gates.
  // `present` means the file exists and is non-empty — so a CODE-QUALITY.md of prose with no `gates:`
  // frontmatter, or frontmatter that will not parse, was handed to the agent under a heading
  // asserting it contained the bar, containing no bar. Readiness would refuse such a project, but
  // nothing on the dispatch path consults readiness.
  const gates = await readGates(root);
  const codeQuality = gates.ok
    ? await readFile(join(root, foundationRel('CODE-QUALITY.md')), 'utf8')
    : undefined;
  const kind = config.box?.kind;
  return {
    boardColumns: everyBoardColumns(config),
    // COMPUTED HERE rather than accepted on the body, which is ruling 63's precedent and the same call
    // `reviewFor` makes below: the project's config already answers this, and a caller able to ask for
    // standard prompts on an express project would be a second answer to it. Spread so the key is absent
    // rather than `false` on a standard project — `exactOptionalPropertyTypes`, and the prompt renders on
    // presence.
    ...(config.autopilot?.mode === 'express' ? { express: true as const } : {}),
    // WHETHER THE PROMPT MAY CLAIM A BROWSER, read off the IMAGE the kind selects rather than off the
    // kind itself: the browser is what the web layer adds, so "is this box the base?" IS the question,
    // and the box and the sentence describing it cannot then disagree. A kind that is absent — or that
    // is not a kind at all, because config is hand-editable YAML — reads as the default image, which is
    // exactly what `imageForKind` does with it. decision 75.
    browser: imageForKind(isBoxKind(kind) ? kind : undefined) !== BASE_IMAGE,
    links: await readResources(root),
    attachments: Array.isArray(body.attachments) ? body.attachments.map(String) : [],
    foundation: {
      paths: foundation.present.map(foundationRel),
      ...(codeQuality ? { codeQuality } : {}),
      ...(gates.ok ? { gates: gates.gates } : {}),
    },
    backend: choice.backend as Backend,
    model: choice.model,
    effort: choice.effort,
    mode: body.mode ?? 'bypassPermissions',
  };
}

// A run about the project. No card, no card file, no linked cards and no previous run: there is no card for any
// of them to hang off, and `resolvePrevious` needs a board to find one on.
//
// ITS SECOND CALLER IS THE WIZARD'S DOOR, which starts two project runs of its own (`POST /api/wizard/run`) and
// cannot come through `POST /api/runs` — `dispatchRefusal` there refuses a card-less run to everyone but the
// loop, the browser included, and that guard is not being loosened. decision 77.
// Why this dispatch cannot happen right now, or nothing. Separated from the handler because it is a
// rule rather than plumbing, and because every sentence has to offer a way forward: a refusal about a
// state the user cannot see and cannot act on is worse than the state itself.
//
// IT LIVES HERE RATHER THAN IN `routes.ts` BECAUSE TWO DOORS ASK IT NOW — `POST /api/runs` and the
// wizard's own `POST /api/wizard/run`, which starts setup's two card-less runs. A route may not import
// a route (test/entry-column.test.ts holds that at zero), so the alternative was a second copy of the
// rule, and a second copy is how one door refuses a running project while the other quietly dispatches
// into it. That is not hypothetical here: the wizard's door shipped with no gate at all.
//
// The SCOPE matters, and it is the whole of C2's change here. `running` means auto-pilot owns this
// project's runner, so a by-hand dispatch is refused (S6: the runner, the concurrency cap and the queue
// are shared, so a manual run would queue ahead of the loop's next one and make `autoPilotConcurrency: 1`
// aspirational). The service dispatching while `running` is not a competing caller — it IS the loop, and
// refusing it would refuse the only state in which it ever works.
//
// `halted` stays absolute. Nothing dispatches, the service included: halted is the state a person has to
// leave deliberately, and a loop that could still dispatch inside it would make the emergency stop a
// suggestion.
// Exported so the rule can be tested directly, for the same reason `allows` is: planting showed the
// halted branch here was held by NOTHING through the app, because agent-runner.ts refuses a halted
// project again on the far side of every await and produces the same sentence. That second guard is
// deliberate defence in depth — but a branch whose removal changes no test is a branch that does not
// work, whatever else happens to catch it.
export function dispatchLock(state: AutopilotState, scope: Scope | undefined): string | undefined {
  // First, and for everyone. Halted is the state a person has to leave deliberately (decision 12); a loop
  // that could still dispatch inside it would make the emergency stop a suggestion.
  if (state.state === 'halted') return HALTED_DISPATCH;
  // The service's authority is CO-TERMINOUS WITH `running`, stated as what is allowed rather than as what
  // is refused. Written the other way round — "not a by-hand caller while running" — it admitted the loop
  // while `idle` and while `stopped`, and `stopped` is what a soft stop produces: the runtime writes it
  // and kills nothing, so the soft stop was enforced by the loop's own cooperation and by no layer at
  // all. A stale token was then a dispatching one for the life of the server.
  if (scope === 'service') {
    if (state.state === 'running') return undefined;
    return `Auto-pilot is ${state.state}, so its loop has no authority to dispatch. Start it from the auto-pilot panel.`;
  }
  if (state.state === 'running') {
    return 'Auto-pilot is running this project, so it owns the runner. Soft-stop it first if you want to dispatch a run by hand.';
  }
  return undefined;
}

// The refusal when an agent has rewritten a gate document and nobody has read it. Named rather than
// inlined so each dispatch handler stays under its complexity budget — flattening beats a suppression —
// and so the sentence, which is the only thing a person sees, can be tested without dispatching. Beside
// `dispatchLock` for the reason given there: both doors ask it.
export function unreviewedGatesRefusal(names: string[] | undefined): string | undefined {
  if (!names || names.length === 0) return undefined;
  // The wording lives in core/autopilot-state.ts, beside the flag it describes. It was written twice
  // before, and only one copy told you how to clear it.
  return unreviewedGatesSentence(names);
}

// EVERYTHING THAT REFUSES AN AGENT BEFORE ANYTHING IS RESOLVED OR WRITTEN, in the order it is asked,
// for every door that starts one. `POST /api/runs` adds two rules of its own about the BODY on top of
// this; the wizard's door adds none. Three guards rather than one would also be three guards each door
// has to remember, and the door that forgot is why this function exists: `POST /api/wizard/run` shipped
// with no gate at all, so with the sandbox refusing it ran setup's agent on the host.
//
// `Pick` rather than the whole context, so the two facts it consults are the two it can consult.
export async function agentDispatchRefusal(
  ctx: Pick<AppCtx, 'sandbox' | 'autopilot'>,
  scope: Scope | undefined,
): Promise<{ code: number; error: string } | undefined> {
  // A run that cannot be confined is a run that does not start. 412 rather than 403 — the request is fine, the
  // machine is not in a state to serve it.
  const refusal = agentRefusal(await ctx.sandbox(), attachedOpencodeUrl());
  if (refusal) return { code: 412, error: refusal };
  // Then the project's own state. Halted means nothing dispatches at all; running means auto-pilot
  // owns this project, and S6 is the reason — the runner, the concurrency cap and the queue are
  // shared, so a manual dispatch would queue ahead of the loop's next one and make
  // `autoPilotConcurrency: 1` aspirational rather than true. Both refusals say what to do instead.
  const state = await ctx.autopilot.current();
  const locked = dispatchLock(state, scope);
  if (locked) return { code: 409, error: locked };
  // AND THE GATES NOBODY HAS READ. Blocking `POST /autopilot/start` alone was not enough: a loop that
  // is ALREADY running dispatches without passing through start, and the verifier re-reads
  // foundation/CODE-QUALITY.md fresh for every card (exec/verify.ts) — so an authorised copilot
  // rewriting it mid-run had its commands executed on the next dispatch, outside the sandbox, as the
  // server's user. "The write is allowed; the execution waits" was false in exactly that window,
  // which is the window an agent is most able to reach.
  //
  // Refusing the dispatch stops the loop with a reason rather than killing it, so the work already in
  // flight finishes and the person is told what to look at.
  const unreviewed = unreviewedGatesRefusal(state.unreviewedGates);
  if (unreviewed) return { code: 412, error: unreviewed };
  return undefined;
}

export async function resolveProjectDispatch(
  root: string,
  config: ProjectConfig,
  body: DispatchBody,
): Promise<{ input: DispatchInput } | { code: number; error: string }> {
  const { skills } = await readSkills(root, config);
  const skill = skills.find((s) => s.slug === body.skill);
  if (!skill) return { code: 404, error: 'No such skill' };
  return {
    input: {
      skill,
      linked: [],
      userPrompt: body.prompt,
      ...(await dispatchFrame(root, config, body)),
    },
  };
}
