import { useCallback, useEffect, useState } from 'react';
import { getSigninState, revokeDevice, type SigninDevice, signOutEverything } from '../api';
import { revokeDeviceRequest, signOutEverythingRequest } from '../confirm/requests';
import type { Confirmer } from '../confirm/useConfirm';
import { authToken } from '../token';

interface Props {
  // Asked before either irreversible thing here. Both sign a browser out of a live session, and one
  // of them signs THIS one out. The dialog is rendered by whoever owns the confirmer, so this
  // component only asks.
  confirm: Confirmer['confirm'];
}

// WHERE THE TOKEN STOPS BEING INVISIBLE, and only if you come looking. The user never handles a
// credential to sign in; this panel is the "unless he wants to check in the settings" half.
//
// It is also the only rotation path that exists: the admin token in ~/.vibeboard/token can only be
// replaced by deleting the file and restarting, which is why nothing prints it any more. Signing
// everything out empties the device store, and an empty store re-opens the silent first claim — so the
// next page load on this machine signs itself in again, with no restart and no command.
export function SignInPanel({ confirm }: Props) {
  const [devices, setDevices] = useState<SigninDevice[]>([]);
  const [thisDevice, setThisDevice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback((): void => {
    getSigninState()
      .then((s) => {
        setDevices(s.devices);
        setThisDevice(s.thisDevice);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(load, [load]);

  async function act(key: string, fn: () => Promise<unknown>): Promise<void> {
    setBusy(key);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const others = devices.filter((d) => d.id !== thisDevice);
  const mine = devices.find((d) => d.id === thisDevice);

  return (
    <>
      <div className="settings-section">Signed-in browsers</div>
      <div className="settings-hint">
        The first browser to open this board is let in automatically. Every one after that has to be allowed
        from a browser that is already in.
      </div>

      {mine && (
        <div className="signin-row">
          <div>
            <div className="signin-row-label">
              {mine.label} <span className="signin-this">this browser</span>
            </div>
            <div className="signin-row-meta">
              {mine.address} · signed in {mine.created.slice(0, 10)} · last seen {mine.lastSeen}
            </div>
          </div>
        </div>
      )}

      {others.map((d) => (
        <div className="signin-row" key={d.id}>
          <div>
            <div className="signin-row-label">{d.label}</div>
            <div className="signin-row-meta">
              {d.address} · signed in {d.created.slice(0, 10)} · last seen {d.lastSeen}
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy !== null}
            onClick={() => {
              void confirm(revokeDeviceRequest(d.label)).then((ok) => {
                if (ok) void act(d.id, () => revokeDevice(d.id));
              });
            }}
          >
            Sign out
          </button>
        </div>
      ))}

      {devices.length === 0 && !error && (
        <div className="settings-hint">
          No browser is signed in — this one is using the server's own token from{' '}
          <code>~/.vibeboard/token</code>.
        </div>
      )}

      <div className="settings-section">This browser's token</div>
      <div className="settings-hint">
        You never need this. Anyone holding it can read this board, start agents and edit files in your
        projects on this machine — so treat it like a password, and do not paste it anywhere.
      </div>
      {revealed ? (
        <code className="signin-token">{authToken() || '(this browser has no token)'}</code>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setRevealed(true)}>
          Show token
        </button>
      )}

      <div className="settings-section">Start over</div>
      <div className="settings-hint">
        Signs out every browser above, including this one, and forgets their credentials. The next page load
        on this machine signs itself in again — which is how you replace a credential you think somebody else
        has seen. No restart needed.
      </div>
      <button
        type="button"
        className="btn-secondary"
        disabled={busy !== null}
        onClick={() => {
          void confirm(signOutEverythingRequest(devices.length)).then((ok) => {
            if (ok) void act('clear', signOutEverything);
          });
        }}
      >
        Sign every browser out
      </button>

      {error && <div className="settings-warn">{error}</div>}
    </>
  );
}
