import { useEffect, useState } from 'react';
import { type AppSettings, getAppSettings, setDebugLog } from '../api';
import { errorText } from '../errors';

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAppSettings()
      .then(setSettings)
      .catch((e) => setError(errorText(e)));
  }, []);

  async function toggle(on: boolean): Promise<void> {
    // Not only `disabled` on the control. Until the first answer arrives there is no value to change, so a
    // click in that window would send one read off a default rather than off the server — and `disabled` is
    // presentation: it is what a browser honours, not what this function does. jsdom dispatches the change
    // anyway, which is how the gap showed itself.
    if (settings === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      // The SERVER'S answer, not the value that was sent: the checkbox must show what was saved, so a
      // refused write leaves it where it was rather than showing a state the next start will not honour.
      setSettings(await setDebugLog(on));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="settings-section">Diagnostics</div>
      <div className="settings-hint">
        Auto-pilot's errors are always written to its log, whether this is on or not. Turning it on keeps the
        ordinary tick-by-tick output too, which is what you want when you are working out why the loop did
        something. It applies the next time auto-pilot starts.
      </div>

      <label className="field field-check">
        <input
          type="checkbox"
          checked={settings?.debugLog ?? false}
          disabled={settings === null || busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>Verbose auto-pilot log</span>
      </label>

      {settings && (
        <div className="signin-row">
          <div>
            <div className="signin-row-label">Log files</div>
            <div className="signin-row-meta">
              {settings.autopilotLog ?? 'auto-pilot: not written on this install'}
              <br />
              {settings.serverLog ?? 'server: not written on this install'}
            </div>
          </div>
        </div>
      )}

      {error && <div className="settings-warn">{error}</div>}
    </>
  );
}
