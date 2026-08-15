import { useState } from 'react';
import { rebuildBoxes, restartOpencodeServer, type SandboxState, takeOverOpencodeServer } from '../api';
import { useConfirm } from '../confirm/useConfirm';
import { useAction } from '../useAction';

interface Props {
  state: SandboxState;
  // The backend currently selected in Settings. The two OpenCode server actions are OpenCode-only:
  // Claude Code spawns a process per turn and has no persistent server, so a restart button there
  // would be a lie about what it does. Rebuilding the boxes is not — every project has boxes.
  backend: string;
  onChanged: () => void;
}

// Which button is spinning. Keyed rather than a shared boolean because more than one is on screen at
// once in some states, and a shared flag would spin the wrong one.
type Pressed = 'restart' | 'takeover' | 'rebuild';

// What the OS enforces on agents, stated plainly, plus the three actions that can change it.
//
// Its own component rather than more markup inside SettingsModal: it owns a fetch, three async
// actions and their error state, and it is the part of Settings most worth testing directly.
export function SandboxPanel({ state, backend, onChanged }: Props) {
  const { busy, error, run } = useAction<Pressed>();
  const { confirm, dialog } = useConfirm();
  // What the last rebuild actually removed. Reported rather than swallowed: "done" on a project that
  // had no boxes reads as "your problem is fixed", and it is not — the drift is somewhere else.
  const [removed, setRemoved] = useState<number | null>(null);

  async function act(which: 'restart' | 'takeover'): Promise<void> {
    await run(async () => {
      await (which === 'restart' ? restartOpencodeServer() : takeOverOpencodeServer());
      onChanged();
    }, which);
  }

  async function rebuild(): Promise<void> {
    const ok = await confirm({
      title: 'Throw this project’s agent boxes away?',
      body: 'Both containers are removed and anything in flight inside them is lost. The next agent turn builds new ones, which takes seconds. The agent image is not rebuilt — that is `npm run box:build`.',
      action: 'Throw them away',
      danger: true,
    });
    if (!ok) return;
    setRemoved(null);
    await run(async () => {
      const res = await rebuildBoxes();
      setRemoved(res.removed);
      onChanged();
    }, 'rebuild');
  }

  const opencode = backend === 'opencode';

  return (
    <>
      <div className="settings-section">Agent sandbox</div>
      <div className="field">
        {state.ok ? (
          <p className="sandbox-state sandbox-ok">
            {/* This list is a copy. The box's mounts are the source of truth — src/server/containers.ts —
                and it has drifted from this text twice. Change one, change both. */}
            <strong>Every agent runs in a container.</strong> Agents can build your project and cannot write
            the files that govern it — cards and run records, <code>config.yaml</code>, skills, the
            instructions injected into every turn, the project log, suggestions, chat transcripts,
            <code>.git/hooks</code> or <code>.git/config</code>. VibeBoard's own credential is not in the
            container at all. They reach the internet but not your local network.
          </p>
        ) : (
          <p className="sandbox-state sandbox-off">
            {/* Said plainly, because it is the whole product on this machine: after the one-path
                ruling there is no degraded mode to fall back to. */}
            <strong>Agents are disabled.</strong> {state.reason} The board, the explorer and these settings
            work normally — but dispatching a run or sending a chat message will be refused until Docker is
            available and the agent image is built.
          </p>
        )}
        {/* Shown whenever it is set, not only when the sandbox is missing: a working image is not
            enough on its own, because a server we did not spawn is not in a box. */}
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

      {/* For BOTH backends, unlike the two above: a box is where every agent runs, whichever CLI is in
          it. It is here because `ensure` ADOPTS a healthy box rather than remaking it, so a box that has
          drifted — a credential file replaced on the host by rename, leaving the mount on a dead inode —
          survives every restart of VibeBoard and there was no other way to be rid of it. */}
      <div className="field sandbox-action">
        <button className="btn-secondary" disabled={busy !== null} onClick={() => void rebuild()}>
          {busy === 'rebuild' ? 'Throwing away…' : 'Rebuild the agent boxes'}
        </button>
        <p className="sandbox-hint">
          Removes this project's containers. Anything in flight inside them is lost, and the next agent turn
          builds new ones. The agent <strong>image is not rebuilt</strong> — that is{' '}
          <code>npm run box:build</code> and it takes minutes. Use this when a box is stale rather than
          missing: an expired credential it will not pick up, a mount that no longer points anywhere.
        </p>
        {removed !== null && (
          <p className="sandbox-hint">
            {removed === 0
              ? 'There were no boxes for this project, so nothing was removed.'
              : `Removed ${removed} box${removed === 1 ? '' : 'es'}.`}
          </p>
        )}
      </div>

      {error && <p className="modal-error">{error}</p>}
      {dialog}
    </>
  );
}
