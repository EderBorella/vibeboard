import {
  type AutopilotConfig,
  isBlockedColumn,
  isTerminalColumn,
  ROLLUP_ACTIONS,
  type Rollup,
  type Route,
  VERIFY_MODES,
} from './autopilot.js';
import { boardColumnSlugs } from './board.js';
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

function positive(name: string, value: unknown, out: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    out.push(`${name} must be a positive number; it is ${JSON.stringify(value)}.`);
  }
}

function checkNumbers(ap: AutopilotConfig, out: string[]): void {
  positive('maxIterations', ap.maxIterations, out);
  positive('runTimeoutMs', ap.runTimeoutMs, out);
  positive('attemptCap', ap.attemptCap, out);
  positive('checkupEvery', ap.checkupEvery, out);
  positive('autoPilotConcurrency', ap.autoPilotConcurrency, out);
  // budgetUsd alone may be zero: for a subscription-backed or local model the figure is zero or not
  // what you are billed, and then maxIterations is the cap actually bounding the project.
  if (typeof ap.budgetUsd !== 'number' || !Number.isFinite(ap.budgetUsd) || ap.budgetUsd < 0) {
    out.push(`budgetUsd must be zero or more; it is ${JSON.stringify(ap.budgetUsd)}.`);
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
  if (route.skill.trim() === '') out.push(`${on} names no skill.`);
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

// The four ways a card in a column can be acted on. `advance` is the fourth: a product card in
// In Progress is moved by the rollup and by no route, so without this it reads as unreachable.
// `eligible` deliberately does NOT count — it gates a route rather than replacing one, and a column
// covered only by an eligibility rule is a column whose cards become eligible for nothing.
function checkCover(ap: AutopilotConfig, columns: Record<BoardName, string[]>, out: string[]): void {
  for (const board of BOARDS) {
    for (const slug of columns[board]) {
      const routed = ap.routes.some((r) => r.board === board && r.column === slug);
      const rolledUp = ap.rollup.some(
        (r) => r.board === board && r.column === slug && r.action === 'advance',
      );
      if (routed || rolledUp || isTerminalColumn(ap, board, slug) || isBlockedColumn(ap, board, slug)) {
        continue;
      }
      out.push(
        `${board}: the column "${slug}" is neither routed, terminal nor blocked — cards there would never become eligible.`,
      );
    }
  }
}

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

// A card that advances has to arrive somewhere finished. Advancing into a live column would move it
// out of the reach of its own rollup and back into a phase it has already been through.
function checkAdvanceTarget(
  ap: AutopilotConfig,
  rule: Rollup,
  here: string[],
  where: string,
  out: string[],
): void {
  if (rule.next === undefined) {
    out.push(`The rollup rule on ${where} advances a card but names no column to advance it to.`);
    return;
  }
  if (!here.includes(rule.next)) {
    out.push(`The rollup rule on ${where} advances to "${rule.next}", which is not a column on that board.`);
    return;
  }
  if (!isTerminalColumn(ap, rule.board, rule.next)) {
    out.push(`The rollup rule on ${where} advances to "${rule.next}", which is not terminal.`);
  }
}

function checkRollupRule(
  ap: AutopilotConfig,
  rule: Rollup,
  columns: Record<BoardName, string[]>,
  out: string[],
): void {
  if (!(BOARDS as readonly string[]).includes(rule.board)) {
    out.push(`A rollup rule names the board "${rule.board}", which does not exist.`);
    return;
  }
  const here = columns[rule.board];
  const where = `${rule.board}/${rule.column}`;
  if (!here.includes(rule.column)) {
    out.push(`A rollup rule names the column "${rule.column}", which the ${rule.board} board does not have.`);
  }
  if (rule.when !== 'all-children-terminal') {
    out.push(
      `The rollup rule on ${where} says when: "${rule.when}" — the only condition is all-children-terminal.`,
    );
  }
  if (!(ROLLUP_ACTIONS as readonly string[]).includes(rule.action)) {
    out.push(
      `The rollup rule on ${where} says action: "${rule.action}" — expected ${ROLLUP_ACTIONS.join(' or ')}.`,
    );
    return;
  }
  if (rule.action === 'advance') checkAdvanceTarget(ap, rule, here, where, out);
  // `eligible` gates a route rather than replacing one, so a rule on an unrouted column makes a card
  // eligible for nothing — silently, and only under auto-pilot.
  if (
    rule.action === 'eligible' &&
    !ap.routes.some((r) => r.board === rule.board && r.column === rule.column)
  ) {
    out.push(
      `The rollup rule on ${where} makes a card eligible, but that column has no route to become eligible for.`,
    );
  }
}

export function coverageProblems(config: ProjectConfig): string[] {
  const ap = config.autopilot;
  // Absence is the loudest problem, and the only one worth reporting on its own: every check below
  // would otherwise report the same missing block a dozen different ways.
  if (!ap) return ['This project has no autopilot block in config.yaml, so there is no lifecycle to run.'];
  const columns = {} as Record<BoardName, string[]>;
  for (const board of BOARDS) columns[board] = boardColumnSlugs(config, board);
  const out: string[] = [];
  checkNumbers(ap, out);
  for (const route of ap.routes) checkRoute(route, columns, out);
  checkOneRoutePerPhase(ap, out);
  checkCover(ap, columns, out);
  checkNamedColumns(ap, columns, out);
  for (const rule of ap.rollup) checkRollupRule(ap, rule, columns, out);
  return out;
}

// Separate from the above because it needs the skills folder read, and coverageProblems is pure over
// config alone — it runs inside the config PATCH handler, where a disk read per save is not
// something to add without a reason.
export function skillProblems(ap: AutopilotConfig, skillSlugs: string[]): string[] {
  const have = new Set(skillSlugs);
  return ap.routes
    .filter((r) => !have.has(r.skill))
    .map(
      (r) =>
        `The route on ${r.board}/${r.column} needs a skill called "${r.skill}", and this project has none.`,
    );
}
