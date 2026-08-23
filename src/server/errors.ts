// What a caller is told when something threw. `catch` receives `unknown` whatever the annotation says,
// so reading `.message` off it is a claim about the thrower rather than a check — and a non-Error
// rejection then throws again inside the handler that exists to report the first failure.
//
// TWO HOMES, this one and web/src/lib/errors.ts, and they are deliberately not shared: the two trees compile
// under different module resolutions, which is the same boundary web/src/lib/shared.ts exists for.
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
