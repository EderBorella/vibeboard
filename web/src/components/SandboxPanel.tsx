import { useState } from 'react';
import { restartOpencodeServer, type SandboxState, takeOverOpencodeServer } from '../api';

interface Props {
  state: SandboxState;
  // The backend currently selected in Settings. Both actions are OpenCode-only: Claude Code spawns a
  // process per turn and has no persistent server, so a restart button there would be a lie about
  // what it does.
  backend: string;
  onChanged: () => void;
}

// What the OS enforces on agents, stated plainly, plus the two actions that can change it.
//
// Its own component rather than more markup inside SettingsModal: it owns a fetch, two async
// actions and their error state, and it is the part of Settings most worth testing directly.
export function SandboxPanel({ state, backend, onChanged }: Props) {
  const [busy, setBusy] = useState<'restart' | 'takeover' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(which: 'restart' | 'takeover'): Promise<void> {
    setBusy(which);
    setError(null);
    try {
      await (which === 'restart' ? restartOpencodeServer() : takeOverOpencodeServer());
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const opencode = backend === 'opencode';

  return (
    <>
      <div className="settings-section">Agent sandbox</div>
      <div className="field">
        {state.ok ? (
          <p className="sandbox-state sandbox-ok">
            <strong>Enforced by the OS.</strong> Agents can build your project and cannot write the files that
            govern it — cards and run records, <code>config.yaml</code>, skills, the instructions injected
            into every turn, the project log, or VibeBoard's own credential.
          </p>
        ) : (
          <p className="sandbox-state sandbox-off">
            <strong>Not enforced.</strong> {state.reason} Manual runs and chat still work; auto-pilot will
            refuse to start.
          </p>
        )}
        {/* Shown whenever it is set, not only when the sandbox is missing: a loaded profile is not
            enough on its own, because we never wrapped a server we did not spawn. */}
        {state.backend === 'attached' && (
          <p className="sandbox-state sandbox-off">
            Attached to an OpenCode server VibeBoard did not start ({state.attachedUrl}), so its filesystem
            access cannot be restricted.
          </p>
        )}
      </div>

      {/* Not while attached: `opencodeBaseUrl()` short-circuits to the attached URL, so a restart
          there spawns a managed server nothing will ever talk to — it just holds a port and
          overwrites the pid file, while the UI reports success and the warning above still stands.
          Take-over is the action that actually resolves that state. */}
      {opencode && state.backend === 'managed' && (
        <div className="field sandbox-action">
          <button className="btn-secondary" disabled={busy !== null} onClick={() => act('restart')}>
            {busy === 'restart' ? 'Restarting…' : 'Restart server'}
          </button>
          <p className="sandbox-hint">
            Stops the managed OpenCode server and starts a new one. Any turn in flight is lost. Use it when
            the server is hung or stale, or when it started before the sandbox was installed.
          </p>
        </div>
      )}

      {opencode && state.backend === 'attached' && (
        <div className="field sandbox-action">
          <button className="btn-secondary" disabled={busy !== null} onClick={() => act('takeover')}>
            {busy === 'takeover' ? 'Taking over…' : 'Take over with a managed server'}
          </button>
          <p className="sandbox-hint">
            Stops using <code>VIBEBOARD_OPENCODE_URL</code> and spawns a sandboxed server instead, for this
            session. You set that variable deliberately, most likely for debugging, so nothing does this on
            your behalf — it stays in your <code>.env</code> for next time.
          </p>
        </div>
      )}

      {error && <p className="modal-error">{error}</p>}
    </>
  );
}
