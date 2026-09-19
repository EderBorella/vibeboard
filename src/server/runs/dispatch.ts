import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isBoxKind } from '../../core/box-kinds.js';
import { resolveCopilotSelection } from '../../core/copilot-choice.js';
import { foundationRel } from '../../core/layout.js';
import { BOARDS, type ProjectConfig } from '../../core/types.js';
import { boardColumnSlugs } from '../../store/cards/board.js';
import { readResources } from '../../store/project/control-files.js';
import { foundationStatus, readGates } from '../../store/project/foundation.js';
import { readSkills } from '../../store/project/skill-catalogue.js';
import type { Backend } from '../agent-turn.js';
import { BASE_IMAGE, imageForKind } from '../boxes/containers.js';
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
  const codeQuality = (await readGates(root)).ok
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
