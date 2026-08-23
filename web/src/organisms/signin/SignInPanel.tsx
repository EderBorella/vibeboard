import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../atoms/Button';
import { Chip } from '../../atoms/Chip';
import { Readout } from '../../atoms/Readout';
import { Text } from '../../atoms/Text';
import { getSigninState, revokeDevice, type SigninDevice, signOutEverything } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { useAction } from '../../lib/useAction';
import type { Confirmer } from '../../lib/useConfirm';
import { Notice } from '../../molecules/Notice';
import { Row } from '../shared/Row';
import { revokeDeviceRequest, signOutEverythingRequest } from '../shared/requests';

interface Props {
  // Asked before either irreversible thing here. Both sign a browser out of a live session, and one
  // of them signs THIS one out. The dialog is rendered by whoever owns the confirmer, so this
  // component only asks.
  confirm: Confirmer['confirm'];
}

// WHICH BROWSERS ARE SIGNED IN, and the only rotation path that exists. The admin token in
// ~/.vibeboard/token can only be replaced by deleting the file and restarting, which is why nothing
// prints it any more. Signing everything out empties the device store, and an empty store re-opens the
// silent first claim — so the next page load on this machine signs itself in again, with no restart and
// no command.
//
// There is no "show token" here, and there cannot be: the credential is an HttpOnly cookie, so this
// page genuinely cannot read it. That is the point of the transport rather than a gap in this panel —
// and the alternative was an endpoint whose only job was handing a secret back for display.
export function SignInPanel({ confirm }: Props) {
  const [devices, setDevices] = useState<SigninDevice[]>([]);
  const [thisDevice, setThisDevice] = useState<string | null>(null);
  // Keyed to the row that was pressed: every listed browser has its own button, and one boolean
  // would grey out all of them and spin none.
  const { busy, error, run, setError } = useAction<string>();

  const load = useCallback((): void => {
    getSigninState()
      .then((s) => {
        setDevices(s.devices);
        setThisDevice(s.thisDevice);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, [setError]);

  useEffect(load, [load]);

  async function act(key: string, fn: () => Promise<unknown>): Promise<void> {
    await run(async () => {
      await fn();
      load();
    }, key);
  }

  const others = devices.filter((d) => d.id !== thisDevice);
  const mine = devices.find((d) => d.id === thisDevice);

  return (
    <>
      <div className="settings-section">Signed-in browsers</div>
      <Text role="hint">
        The first browser to open this board is let in automatically. Every one after that has to be allowed
        from a browser that is already in.
      </Text>

      {mine && (
        <Row className="signin-row">
          <div>
            <div className="signin-row-label">
              {mine.label}{' '}
              <Chip pill tone="neutral" className="signin-this">
                this browser
              </Chip>
            </div>
            <Readout>
              {mine.address} · signed in {mine.created.slice(0, 10)} · last seen {mine.lastSeen}
            </Readout>
          </div>
        </Row>
      )}

      {others.map((d) => (
        <Row className="signin-row" key={d.id}>
          <div>
            <div className="signin-row-label">{d.label}</div>
            <Readout>
              {d.address} · signed in {d.created.slice(0, 10)} · last seen {d.lastSeen}
            </Readout>
          </div>
          <Button
            size="md"
            disabled={busy !== null}
            onClick={() => {
              void confirm(revokeDeviceRequest(d.label)).then((ok) => {
                if (ok) void act(d.id, () => revokeDevice(d.id));
              });
            }}
          >
            Sign out
          </Button>
        </Row>
      ))}

      {devices.length === 0 && !error && (
        <Text role="hint">
          No browser is signed in — this one is using the server's own token from{' '}
          <code>~/.vibeboard/token</code>.
        </Text>
      )}

      <div className="settings-section">This browser's credential</div>
      <Text role="hint">
        Held by the browser itself and not readable by this page, so there is nothing here to show, copy or
        leak. You never need to handle it. To replace it, sign every browser out below.
      </Text>

      <div className="settings-section">Start over</div>
      <Text role="hint">
        Signs out every browser above, including this one, and forgets their credentials. The next page load
        on this machine signs itself in again — which is how you replace a credential you think somebody else
        has seen. No restart needed.
      </Text>
      <Button
        size="md"
        disabled={busy !== null}
        onClick={() => {
          void confirm(signOutEverythingRequest(devices.length)).then((ok) => {
            if (ok) void act('clear', signOutEverything);
          });
        }}
      >
        Sign every browser out
      </Button>

      {error && <Notice tone="warn">{error}</Notice>}
    </>
  );
}
