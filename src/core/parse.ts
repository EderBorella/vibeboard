// Reading untrusted scalars — frontmatter somebody hand-edited, JSON somebody posted — into the shapes
// the rest of the code is allowed to assume.

// An optional string field, or `undefined`. Three modules wrote this out identically and a fourth wrote
// a drifted version of it, so it is here rather than anywhere that owns one of the shapes.
//
// ABSENT AND BLANK ARE THE SAME ANSWER, deliberately: a `detail:` line with nothing after it, or one
// holding only spaces, is a field somebody started and did not finish, and carrying it as `''` makes
// every reader downstream decide again whether an empty string counts. `undefined` is the one answer
// the optional-field shapes already handle.
//
// TRIMMED, and it is the trimmed value that is returned. `core/autopilot-state.ts` used to have a copy
// that tested `value.trim() !== ''` and then returned `value` — so a stop detail arrived at the halt
// overlay carrying whatever padding the file had. That is now this behaviour, which is the one the
// other three always had.
export function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text === '' ? undefined : text;
}
