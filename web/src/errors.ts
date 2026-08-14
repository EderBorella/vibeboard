// What a person is shown when something threw. `catch` and `.catch` receive `unknown` — TypeScript
// permits an annotation there and enforces nothing, so `(e: Error) => e.message` is a claim about the
// thrower, not a check. A rejection that is not an Error then either hands the banner `undefined`,
// leaving a pane that says "Loading…" for ever over a failed fetch, or throws a second time inside the
// handler where nothing catches it.
//
// TWO HOMES, this one and src/server/errors.ts, and they are deliberately not shared: the two trees
// compile under different module resolutions, which is the same boundary web/src/shared.ts exists for.
// One line of duplication is the cheap side of that trade.
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
