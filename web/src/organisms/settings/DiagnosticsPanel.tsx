import { useEffect, useState } from 'react';
import { Control } from '../../atoms/Control';
import { Readout } from '../../atoms/Readout';
import { Text } from '../../atoms/Text';
import { type AppSettings, getAppSettings, setDebugLog } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { useAction } from '../../lib/useAction';
import { Field } from '../../molecules/Field';
import { Notice } from '../../molecules/Notice';
import { Row } from '../shared/Row';

// WHERE TO LOOK WHEN SOMETHING GOES WRONG, and the one switch that changes what is there.
//
// It saves ITSELF, immediately, rather than waiting for the modal's Save button. Two reasons: it is not part
// of the project config that button writes — it is an app-level setting stored outside every project — and
// pressing Save would otherwise send a project-config patch, which can be refused for reasons that have
// nothing to do with this checkbox.
//
// The paths are shown because a log nobody can find is a log nobody reads: the directory depends on where
// VibeBoard is installed and the filename on today's date, so neither is guessable.
export function DiagnosticsPanel() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const { busy, error, run, setError } = useAction();

  // Read once, on open. Not `useFetched`: there is no trigger and so no late answer to drop, and the
  // banner wants the server's words rather than the bare fact that the read failed.
  useEffect(() => {
    getAppSettings()
      .then(setSettings)
      .catch((e: unknown) => setError(errorText(e)));
  }, [setError]);

  async function toggle(on: boolean): Promise<void> {
    // Not only `disabled` on the control. Until the first answer arrives there is no value to change, so a
    // click in that window would send one read off a default rather than off the server — and `disabled` is
    // presentation: it is what a browser honours, not what this function does. jsdom dispatches the change
    // anyway, which is how the gap showed itself.
    if (settings === null || busy !== null) return;
    await run(async () => {
      // The SERVER'S answer, not the value that was sent: the checkbox must show what was saved, so a
      // refused write leaves it where it was rather than showing a state the next start will not honour.
      setSettings(await setDebugLog(on));
    });
  }

  return (
    <>
      <Text caps ink="accent" className="settings-section">
        Diagnostics
      </Text>
      <Text role="hint">
        Auto-pilot's errors are always written to its log, whether this is on or not. Turning it on keeps the
        ordinary tick-by-tick output too, which is what you want when you are working out why the loop did
        something. It applies the next time auto-pilot starts.
      </Text>

      <Field layout="check" label="Verbose auto-pilot log">
        <Control
          type="checkbox"
          checked={settings?.debugLog ?? false}
          disabled={settings === null || busy !== null}
          onChange={(e) => void toggle(e.target.checked)}
        />
      </Field>

      {settings && (
        <Row className="signin-row">
          <div>
            <Text as="div" size="body" break>
              Log files
            </Text>
            <Readout>
              {settings.autopilotLog ?? 'auto-pilot: not written on this install'}
              <br />
              {settings.serverLog ?? 'server: not written on this install'}
            </Readout>
          </div>
        </Row>
      )}

      {error && <Notice tone="warn">{error}</Notice>}
    </>
  );
}
