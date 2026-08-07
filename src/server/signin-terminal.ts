// The terminal's side of sign-in: what the banner says, and the break-glass.
//
// A module with `out`, `on` and `pid` injected, because main.ts is top-level-await script code that no
// test can import — running it starts a server. Everything here is a plain function of its inputs, so
// the banner's words and the signal's effect are both under test.

export interface SigninBannerState {
  // Whether any browser has ever signed in. Drives the whole message: with none, the next page load
  // signs itself in and there is nothing for the user to do.
  empty: boolean;
  devices: number;
  pid: number;
  // VIBEBOARD_TOKEN_FILE is set, so the credential files are somewhere the AppArmor profile has never
  // heard of.
  relocated: boolean;
  sandboxOk: boolean;
}

export const BREAK_GLASS = 'signs every browser out';

// THE TOKEN IS NOT IN HERE, and that is the change. It used to print the URL with `?token=<admin>` in
// it, which put a credential that never expires into terminal scrollback, screen shares, and every
// screenshot of a first run. The browser no longer needs it: it signs itself in.
export function signinBanner(state: SigninBannerState): string[] {
  const lines: string[] = [];
  lines.push(
    state.empty
      ? '  → no browser has signed in yet: open the link and the first one signs itself in'
      : `  → ${state.devices} browser${state.devices === 1 ? '' : 's'} signed in — Settings › Signed-in browsers`,
  );
  // Printed always, because the moment it is needed is the moment the UI cannot be reached to read it.
  lines.push(`  → locked out? kill -USR2 ${state.pid} ${BREAK_GLASS}, and the next page load starts over`);
  // `probeSandbox` answers "ok" for a relocated token file, because it checks the profile and not
  // where the secrets went. Nothing else detects this, so it is said out loud.
  if (state.relocated && state.sandboxOk) {
    lines.push('  → VIBEBOARD_TOKEN_FILE moves the credentials outside the sandbox profile’s deny rules, so');
    lines.push('    agents on this machine can read them. Deny the new path, or unset it.');
  }
  return lines;
}

export interface BreakGlassDeps {
  on: (signal: 'SIGUSR2', handler: () => void) => void;
  out: (line: string) => void;
  clear: () => Promise<void>;
  // Hangs up the sockets those credentials were holding. Without it the browsers stay live on the
  // socket until they next make an HTTP call, which for an idle tab is never.
  closeSockets: () => number;
  onError: (err: unknown) => void;
}

// SIGUSR2, not SIGUSR1: Node reserves USR1 for the debugger and starting the inspector instead of
// signing everyone out would be a memorable surprise.
//
// The way back in when every device is gone — the phone was lost, the laptop was reimaged, or a
// browser profile was wiped. It empties the device store, which re-opens the silent first claim, so
// the next page load on this machine signs itself in.
export function installBreakGlass(deps: BreakGlassDeps): void {
  deps.on('SIGUSR2', () => {
    // Fire-and-forget with its own error path: a signal handler has nobody to return a rejection to,
    // and an unhandled one would take the server down as the answer to "let me back in".
    void deps
      .clear()
      .then(() => {
        const closed = deps.closeSockets();
        deps.out(
          `\n  every browser signed out (${closed} live connection${closed === 1 ? '' : 's'} closed).`,
        );
        deps.out('  the next page load will sign itself in.\n');
      })
      .catch(deps.onError);
  });
}
