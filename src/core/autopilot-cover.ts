import {
  type AutopilotConfig,
  BLOCKED_BOARDS,
  isLifecycleMode,
  isTerminalColumn,
  LIFECYCLE_MODES,
  type LifecycleMode,
} from './autopilot.js';
import { boardColumnSlugs } from './board/columns.js';
import { LIFECYCLE_SKILLS, MINI_PHASES, PHASES } from './phases.js';
import { BOARDS, type BoardName, type ProjectConfig } from './types.js';

// "Can this project's lifecycle run?" — asked before auto-pilot starts, and again on every config
// change. What is left to check once the lifecycle is code: the numbers that bound a run, the columns
// that mean "finished", the blocked column, and whether every phase has a skill to dispatch.
//
// The routing table's own checks retired with it. The worst failure on record was an unrouted
// `engineering/in-progress` making "eligible is empty" into STOP `complete`, and it is now structurally
// absent rather than validated against: a column decides nothing, and the position is derived from the
// phase table.
//
// Every problem is a sentence naming what to change. A list of codes would be a gate whose output
// nobody can act on.

// Is this block even shaped like one? `readConfig` is a bare YAML parse with no validation, so every
// field below is whatever a hand-edited file contains. Exported and called BEFORE anything indexes
// into the block: `{autopilot: {maxIterations: 10}}` produced a 500 "ap.routes is not iterable"
// rather than a sentence, and a validator that crashes is a validator nobody can act on.
//
// THE `routes` AND `rollup` CLAUSES ARE GONE, and their absence matters more than their presence did:
// they demanded keys the new shape does not have, so with them left in place `ensureAutopilotKeys`
// would backfill nothing and every newly-scaffolded project would stop `stalled` on its first tick
// with "autopilot.routes must be a list of routes."
export function shapeProblems(ap: AutopilotConfig): string[] {
  const out: string[] = [];
  if (!Array.isArray(ap.terminal) && (typeof ap.terminal !== 'object' || ap.terminal === null)) {
    out.push('autopilot.terminal must name the terminal columns of each board.');
  } else if (Array.isArray(ap.terminal)) {
    // The pre-per-board shape. Named specifically because a flat list looks right and silently
    // un-terminals every board.
    out.push('autopilot.terminal is a flat list; it must name the terminal columns per board.');
  }
  if (typeof ap.blockedColumn !== 'string') out.push('autopilot.blockedColumn must be a column slug.');
  // A MISTYPED MODE MUST NOT READ AS `standard`. `ensureAutopilotKeys` backfills an ABSENT key only, so a
  // hand-edited `mode: expres` survives to here — and falling back to the default would run the whole
  // project on the lifecycle the person was trying to leave, silently and at four times the cost. Named,
  // like every other sentence in this file, with what to change.
  if (!isLifecycleMode(ap.mode)) {
    out.push(
      `autopilot.mode must be one of ${LIFECYCLE_MODES.join(' or ')}; it is ${JSON.stringify(ap.mode)}.`,
    );
  }
  // A FOCUS THAT IS NOT AN ID IS NOT A FOCUS. Absent is the ordinary state — the whole board — so only a
  // present value is checked, and an empty string is refused with it: `focus: ''` would confine the loop to
  // a card whose id is the empty string, which no board has, and the sentence it produced would name nothing.
  if (ap.focus !== undefined && (typeof ap.focus !== 'string' || ap.focus.trim() === '')) {
    out.push(
      `autopilot.focus must be the id of a feature card, or absent for the whole board; it is ${JSON.stringify(ap.focus)}.`,
    );
  }
  return out;
}

// Whole numbers: every one of these is counted against by an integer, so `attemptCap: 0.5` puts each
// card at its cap before its first run.
function positive(name: string, value: unknown, out: string[]): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    out.push(`${name} must be a positive whole number; it is ${JSON.stringify(value)}.`);
  }
}

function checkNumbers(ap: AutopilotConfig, out: string[]): void {
  positive('maxIterations', ap.maxIterations, out);
  positive('runTimeoutMs', ap.runTimeoutMs, out);
  positive('attemptCap', ap.attemptCap, out);
  positive('idleMinutes', ap.idleMinutes, out);
  // A timer overflows past about 24 days and fires at once, which would stop every Mini run as it started.
  if (typeof ap.idleMinutes === 'number' && ap.idleMinutes > 1440) {
    out.push(`idleMinutes must be at most 1440, a day; it is ${ap.idleMinutes}.`);
  }
  // budgetUsd alone may be zero: for a subscription-backed or local model the figure is zero or not
  // what you are billed, and then maxIterations is the cap actually bounding the project.
  if (typeof ap.budgetUsd !== 'number' || !Number.isFinite(ap.budgetUsd) || ap.budgetUsd < 0) {
    out.push(`budgetUsd must be zero or more; it is ${JSON.stringify(ap.budgetUsd)}.`);
  }
}

// SIX ROUTING CHECKS WENT WITH THE TABLE: every column is routed/terminal/blocked, a route's columns
// exist, a route that advances to itself, a cycle of routes that never reaches terminal, two routes on
// one phase, and a route advancing a PASSING card into `blocked`. All six asked whether a card could
// get from one column to the next, and a column no longer decides anything — the position is derived
// from the phase table (core/phases.ts). What replaces them is `phaseSkillProblems` below, which asks
// the one question that survives: does every phase have a skill it can dispatch.

function checkTerminal(ap: AutopilotConfig, columns: Record<BoardName, string[]>, out: string[]): void {
  for (const board of BOARDS) {
    const slugs = ap.terminal[board] ?? [];
    if (slugs.length === 0) {
      out.push(`terminal names no column for ${board}, so no card on that board could ever finish.`);
    }
    for (const slug of slugs) {
      if (columns[board].includes(slug)) continue;
      out.push(
        `terminal names "${slug}" for ${board}, which is not a column on that board — a mistyped terminal column silently makes nothing terminal.`,
      );
    }
  }
}

function checkNamedColumns(ap: AutopilotConfig, columns: Record<BoardName, string[]>, out: string[]): void {
  checkTerminal(ap, columns, out);
  // THE COLUMN MUST EXIST — on engineering alone, and that is ruling 59 rather than an oversight. Product
  // gained a blocked column on 2026-08-13 and there is no migration, so every project scaffolded before
  // then has none: demanded here, this would refuse to START a lifecycle that ran perfectly the day
  // before. The stamp fails closed instead and names the missing column (core/tick.ts), which costs one
  // story its carry-on rather than costing the project every feature it has left.
  if (!columns.engineering.includes(ap.blockedColumn)) {
    out.push(`blockedColumn is "${ap.blockedColumn}", which is not a column on the engineering board.`);
  }
  // AND IT MUST NOT BE TERMINAL, on every board that has one. The only one of the routing checks that
  // ever guarded anything real: listing `blocked` under `terminal` is one line that would make a blocked
  // card count as `complete`'s own positive evidence, which is the false success the rest of decision 45's
  // repeal was careful not to open. Per BOARD because `terminal` is per board — and the board is NAMED,
  // or a reader who wrote the line under product would go looking at engineering.
  for (const board of BLOCKED_BOARDS) {
    if (!isTerminalColumn(ap, board, ap.blockedColumn)) continue;
    out.push(
      `blockedColumn "${ap.blockedColumn}" is listed as terminal for ${board}, which would report blocked work as done.`,
    );
  }
}

// The number checks alone. Exported so a refusal can tell a bad number from a bad column and offer the
// right remedy: appending an instruction about columns to "budgetUsd is null" sent a user who had
// cleared a box in Settings to hand-edit YAML.
export function numberProblems(ap: AutopilotConfig): string[] {
  const out: string[] = [];
  checkNumbers(ap, out);
  return out;
}

export function coverageProblems(config: ProjectConfig): string[] {
  const ap = config.autopilot;
  // Absence is the loudest problem, and the only one worth reporting on its own: every check below
  // would otherwise report the same missing block a dozen different ways.
  if (!ap) return ['This project has no autopilot block in config.yaml, so there is no lifecycle to run.'];
  // Shape first and alone: every check below indexes into the block, so reporting "terminal is not a
  // list" alongside a crash from reading it would be no report at all.
  const malformed = shapeProblems(ap);
  if (malformed.length > 0) return malformed;
  const columns = {} as Record<BoardName, string[]>;
  for (const board of BOARDS) columns[board] = boardColumnSlugs(config, board);
  const out: string[] = [];
  checkNumbers(ap, out);
  checkNamedColumns(ap, columns, out);
  return out;
}

// DOES EVERY PHASE HAVE A SKILL TO DISPATCH? Separate from the checks above because it needs the skills
// folder read, and `coverageProblems` is pure over config alone — it runs inside the config PATCH handler,
// where a disk read per save is not something to add without a reason.
//
// Asked of the PHASE TABLE, not of `ap.routes` (ruling 52), which is why it takes no `AutopilotConfig`: the
// lifecycle is code, so which skills a project must have is a fact about the machine rather than about this
// project's config. Readiness used to ask the routing table the same question and could therefore disagree
// with the loop, which reads the table.
//
// A phase whose skill does not exist is the unreachable-column failure one level in: the phase is chosen,
// the dispatch 404s, and nothing can ever advance the card.
// Asked of the phases THIS project's mode walks (decision 100): Mini's two, or everything else.
export function phaseSkillProblems(skillSlugs: string[], mode: LifecycleMode = 'standard'): string[] {
  const have = new Set(skillSlugs);
  const walked = PHASES.filter((p) => MINI_PHASES.includes(p.name) === (mode === 'mini'));
  const needed = LIFECYCLE_SKILLS.filter((skill) => walked.some((p) => p.skill === skill));
  return needed
    .filter((skill) => !have.has(skill))
    .map((skill) => {
      // Every phase that wanted it, in ONE sentence: `break-down` is two phases, and two sentences about one
      // absent file would report one problem twice.
      const phases = walked.filter((p) => p.skill === skill).map((p) => p.name);
      const which =
        phases.length === 1 ? `The ${phases[0]} phase needs` : `The ${phases.join(' and ')} phases need`;
      // The remedy is part of the refusal. `seedSkills` never gives back a skill a project deleted (decision 98),
      // so reopening cannot restore one, and a sentence that names only the gap is a dead end.
      return `${which} a skill called "${skill}", and this project has none. Add one in the Skills tab.`;
    });
}
