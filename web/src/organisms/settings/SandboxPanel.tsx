import { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Text } from '../../atoms/Text';
import {
  buildAgentImage,
  rebuildBoxes,
  restartOpencodeServer,
  type SandboxState,
  takeOverOpencodeServer,
} from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { useBuildLog } from '../../lib/useBuildLog';
import { useConfirm } from '../../lib/useConfirm';
import { Notice } from '../../molecules/Notice';

interface Props {
  state: SandboxState;
  // The backend currently selected in Settings. The two OpenCode server actions are OpenCode-only:
  // Claude Code spawns a process per turn and has no persistent server, so a restart button there
  // would be a lie about what it does. Rebuilding the boxes is not — every project has boxes.
  backend: string;
  // The socket generation, so the build's progress arrives on the same connection everything else uses.
  // Passed down rather than defaulted for the reason the autopilot state is: `socketFor` is a
  // single-entry last-write-wins cache, and a second key here would replace the tab's socket.
  bump: number;
  onChanged: () => void;
}

// Which button is spinning. Keyed rather than a shared boolean because more than one is on screen at
// once in some states, and a shared flag would spin the wrong one.
type Pressed = 'restart' | 'takeover' | 'rebuild' | 'build';

// What the OS enforces on agents, stated plainly, plus the three actions that can change it.
//
// Its own component rather than more markup inside SettingsModal: it owns a fetch, three async
// actions and their error state, and it is the part of Settings most worth testing directly.
export function SandboxPanel({ state, backend, bump, onChanged }: Props) {
  const { busy, error, run } = useAction<Pressed>();
  const { confirm, dialog } = useConfirm();
  // What the last rebuild actually removed. Reported rather than swallowed: "done" on a project that
  // had no boxes reads as "your problem is fixed", and it is not — the drift is somewhere else.
  const [removed, setRemoved] = useState<number | null>(null);
  // Whether the last build replaced the image, so the panel can say what that does NOT do: a running box
  // keeps the image it was started from, and a panel that went quiet after the build would read as fixed.
  const [rebuilt, setRebuilt] = useState(false);
  // The build's own output, arriving over the socket as `box:build` frames — not in the response, which
  // does not come back for minutes. See `useBuildLog`.
  const build_ = useBuildLog(bump);

  async function act(which: 'restart' | 'takeover'): Promise<void> {
    await run(async () => {
      await (which === 'restart' ? restartOpencodeServer() : takeOverOpencodeServer());
      onChanged();
    }, which);
  }

  // BUILDING THE IMAGE, offered exactly where the refusal appears. The product used to detect this
  // prerequisite, name it, and print `npm run box:build` — a developer command, useless to anyone
  // running an installed copy with no repository. `main.ts` builds it on start; this is for the server
  // that was already running when the image went missing, and for an image whose CLIs have fallen behind
  // this machine's, which the start only reports.
  async function build(): Promise<void> {
    build_.reset();
    await run(async () => {
      const res = await buildAgentImage();
      setRebuilt(!res.already);
      onChanged();
    }, 'build');
  }

  async function rebuild(): Promise<void> {
    const ok = await confirm({
      title: 'Throw this project’s agent boxes away?',
      body: 'Both containers are removed and anything in flight inside them is lost. The next agent turn builds new ones, which takes seconds. The agent IMAGE is not rebuilt — that is offered above when it is missing or out of date, and it takes minutes.',
      action: 'Throw them away',
      danger: true,
    });
    if (!ok) return;
    setRemoved(null);
    await run(async () => {
      const res = await rebuildBoxes();
      setRemoved(res.removed);
      setRebuilt(false);
      onChanged();
    }, 'rebuild');
  }

  const opencode = backend === 'opencode';

  return (
    <>
      <Text caps ink="accent" className="settings-section">
        Agent sandbox
      </Text>
      <div className="vb-field">
        {state.ok ? (
          <Notice as="p" tone="ok">
            {/* This list is a copy. The box's mounts are the source of truth — src/server/containers.ts —
                and it has drifted from this text twice. Change one, change both. */}
            <strong>Every agent runs in a container.</strong> Agents can build your project and cannot write
            the files that govern it — cards and run records, <code>config.yaml</code>, skills, the
            instructions injected into every turn, the project log, suggestions, chat transcripts,
            <code>.git/hooks</code> or <code>.git/config</code>. VibeBoard's own credential is not in the
            container at all. They reach the internet but not your local network.
          </Notice>
        ) : (
          <Notice as="p" tone="warn">
            {/* Said plainly, because it is the whole product on this machine: after the one-path
                ruling there is no degraded mode to fall back to. */}
            <strong>Agents are disabled.</strong> {state.reason} The board, the explorer and these settings
            work normally — but dispatching a run or sending a chat message will be refused until Docker is
            available and the agent image is built.
          </Notice>
        )}
        <ImageBuild
          state={state}
          busy={busy}
          latest={build_.lines[build_.lines.length - 1]}
          onBuild={() => void build()}
        />
        {/* Shown whenever it is set, not only when the sandbox is missing: a working image is not
            enough on its own, because a server we did not spawn is not in a box. */}
        {state.backend === 'attached' && (
          <Notice as="p" tone="warn">
            Attached to an OpenCode server VibeBoard did not start ({state.attachedUrl}), so its filesystem
            access cannot be restricted.
          </Notice>
        )}
      </div>

      {/* Not while attached: `opencodeBaseUrl()` short-circuits to the attached URL, so a restart
          there spawns a managed server nothing will ever talk to — it just holds a port and
          overwrites the pid file, while the UI reports success and the warning above still stands.
          Take-over is the action that actually resolves that state. */}
      {opencode && state.backend === 'managed' && (
        <div className="vb-field">
          <Button className="vb-self-start" size="md" disabled={busy !== null} onClick={() => act('restart')}>
            {busy === 'restart' ? 'Restarting…' : 'Restart server'}
          </Button>
          <Text role="hint">
            Stops the managed OpenCode server and starts a new one. Any turn in flight is lost. Use it when
            the server is hung or stale, or when it started before the sandbox was installed.
          </Text>
        </div>
      )}

      {opencode && state.backend === 'attached' && (
        <div className="vb-field">
          <Button
            className="vb-self-start"
            size="md"
            disabled={busy !== null}
            onClick={() => act('takeover')}
          >
            {busy === 'takeover' ? 'Taking over…' : 'Take over with a managed server'}
          </Button>
          <Text role="hint">
            Stops using <code>VIBEBOARD_OPENCODE_URL</code> and spawns a sandboxed server instead, for this
            session. You set that variable deliberately, most likely for debugging, so nothing does this on
            your behalf — it stays in your <code>.env</code> for next time.
          </Text>
        </div>
      )}

      {/* For BOTH backends, unlike the two above: a box is where every agent runs, whichever CLI is in
          it. It is here because `ensure` ADOPTS a healthy box rather than remaking it, so a box that has
          drifted — a credential file replaced on the host by rename, leaving the mount on a dead inode —
          survives every restart of VibeBoard and there was no other way to be rid of it. */}
      <div className="vb-field">
        <Button className="vb-self-start" size="md" disabled={busy !== null} onClick={() => void rebuild()}>
          {busy === 'rebuild' ? 'Throwing away…' : 'Rebuild the agent boxes'}
        </Button>
        <Text role="hint">
          Removes this project's containers. Anything in flight inside them is lost, and the next agent turn
          builds new ones. The agent <strong>image is not rebuilt</strong> — that is its own action, and it
          takes minutes. Use this when a box is stale rather than missing: an expired credential it will not
          pick up, a mount that no longer points anywhere.
        </Text>
        {rebuilt && (
          <Text role="hint">
            The new agent image is built. Boxes that are already running keep the image they were started from
            — rebuild the agent boxes to move this project onto it.
          </Text>
        )}
        {removed !== null && (
          <Text role="hint">
            {removed === 0
              ? 'There were no boxes for this project, so nothing was removed.'
              : `Removed ${removed} box${removed === 1 ? '' : 'es'}.`}
          </Text>
        )}
      </div>

      {error && (
        <Notice as="p" tone="bad">
          {error}
        </Notice>
      )}
      {dialog}
    </>
  );
}

// THE IMAGE HALF OF THE PANEL: why the image is behind, and the build, when a build is the answer. Its own
// component because each of the two reasons for it changes the button and the hint, and written inline
// they took the panel past the complexity ceiling.
function ImageBuild({
  state,
  busy,
  latest,
  onBuild,
}: {
  state: SandboxState;
  busy: Pressed | null;
  // The build's latest line, if it has printed one.
  latest: string | undefined;
  onBuild: () => void;
}) {
  const missing = state.buildable === true;
  return (
    <>
      {/* Beside either notice above: an image behind this machine still runs agents, and it can be true
          alongside a refusal that has nothing to do with it. */}
      {state.imageStale && (
        <Notice as="p" tone="warn">
          <strong>The agent image is behind this machine.</strong> {state.imageStale}. Agents still run;
          rebuilding gives them the CLIs installed here.
        </Notice>
      )}
      {/* ONLY WHEN A BUILD IS THE ANSWER: `buildable` for the missing-image fault, `imageStale` for an
          image whose CLIs are not this machine's, and nothing else — so this never offers to build against
          a daemon that is not running. A remedy that does not match the fault a person has just read is
          worse than no remedy. */}
      {(missing || state.imageStale) && (
        <>
          <Button
            className="vb-self-start"
            size="md"
            variant="primary"
            disabled={busy !== null}
            onClick={onBuild}
          >
            {busy === 'build' ? 'Building…' : missing ? 'Build the agent image' : 'Rebuild the agent image'}
          </Button>
          <Text role="hint">{missing ? FIRST_BUILD : REBUILD}</Text>
          {/* ONE LINE, THE LATEST. A docker build prints hundreds and this sits in a settings modal:
              what a person needs is evidence it is still moving, not the transcript. */}
          {latest !== undefined && <Text role="hint">{latest}</Text>}
        </>
      )}
    </>
  );
}

const FIRST_BUILD =
  'Runs the build here rather than asking you for a terminal. It takes a few minutes the first time — it downloads a base image and installs both agent CLIs — and the output appears below as it goes. VibeBoard also does this on start, so this is only needed if the image went missing while the server was up.';

const REBUILD =
  'Rebuilds both agent images with the CLI versions installed on this machine. It takes a few minutes and the output appears below as it goes; agents keep running on the current image until it is done.';
