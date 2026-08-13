import { type AutopilotConfig, isTerminalColumn, type Route, VERIFY_MODES } from './autopilot.js';
import { boardColumnSlugs } from './board.js';
import { LIFECYCLE_SKILLS, PHASES } from './phases.js';
import { BOARDS, type BoardName, type ProjectConfig } from './types.js';

// "Is this lifecycle complete?" — asked before auto-pilot starts, and again on every config change.
//
// This is the gate for the worst failure the design has on record. Engineering's columns are
// Backlog, In Progress, Review, Blocked, Done; the routes cover backlog and review; `in-progress`
// was neither routed nor terminal. Nothing ever made those cards eligible, and "eligible is empty"
// became STOP `complete` — success reported over unfinished work. A column reaches that state by
// ordinary means: a drag, a copilot move, a checkup move, or a restore into a column that is still
// configured but no longer routed.
//
// Every problem is a sentence naming what to change. A list of codes would be a gate whose output
// nobody can act on.

// Is this block even shaped like one? `readConfig` is a bare YAML parse with no validation, so every
// field below is whatever a hand-edited file contains. Exported and called BEFORE anything indexes
// into the block: `{autopilot: {maxIterations: 10}}` produced a 500 "ap.routes is not iterable"
// rather than a sentence, and a validator that crashes is a validator nobody can act on.
export function shapeProblems(ap: AutopilotConfig): string[] {
  const out: string[] = [];
  if (!Array.isArray(ap.routes)) out.push('autopilot.routes must be a list of routes.');
  if (!Array.isArray(ap.terminal) && (typeof ap.terminal !== 'object' || ap.terminal === null)) {
    out.push('autopilot.terminal must name the terminal columns of each board.');
  } else if (Array.isArray(ap.terminal)) {
    // The pre-per-board shape. Named specifically because a flat list looks right and silently
    // un-terminals every board.
    out.push('autopilot.terminal is a flat list; it must name the terminal columns per board.');
  }
  if (typeof ap.blockedColumn !== 'string') out.push('autopilot.blockedColumn must be a column slug.');
  return out;
}

// Whole numbers: every one of these is counted against by an integer, so `attemptCap: 0.5` puts each
// card at its cap before its first run and `checkupEvery: 2.5` is a threshold a counter never equals.
function positive(name: string, value: unknown, out: string[]): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    out.push(`${name} must be a positive whole number; it is ${JSON.stringify(value)}.`);
  }
}

function checkNumbers(ap: AutopilotConfig, out: string[]): void {
  positive('maxIterations', ap.maxIterations, out);
  positive('runTimeoutMs', ap.runTimeoutMs, out);
  positive('attemptCap', ap.attemptCap, out);
  positive('checkupEvery', ap.checkupEvery, out);
  // budgetUsd alone may be zero: for a subscription-backed or local model the figure is zero or not
  // what you are billed, and then maxIterations is the cap actually bounding the project.
  if (typeof ap.budgetUsd !== 'number' || !Number.isFinite(ap.budgetUsd) || ap.budgetUsd < 0) {
    out.push(`budgetUsd must be zero or more; it is ${JSON.stringify(ap.budgetUsd)}.`);
  }
  // A fraction above zero. Zero would pass a critic that judged the work worthless — a gate wired to
  // nothing — and above one is a bar no score can clear, which blocks every critic-verified card.
  const threshold = ap.criticThreshold;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    out.push(
      `criticThreshold must be a fraction above 0 and no more than 1; it is ${JSON.stringify(threshold)}.`,
    );
  }
}

function checkRoute(route: Route, columns: Record<BoardName, string[]>, out: string[]): void {
  if (!(BOARDS as readonly string[]).includes(route.board)) {
    out.push(`A route names the board "${route.board}", which does not exist.`);
    return;
  }
  const here = columns[route.board];
  const on = `${route.board}: the route on "${route.column}"`;
  if (!here.includes(route.column)) {
    out.push(`${route.board}: a route names the column "${route.column}", which that board does not have.`);
  }
  if (!here.includes(route.next)) {
    out.push(`${on} advances to "${route.next}", which is not a column on that board.`);
  }
  if (route.next === route.column) {
    out.push(`${on} advances to itself, so a passing card never moves.`);
  }
  if (!(VERIFY_MODES as readonly string[]).includes(route.verify)) {
    out.push(`${on} verifies with "${route.verify}" — expected ${VERIFY_MODES.join(', ')}.`);
  }
  if (typeof route.skill !== 'string' || route.skill.trim() === '') out.push(`${on} names no skill.`);
}

// Where a passing card ends up has to be somewhere it can continue from. Blocked is not: it is where
// a card goes when it has exhausted its attempts, and it is deliberately unrouted — so a route that
// advances into it moves work that SUCCEEDED into a column nothing will ever pick up again, and the
// run later stops `stalled` over a card that passed.
function checkAdvanceIntoBlocked(ap: AutopilotConfig, route: Route, out: string[]): void {
  if (route.board !== 'engineering' || route.next !== ap.blockedColumn) return;
  out.push(
    `engineering: the route on "${route.column}" advances a PASSING card into "${ap.blockedColumn}", which is where exhausted cards go and is never routed onward.`,
  );
}

// Follow `next` from every routed column and require it to arrive somewhere terminal. The self-loop
// check above is this same question asked one hop deep: with `review -> in-progress` and
// `in-progress -> review` every column is routed, every named column exists, and no card can ever
// finish — it ping-pongs until the iteration cap stops the whole run.
// Walk `next` from one route. Returns the members of the loop it fell into, sorted, or null if the
// walk reached a terminal column or ran out of routes. Sorted because the cycle is identified by its
// MEMBERS rather than by where this particular walk entered it — otherwise review→in-progress and
// in-progress→review are two reports of one loop, and three feeders into it produce three.
function cycleFrom(ap: AutopilotConfig, start: Route, columns: Record<BoardName, string[]>): string[] | null {
  const seen: string[] = [start.column];
  let at = start.next;
  // Bounded by the number of columns: a path longer than that has revisited one.
  for (let step = 0; step <= columns[start.board].length; step++) {
    if (isTerminalColumn(ap, start.board, at)) return null;
    if (seen.includes(at)) return [...seen.slice(seen.indexOf(at))].sort();
    seen.push(at);
    const onward = ap.routes.find((r) => r.board === start.board && r.column === at);
    // No route out and not terminal: checkCover names that column already, so stop rather than
    // report the same gap twice in different words.
    if (!onward) return null;
    at = onward.next;
  }
  return null;
}

function checkReachesTerminal(
  ap: AutopilotConfig,
  columns: Record<BoardName, string[]>,
  out: string[],
): void {
  const named = new Set<string>();
  for (const start of ap.routes) {
    if (!(BOARDS as readonly string[]).includes(start.board)) continue;
    const cycle = cycleFrom(ap, start, columns);
    if (!cycle) continue;
    const key = `${start.board}:${cycle.join(',')}`;
    if (named.has(key)) continue;
    named.add(key);
    out.push(
      `${start.board}: the columns ${cycle.join(', ')} advance into each other and never reach a terminal column.`,
    );
  }
}

// Two routes on one phase is not a tie to break — it is an edit that half-landed.
function checkOneRoutePerPhase(ap: AutopilotConfig, out: string[]): void {
  const seen = new Set<string>();
  for (const route of ap.routes) {
    const key = `${route.board}/${route.column}`;
    if (seen.has(key)) out.push(`${key} has more than one route; a phase runs exactly one skill.`);
    seen.add(key);
  }
}

// NO `checkCover`. It asked whether every column was routed, terminal or blocked — the gate for the
// worst failure on record, where an unrouted `engineering/in-progress` made "nothing eligible" into
// STOP `complete`. It goes with the rollup because a rollup `advance` was the only cover
// `product/in-progress` ever had, and it is safe to go because the failure is structurally absent: a
// column no longer decides anything, the position is derived from the phase table (core/phases.ts),
// and `phaseSkillProblems` below is what now refuses a lifecycle that cannot run.

function checkTerminal(ap: AutopilotConfig, columns: Record<BoardName, string[]>, out: string[]): void {
  for (const board of BOARDS) {
    const slugs = ap.terminal[board] ?? [];
    if (slugs.length === 0) {
      out.push(`terminal names no column for ${board}, so no card on that board could ever finish.`);
    }
    for (const slug of slugs) {
      if (!columns[board].includes(slug)) {
        out.push(
          `terminal names "${slug}" for ${board}, which is not a column on that board — a mistyped terminal column silently makes nothing terminal.`,
        );
        continue;
      }
      // Routed AND terminal is the original false-success bug wearing a different hat: a card that
      // exhausts its attempts there drops out of `eligible` while still reading as finished, so
      // "nothing eligible and nothing non-terminal left" is satisfied and the run stops `complete`
      // over work that failed every attempt.
      if (ap.routes.some((r) => r.board === board && r.column === slug)) {
        out.push(
          `${board}: the column "${slug}" is both routed and terminal, so a card that never passes there would still be reported as finished.`,
        );
      }
    }
  }
}

function checkNamedColumns(ap: AutopilotConfig, columns: Record<BoardName, string[]>, out: string[]): void {
  checkTerminal(ap, columns, out);
  if (!columns.engineering.includes(ap.blockedColumn)) {
    out.push(`blockedColumn is "${ap.blockedColumn}", which is not a column on the engineering board.`);
  }
  if (ap.routes.some((r) => r.board === 'engineering' && r.column === ap.blockedColumn)) {
    out.push(`blockedColumn "${ap.blockedColumn}" is also routed; a blocked card must stay put.`);
  }
  if (isTerminalColumn(ap, 'engineering', ap.blockedColumn)) {
    out.push(
      `blockedColumn "${ap.blockedColumn}" is listed as terminal, which would report blocked work as done.`,
    );
  }
}

// The number checks alone. Exported so a refusal can tell a bad number from an unroutable board and
// offer the right remedy: appending "edit the routing table so every column is routed" to "budgetUsd is
// null" sent a user who had cleared a box in Settings to hand-edit YAML about columns.
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
  // Shape first and alone: every check below indexes into the block, so reporting "routes is not a
  // list" alongside a crash from reading it would be no report at all.
  const malformed = shapeProblems(ap);
  if (malformed.length > 0) return malformed;
  const columns = {} as Record<BoardName, string[]>;
  for (const board of BOARDS) columns[board] = boardColumnSlugs(config, board);
  const out: string[] = [];
  checkNumbers(ap, out);
  for (const route of ap.routes) {
    checkRoute(route, columns, out);
    checkAdvanceIntoBlocked(ap, route, out);
  }
  checkOneRoutePerPhase(ap, out);
  checkNamedColumns(ap, columns, out);
  checkReachesTerminal(ap, columns, out);
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
export function phaseSkillProblems(skillSlugs: string[]): string[] {
  const have = new Set(skillSlugs);
  return LIFECYCLE_SKILLS.filter((skill) => !have.has(skill)).map((skill) => {
    // Every phase that wanted it, in ONE sentence: `break-down` is two phases, and two sentences about one
    // absent file would report one problem twice.
    const phases = PHASES.filter((p) => p.skill === skill).map((p) => p.name);
    const which =
      phases.length === 1 ? `The ${phases[0]} phase needs` : `The ${phases.join(' and ')} phases need`;
    // The remedy is part of the refusal. `seedSkills` writes only into a project whose skills folder is
    // ABSENT — which is what makes deleting a skill permanent — so a project that lost one cannot get it
    // back by reopening, and a sentence that names only the gap is a dead end.
    return `${which} a skill called "${skill}", and this project has none. Add one in the Skills tab.`;
  });
}
