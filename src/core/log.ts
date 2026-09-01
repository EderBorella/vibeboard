// The logger PORT: what a subsystem needs of a log, without knowing what writes it.
//
// The implementation is `server/logging.ts` — files, daily rotation, pruning, redaction of a sign-in
// request id out of a URL. None of that is knowledge a store module should have to carry to say "warn
// when a chat cannot be written", so the interface lives below and the implementation satisfies it.
//
// Split out on 2026-09-01 for the same reason as `copilot-event.ts`: `store/chat-store.ts` imported it
// upward, and `tools/check-store-layer.mjs` counts a type-only import as an edge on purpose.
export interface Log {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  fatal(obj: object, msg?: string): void;
  child(bindings: Record<string, unknown>): Log;
}
