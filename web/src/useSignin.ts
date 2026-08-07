import { useCallback, useEffect, useState } from 'react';
import { claimSignin, collectSignin, onUnauthorized, requestSignin } from './api';
import { runSignin, type SigninPhase } from './signin';
import { clearToken, hasToken, setToken } from './token';

// One flow per page, not per component. React StrictMode invokes effects twice in development, and a
// second `runSignin` would find the claim already taken by the first and drop this browser into
// "waiting for approval" — for a request nobody made, needing an approval nobody can give.
let inFlight: Promise<boolean> | undefined;

// Exported to be tested: the whole point of it is what happens when two callers overlap, and driving
// that through a rendered component would be testing StrictMode rather than this.
export function once(run: () => Promise<boolean>): Promise<boolean> {
  inFlight ??= run().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

export interface Signin {
  signedIn: boolean;
  phase: SigninPhase;
  // Offered only where trying again could work — never after a refusal, which is a decision.
  retry: () => void;
}

export function useSignin(): Signin {
  // Read once, synchronously: a browser that already has a credential must not flash the sign-in
  // screen on every load, and an effect would.
  const [signedIn, setSignedIn] = useState(() => hasToken());
  const [phase, setPhase] = useState<SigninPhase>(() =>
    hasToken() ? { phase: 'in' } : { phase: 'claiming' },
  );

  const start = useCallback((): void => {
    setPhase({ phase: 'claiming' });
    void once(() =>
      runSignin({
        claim: claimSignin,
        request: requestSignin,
        collect: collectSignin,
        setToken,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        onPhase: (next) => {
          setPhase(next);
          if (next.phase === 'in') setSignedIn(true);
        },
      }),
    );
  }, []);

  useEffect(() => {
    if (!hasToken()) start();
  }, [start]);

  // A credential that stops working — revoked from another device, or a store that was cleared — drops
  // straight back to the sign-in screen instead of leaving a board on which every button fails, which
  // is the exact bug this feature exists to fix. `api.ts` clears the token before firing this.
  useEffect(() => {
    onUnauthorized(() => {
      clearToken();
      setSignedIn(false);
      start();
    });
  }, [start]);

  return { signedIn, phase, retry: start };
}
