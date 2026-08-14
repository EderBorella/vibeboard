import type { AutopilotConfig } from '../autopilot.js';
import type { CardProblem } from '../board.js';
import { hasUnfinishedChildren } from '../derived-status.js';
import type { DeclaredCommands } from '../foundation.js';
import type { Card } from '../types.js';

// WHAT A PERSON READS WHEN THE LOOP STOPS. Split out of the machine because it is a different subject:
// every function here answers "how do we say this" and none of them answers "what do we do", and the
// machine was two-thirds prose by line count while its decision path is a short list of branches.
//
// NOTHING HERE PRODUCES A `TickAction`, deliberately, and that is the boundary rather than a coincidence:
// this module returns English and the machine decides what to do with it. A helper here that answered with
// an action would be a decision filed under prose, which is how the two get mixed back together.
//
// The sentences carry their own reasoning because most of them are corrections. A stop message that names
// a mechanism the product no longer has sends a reader to fix something that is fine, and that is a worse
// failure than the stop itself — so each comment below records what the sentence used to say and why it
// does not say it any more.

// How many unfinished cards a stalled stop names before it stops listing them. Long enough to be
// actionable, short enough that the overlay stays a sentence.
const NAMED = 5;

// MOVED HERE FROM eligibility.ts WITH THE COMPARISON IT GUARDS. Every bound in the machine is now counted by
// the tick — the bootstrap's attempts and each phase's — so this is where the number reaches a comparison.
// The same shape as `invalidCap` in dispatch-gate.ts and for the same reason: `used >= NaN` is false, so a cap
// that is not a number does not raise the limit, it deletes it. Fail closed and name the field.
export function invalidAttemptCap(ap: AutopilotConfig): string | undefined {
  if (Number.isInteger(ap.attemptCap) && ap.attemptCap > 0) return undefined;
  return `attemptCap is ${JSON.stringify(ap.attemptCap)}, which is not a whole number above zero, so no attempt cap can bind. Set it in Settings.`;
}

// FINDING C. Carried here from the deleted eligibility.ts, whose removal in slice 3 would otherwise take the
// only route by which an unreadable card reaches the loop — and Principle 1 says an absence must fail closed.
//
// The sentence is rewritten rather than copied: the old one explained the refusal in terms of the setup
// barrier's eligibility effect, which decision 44 removes. What makes it fail closed now is that the broken
// file could BE the open feature, or a child that would change which story is next.
export function unreadableSentence(problems: CardProblem[]): string {
  const first = problems[0];
  const rest = problems.length > 1 ? ` (and ${problems.length - 1} more)` : '';
  return `${first?.path} could not be read: ${first?.reason}${rest}. Until every card parses, auto-pilot cannot tell where it is on the board — the broken file could be the feature it is in the middle of — so it has stopped rather than guess.`;
}

export const names = (cards: Card[]): string => {
  const shown = cards
    .slice(0, NAMED)
    .map((c) => c.id)
    .join(', ');
  return cards.length > NAMED ? `${shown} (and ${cards.length - NAMED} more)` : shown;
};

export const isAre = (cards: Card[]): string => (cards.length === 1 ? 'is' : 'are');

// Each unfinished card in exactly one bucket, most specific first: a card the loop itself blocked is
// blocked whatever else is true of it.
//
// There is no `barred` bucket. It existed only for the setup barrier's EFFECT ON ELIGIBILITY, which decision
// 44 removes — the barrier is a feature now, worked in its turn like any other — and a sentence about a rule
// that no longer exists is worse than no sentence.
function partitionStuck(
  ap: AutopilotConfig,
  cards: Card[],
  unfinished: Card[],
): { waiting: Card[]; rest: Card[] } {
  const waiting: Card[] = [];
  const rest: Card[] = [];
  for (const card of unfinished) {
    // The same rule that kept it from being worked, read back as a reason. A parent stuck behind one
    // blocked grandchild is the ordinary shape of a stalled board, and calling it unroutable — which is
    // what the first version of this message did — sends the reader to edit a routing table that is fine.
    if (hasUnfinishedChildren(ap, card, cards)) waiting.push(card);
    else rest.push(card);
  }
  return { waiting, rest };
}

// Why the remaining work is stuck, per KIND of stuck. One list of ids with one piece of advice named
// cards the loop had itself blocked and then told the reader to check their routing table — advice that is
// wrong for them. A message about a condition the reader cannot act on is a worse failure than the condition.
// `blocked` comes in SEPARATELY rather than out of `unfinished`, and that is decision 45's repeal: a blocked
// task is settled, so it is no longer part of what stops the project finishing. It is still NAMED, because a
// reader looking at a stalled board needs to know it is there — but the clause claiming it makes `complete`
// unreachable for ever is gone, since that is no longer true.
export function whyStuck(ap: AutopilotConfig, cards: Card[], unfinished: Card[], blocked: Card[]): string {
  const { waiting, rest } = partitionStuck(ap, cards, unfinished);
  const parts: string[] = [];
  if (rest.length > 0) {
    // WHAT ACTUALLY PLACES A CARD, which is not a table the reader can edit. Under ruling 52 the phase table
    // is code and a column dispatches nothing, so "check that every column is routed, terminal or blocked" —
    // which this said — sent the reader to a routing table that no longer decides anything. What leaves a card
    // here is its column: one the phase table has no row for, so no phase claims it and every branch falls
    // through.
    parts.push(
      `Nothing can move ${names(rest)}: ${isAre(rest)} in a column the lifecycle has no phase for — a folder added by hand, or one taken out of the board's columns with cards still in it. Move ${rest.length === 1 ? 'it' : 'them'} to a column the board still has`,
    );
  }
  if (blocked.length > 0) {
    parts.push(
      `${names(blocked)} ran out of attempts and ${isAre(blocked)} in ${ap.blockedColumn}, waiting for you`,
    );
  }
  if (waiting.length > 0) {
    parts.push(
      `${names(waiting)} ${isAre(waiting)} waiting for ${waiting.length === 1 ? 'its' : 'their'} own cards further down to finish`,
    );
  }
  return `${parts.join('. ')}.`;
}

// RULING 66. A gate and a smoke command that are the SAME COMMAND are one check, and the project that produced
// this ruling declared `npm test` as both: four features closed, sixteen tasks delivered, and the product had no
// main and printed nothing. Every link behaved: the gate is whatever CODE-QUALITY.md declares, the tests were
// written by the agents that wrote the code and only import its exported functions, and the smoke result the
// loop hands the feature checkup (ruling 55) carried no information the gate had not already given.
//
// ONE STRING COMPARISON, in code, because the durable half of the remedy — the checkup asked whether the thing
// can be used the way the README describes — is a judgement, and the harness feature is a card an agent has to
// deliver. This is the part that cannot be talked out of, and it is what makes that feature non-optional rather
// than merely present.
//
// A COLLISION, never "no smoke command declared": a project with no gates has nothing for the smoke command to
// collide with, and one with no readable smoke command cannot be STARTED at all — `smoke.ok` is a readiness
// blocker (server/routes/autopilot.ts), so a second refusal here would be about a state the loop cannot reach.
// That is also how a project whose CODE-QUALITY.md declares nothing fails in the honest direction: `readGates`
// answers with a reason rather than a list, `declaredCommands` carries no commands, and nothing collides.
export function smokeIsAGate(commands: DeclaredCommands): string | undefined {
  const smoke = commands.smoke;
  if (smoke === undefined || !commands.gates.includes(smoke)) return undefined;
  return `Every card on this project is done, but the smoke command is the same command as one of its gates (\`${smoke}\`), so nothing has ever run this project the way its README describes — the gates were written beside the code they judge, and they pass over a product with no way to run it. Declare a smoke command in foundation/TESTING.md that exercises the product from outside, and auto-pilot will finish.`;
}
