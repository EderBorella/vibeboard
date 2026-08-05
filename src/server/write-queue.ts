// One writer at a time, per key.
//
// Two modules need this and for the same reason: a project file with more than one writer, where the
// write is not a single atomic call. The diary appends; the auto-pilot state does read-modify-write. Both
// lose data without it, differently — appends arrive out of order, and an update overwrites one it never
// read.
//
// Deliberately NOT a lock on disk. This serialises the writers inside ONE process, which is what both
// callers need today: every write to either file goes through the server, including the ones slice C's
// service makes, because it reaches the board over HTTP like anything else. A separate process writing
// either file directly would need a real lock, and that is a decision for the slice that introduces one
// rather than a mechanism built here for nobody.

const chains = new Map<string, Promise<unknown>>();

// Runs `fn` after everything already queued under `key`, and answers with its result. A rejection reaches
// the caller that queued it and nobody else: the stored link is deliberately caught, so one failed write
// cannot poison every write behind it.
export function serialise<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const mine = previous.then(fn, fn);
  chains.set(
    key,
    mine.catch(() => undefined),
  );
  return mine;
}
