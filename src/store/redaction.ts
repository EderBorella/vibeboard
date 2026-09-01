// Taking a run's credential back out of anything that gets persisted.
//
// A run's credential is only its own while it stays out of the files under `.vibeboard/`. Transcripts,
// run reports and copilot chats all land there, that folder is denied to agents for WRITING but not for
// reading, and an agent that echoes its token — quoting the prompt back, pasting a failed curl — would
// otherwise hand a concurrent run a working key. The report is worse than the transcript: it becomes
// part of the run record, which is written to disk AND broadcast over the websocket, and `expireRun`
// fires after it is folded in, so the value is live at the moment it is written and dead but permanent
// afterwards.
//
// One home, because this is a security property and four independently-written copies is four places
// for one of them to be dropped. Two shapes, deliberately: text for what is already a string, and
// whole-event for structured data.

export const REDACTED = '[credential redacted]';

// Every occurrence, not the first: a token quoted twice is a token leaked once.
export function redact(text: string, token?: string): string {
  return token ? text.replaceAll(token, REDACTED) : text;
}

// The same, for an event on its way to `.vibeboard/chat/`.
//
// Whole-event rather than per-field: the token can appear in assistant prose, in a tool result, or in
// an error, and enumerating the fields it might reach is the kind of list that goes stale. The event is
// returned unchanged — by identity — when there is nothing to take out, so a redaction that does
// nothing costs no round trip through JSON.
export function redactCredential<T>(event: T, token: string | undefined): T {
  if (!token) return event;
  const raw = JSON.stringify(event);
  if (!raw.includes(token)) return event;
  return JSON.parse(redact(raw, token)) as T;
}
