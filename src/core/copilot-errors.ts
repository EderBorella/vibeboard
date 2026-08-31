// WHAT WENT WRONG, IN WORDS A PERSON CAN ACT ON — and whether trying again is worth anything.
//
// A 429 reached the chat as this, verbatim, on 2026-08-31:
//
//   [opencode: UnknownError: {"code":429,"message":"Provider returned error",
//                             "metadata":{"error_type":"rate_limit_exceeded"}}]
//
// Three things were wrong with it and only one is the wording. It rendered as an ordinary assistant
// bubble rather than as an error, because the site that produced it pushed a `text` event. It stated
// the provider's payload rather than the situation. And it offered nothing to do, when the situation
// it described — a rate limit — is the most retryable failure there is.
//
// IN `core/` BECAUSE IT IS A DECISION AND NOT AN I/O. Nothing here imports `node:*`; it is a pure
// function of a string, which is what makes the table below testable without a server, a backend or a
// network. The two callers are `src/server/boxes/opencode-client.ts` and `src/server/agent-turn.ts`.
//
// ONE PLACE FOR BOTH BACKENDS, and that is the same argument `agentStatus` makes on the auto-pilot
// bar: the server computes the sentence and the UI does not reword it, because two descriptions of
// one rule in this codebase have already drifted apart. A backend-specific message would be a second
// vocabulary for one fault.

export type CopilotErrorKind = 'rate_limit' | 'auth' | 'timeout' | 'provider' | 'unknown';

export interface CopilotErrorInfo {
  kind: CopilotErrorKind;
  // What the user reads. A situation and a remedy, never a payload.
  sentence: string;
  // Whether sending the same message again could plausibly work. It gates the Retry button, so a
  // `false` here is the difference between an escape hatch and a button that fails identically.
  retryable: boolean;
}

// MATCHED ON THE RAW TEXT, because that is all any of these backends reliably give us. OpenRouter
// nests a JSON document inside `error.data.message`; Claude Code writes prose to stderr; a socket
// failure is a Node error string. Parsing each shape would be three parsers that each go stale on a
// provider's whim — a substring test over the lot is cruder and survives all three.
//
// ORDER MATTERS AND IS NOT ALPHABETICAL. `auth` is checked before `provider` because a 401 from a
// provider is an auth problem and not a provider outage, and calling it retryable would put a button
// on screen that cannot ever succeed.
const TABLE: [test: RegExp, info: CopilotErrorInfo][] = [
  [
    /\b429\b|rate[ _-]?limit|too many requests|quota|resource[ _-]?exhausted/i,
    {
      kind: 'rate_limit',
      // Names the likely cause, because on this app it usually IS the free tier — and says what to do
      // in the order worth doing it: waiting is free, switching models is not always possible.
      sentence:
        'The provider is rate-limiting this model. Wait a moment and try again, or pick a different model.',
      retryable: true,
    },
  ],
  [
    /\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid[ _-]?api[ _-]?key|authentication/i,
    {
      kind: 'auth',
      // NOT retryable, and this is the row that most needs to say so: the same message sent again
      // fails identically, and a Retry here would teach people the button does nothing.
      sentence: 'The backend rejected the credentials. Sign in again with the CLI, then start a new chat.',
      retryable: false,
    },
  ],
  [
    /timed? ?out|timeout|ETIMEDOUT|deadline/i,
    {
      kind: 'timeout',
      sentence: 'The turn ran out of time before the model answered. Trying again may work.',
      retryable: true,
    },
  ],
  [
    /\b5\d{2}\b|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network/i,
    {
      kind: 'provider',
      sentence: 'The backend could not be reached. It may be a passing fault — try again.',
      retryable: true,
    },
  ],
];

// The raw text is KEPT rather than discarded, appended in parentheses. The sentence is for acting on;
// the payload is for reporting a bug with, and throwing it away would make an unrecognised failure
// undiagnosable — which is the opposite of the problem being fixed. Capped, because a provider that
// returns a stack trace should not push the remedy off the screen.
const RAW_MAX = 200;

export function classifyCopilotError(raw: string): CopilotErrorInfo {
  const text = raw.trim();
  for (const [test, info] of TABLE) {
    if (test.test(text)) return { ...info, sentence: `${info.sentence} (${clip(text)})` };
  }
  // UNKNOWN IS RETRYABLE, deliberately. The failure modes we cannot name are dominated by transient
  // ones, and the cost of the two mistakes is not symmetric: a Retry that fails again wastes a click,
  // while a missing Retry on a passing fault sends someone to restart the app.
  return {
    kind: 'unknown',
    sentence: `The turn failed. Trying again may work. (${clip(text)})`,
    retryable: true,
  };
}

function clip(text: string): string {
  return text.length > RAW_MAX ? `${text.slice(0, RAW_MAX)}…` : text;
}
