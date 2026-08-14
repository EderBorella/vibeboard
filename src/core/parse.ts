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

// Membership in a value union, as a type predicate.
//
// Every value union in this codebase is a `const` array plus a `[number]` type, and every reader of one
// off disk or off the wire needs the same three-part check: it is a string, it is in the list, and the
// compiler should know it afterwards. That was written out by hand a dozen times, in four modules for
// `BoardName` alone. A predicate rather than a boolean because narrowing is the point — a caller that
// gets `true` back and then casts has gained nothing, and the cast is where the wrong list gets used.
//
// `unknown` in, not `string` in: these guards are what stands between JSON somebody posted and a typed
// value, so refusing the wrong TYPE is half of what they are for. The cast inside is the one place the
// widening is done, and it is safe by construction — `includes` is only being asked whether a string is
// in a list of strings.
//
// HERE RATHER THAN BESIDE THE UNIONS IT GUARDS, and the reason is measurement rather than taste:
// `src/core/types.ts` is excluded from mutation testing as type declarations, so putting the one
// remaining body of a dozen guards there would have moved twelve measured checks into an unmeasured
// file. This module is already mutated, and "reading untrusted scalars" is what the guard does.
export function oneOf<T extends string>(values: readonly T[]): (value: unknown) => value is T {
  return (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);
}
