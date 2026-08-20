import type { BackendCheck } from './sandbox.js';

// WHETHER THE THING AN AGENT TALKS TO IS ANSWERING, asked before a run rather than discovered by one.
//
// Docker being up and the credential being current says the machine COULD run an agent; neither says the
// backend is alive. Measured 2026-08-16: an OpenCode server was destroyed under a live URL — a second caller
// had asked for the same box with a different spec, so it was removed and rebuilt without its published port
// — and every dispatch then died in 449ms with `[opencode failed: fetch failed]`. Three attempts went in five
// seconds and auto-pilot reported that the README was too thin to derive features from. The top-bar light and
// the auto-pilot bar were both green throughout, because nothing was refusing and nothing had asked.
//
// This is the "asked" half. `credential-freshness.ts` is its sibling and `main.ts` is where both meet the app.
//
// ONE REQUEST, AND NEVER A SPAWN. The URL comes from `knownOpencodeUrl`, which returns a server already
// confirmed up and never starts one: this runs behind the sandbox TTL, on a timer, and a probe that could
// start a server would create the thing it was checking for on a board nobody had dispatched in.

// Short, because three gates consult the sandbox status per dispatch and it sits behind a 1-second TTL. A
// loopback server that has not answered in two seconds is not one a turn should be sent to.
const ASK_TIMEOUT_MS = 2_000;

// Any answer counts. The question is "is something there", not "does it like this path" — `waitForServer`
// takes the same view, and a check stricter than the readiness gate it mirrors would refuse a healthy server
// the day OpenCode renames a route.
const PROBE_PATH = '/app';

export function backendCheck(opts: {
  backend: () => string | undefined;
  url: () => string | undefined;
  fetch?: typeof fetch;
}): BackendCheck {
  return async () => {
    // Asked first, so nothing is requested for a backend this cannot say anything about. Claude Code is
    // spawned per turn: the only way to know it works is to run one, which costs money — so its
    // forward-looking gate is the credential check and this one abstains.
    if (opts.backend() !== 'opencode') return { live: true };
    const base = opts.url();
    // NOBODY HAS STARTED ONE, which is the ordinary state of a project nobody has dispatched in — the server
    // is started by the first turn that needs it. Reporting a fault here would put every fresh project into a
    // refusal it cannot act on.
    if (base === undefined) return { live: true };
    const send = opts.fetch ?? fetch;
    try {
      await send(`${base}${PROBE_PATH}`, { signal: AbortSignal.timeout(ASK_TIMEOUT_MS) });
      return { live: true };
    } catch {
      // The remedy is part of the refusal, as every sentence in sandbox.ts is. The cause is deliberately not
      // guessed at: a removed container, a crashed server and a port that moved all look identical from here,
      // and all three are fixed by the same action.
      return {
        live: false,
        reason:
          'the OpenCode server for this project is not answering — restart it in Settings › Sandbox, or switch backend',
      };
    }
  };
}
