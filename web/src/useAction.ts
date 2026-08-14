import { useCallback, useRef, useState } from 'react';
import { errorText } from './errors';

// One button press that goes to the server: what is in flight, what the server said if it refused,
// and the wrapper that keeps those two in step. Written out eighteen times before this existed, five
// of them as a private generic wrapper around exactly this shape.
//
// The three things every copy agreed on, and this keeps: the busy flag is cleared in a `finally`, so a
// refusal cannot leave a dead disabled button; the previous error is cleared when a new attempt
// starts; and the SERVER'S WORDS are what the user is shown, because a control whose refusal is
// invisible is a dead end.

// A panel with two buttons keys `busy` to WHICH one was pressed, so only that one spins. Where there
// is one button there is one key, and it is `true`.
type ActionKey<K> = [K] extends [true] ? [] : [key: K];

interface Action<K> {
  busy: K | null;
  error: string | null;
  // Resolves true when the call landed. The work that follows a success belongs INSIDE `fn` — it must
  // not run when the call was refused, and only the caller knows what it is.
  run: (fn: () => Promise<void>, ...key: ActionKey<K>) => Promise<boolean>;
  // For a surface that clears its own banner — picking a different row, or a read that failed
  // outside any action.
  setError: (message: string | null) => void;
}

export function useAction<K = true>(
  // For the two surfaces whose failures belong to a parent rather than to a banner of their own.
  report?: (message: string | null) => void,
): Action<K> {
  const [busy, setBusy] = useState<K | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Remade on every render by every caller that passes an inline arrow; a ref keeps `run` stable, so
  // it can be a dependency of the callbacks that wrap it.
  const sink = useRef(report);
  sink.current = report;

  const run = useCallback(async (fn: () => Promise<void>, ...key: ActionKey<K>): Promise<boolean> => {
    const [pressed] = key as unknown[];
    setBusy((pressed ?? true) as K);
    setError(null);
    sink.current?.(null);
    try {
      await fn();
      return true;
    } catch (e) {
      const message = errorText(e);
      setError(message);
      sink.current?.(message);
      return false;
    } finally {
      setBusy(null);
    }
  }, []);

  return { busy, error, run, setError };
}
