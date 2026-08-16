import type { RunUsage } from '../../core/runs.js';

// WHOSE FAILURE A DEAD RUN WAS, decided from what the process left behind and nothing else.
//
// `#endWithoutReport` in agent-runner.ts already recognised this exact shape well enough to write "The
// agent exited with code 1 and wrote no report" — it simply never said whose fault it was, and every
// reader downstream took the silence to mean the card's. Measured 2026-08-15: a box holding a
// credential whose inode had been replaced on the host failed nine runs, auto-pilot charged all three
// of one card's attempts to them, and then stopped saying that CARD had used its attempts and someone
// should change what it asks for. Nothing had ever read the card.
//
// THE TWO RECORDS THIS IS DERIVED FROM, the same card hours apart:
//
//   healthy run   status success   turns 13   outputTokens 9027   contextTokens 56741   durationMs 126512
//   dead box      status failed    turns  1   outputTokens    0   contextTokens     0   durationMs     57
//
// So "no turns" IS NOT THE DISCRIMINATOR, and a predicate built on it would have classified nothing at
// all: the CLI reports a turn for a run that never opened a connection. What separates the two is that
// the dead one accounted for no tokens in EITHER direction — nothing was sent and nothing came back —
// which is what "the model was never engaged" actually looks like once it is on disk.
//
// Duration is deliberately not consulted. 57ms against 126512ms is the most vivid number in the table
// and the worst rule: it is a threshold nobody can defend the edges of, and a slow box that takes four
// seconds to fail to authenticate is the same failure as one that takes fifty milliseconds.

// What the runner knows about a finished process, and the whole of what this decision may read. A
// separate shape rather than the runner's own locals so the decision can be exercised without spawning
// anything — agent-runner.ts is a 600-line class holding a queue, a credential store and a sandbox,
// and none of that is reachable from a unit test.
export interface RunEnding {
  cancelled: boolean;
  timedOut: boolean;
  // `null` is death by signal rather than an exit — see the guard below for why that is not classified.
  exitCode: number | null;
  // What the backend reported, as it will be written to the record. Absent when it reported nothing.
  usage?: RunUsage;
}

// THE MODEL WAS NEVER ENGAGED, so the work never had its chance and the card is not answerable for it.
//
// EVERY CLAUSE FAILS TOWARDS "the agent's own", because that is the direction that cannot run away: an
// unclassified failure still burns an attempt, so a case this misses costs a card one attempt it did
// not deserve, where the reverse hands a card that genuinely cannot be done unlimited retries and it
// never reaches a person. Conservative here means silent, not generous.
//
// - CANCELLED is already not-burning (accounting.ts) and is a decision a person took. Re-labelling it
//   as the machine's failure would put a run somebody deliberately stopped into the streak that halts
//   the whole project.
// - TIMED OUT MUST KEEP BURNING, and accounting.ts calls that mapping load-bearing: recorded as
//   not-burning, a card that hangs every single time retries until the iteration or budget cap takes
//   the whole run down. A run that hung was talking to a model, which is the opposite of this.
// - A ZERO EXIT is not a failure at all — it lands in `attention`, an agent that finished and wrote
//   nothing — and `null` is death by signal, where the exit tells us nothing about how far it got. An
//   OOM kill belongs here in spirit and is not claimed, because nothing on the record distinguishes it
//   from a run somebody killed by hand.
// - ABSENT USAGE IS NOT ZERO USAGE, the same distinction RunUsage itself is built on. A backend that
//   reported nothing has not told us the model was never reached; it has told us nothing. That leaves
//   one known case unclassified — an OpenCode turn that dies with `[opencode failed: fetch failed]` and
//   no stats block — and it stays unclassified until there is a record to derive it from.
export function neverReachedModel(ending: RunEnding): boolean {
  if (ending.cancelled || ending.timedOut) return false;
  if (ending.exitCode === null || ending.exitCode === 0) return false;
  const usage = ending.usage;
  if (usage === undefined) return false;
  return usage.outputTokens === 0 && usage.contextTokens === 0;
}

// The line the harness printed on its way out, which is the whole reason the user asked for this: "The
// agent exited with code 1" sends a reader to the card, and "Failed to authenticate: OAuth session
// expired and could not be refreshed" sends them to the one place that can fix it.
//
// A closing marker carries no information the exit code has not already given — the real transcript's
// last line is `[copilot exited (1)]` — so taking the last text event without this would quote the
// exit code back at the reader in two formats and drop the only sentence that mattered.
const CLOSING = /^\[[^\]]*\bexited\b[^\]]*\]$/;

// A note is a line in a UI and a clause in a log sentence. The transcripts this reads from are already
// redacted of the run's minted token when they are written (agent-runner.ts), so this bound is about
// keeping a note readable rather than about secrets.
const MAX_QUOTED = 200;

// One transcript line, if it is an agent event carrying text. Anything else — a `usage` frame, a
// `result` frame, a line that will not parse — answers nothing rather than being quoted raw: the tail
// is JSONL, and a reader shown `{"kind":"usage","contextTokens":0}` as the reason their run died would
// be worse off than one shown the exit code.
function textEvent(line: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  const event = parsed as { kind?: unknown; text?: unknown };
  if (event.kind !== 'text' || typeof event.text !== 'string') return undefined;
  return event.text;
}

// THE LAST one, not the first. This is only ever asked of a run that reached no model, so the only text
// in the tail is whatever the harness said as it died — and a harness that says two things says the
// specific one second.
export function agentErrorLine(tail: string): string | undefined {
  let last: string | undefined;
  for (const line of tail.split('\n')) {
    const text = textEvent(line.trim());
    if (text === undefined) continue;
    // A single event's text may itself hold newlines: the closing marker arrives as "\n[copilot exited
    // (1)]", so a whole-value trim would leave the marker and a whole-value test would not match it.
    for (const piece of text.split('\n')) {
      const one = piece.trim();
      if (one === '' || CLOSING.test(one)) continue;
      last = one;
    }
  }
  if (last === undefined) return undefined;
  return last.length > MAX_QUOTED ? `${last.slice(0, MAX_QUOTED)}…` : last;
}

// What the record says instead of "the agent exited with code 1 and wrote no report".
//
// It names the machine explicitly. `outcomes.ts` reads this note into a log line as "could not run —
// <note>", and the stop this feeds quotes it verbatim to a person who has been told no card is to
// blame; both of those need the note to say what happened rather than merely that something did.
export function infrastructureNote(ending: RunEnding, tail: string): string {
  const code = `exit code ${ending.exitCode ?? 'unknown'}`;
  const error = agentErrorLine(tail);
  return error === undefined
    ? `The agent never reached a model and its transcript does not say why (${code}).`
    : `The agent never reached a model: ${error} (${code}).`;
}
