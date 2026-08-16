import { useState } from 'react';
import {
  type AutopilotState,
  acknowledgeGates,
  killAutopilot,
  patchConfig,
  type RunList,
  type SandboxState,
  softStopAutopilot,
  startAutopilot,
} from '../api';
import { killProjectRequest } from '../confirm/requests';
import { useConfirm } from '../confirm/useConfirm';
import { BackendPicker } from '../copilot/BackendPicker';
import { resolveChoice } from '../copilot/choice';
import type { CopilotConfig } from '../shared';
import { useAction } from '../useAction';
import { AutopilotHelp } from './AutopilotHelp';
import { transportModel } from './transport';
import { useReadiness } from './useReadiness';

interface Props {
  state: AutopilotState | null;
  runs: RunList;
  // Changes when the project does, so readiness is re-asked for the new one.
  bump: number;
  // The project's configured backend block. Auto-pilot has no backend of its own: the loop dispatches
  // without naming one and the server fills it from here, so this IS the agent auto-pilot runs — it had
  // simply never been shown on the surface that runs it.
  copilot: CopilotConfig;
  // Whether agents can run at all, already fetched by the shell. Threaded rather than fetched again so
  // there is one answer on screen: a second fetch would be a second opinion with its own refresh
  // schedule, and this bar and the connection light would disagree for the length of it.
  sandbox: SandboxState | null;
  onChanged: () => void;
  // Re-ask the sandbox for the backend just chosen. Separate from `onChanged`, which refreshes the
  // LOOP's state — see the note on the write below for why the distinction is the whole point.
  onBackendChanged: () => void;
  // Where the caps and the routing table live. The stops are HERE now — see below.
  onSettings: () => void;
}

// Headings for the three ways a project can be unable to run an agent. They come from `refusalKind`,
// which exists so the UI can title a refusal without parsing its sentence, and they are the same
// vocabulary the connection light's advice uses — one fault should not have two names depending on
// which corner of the chrome reports it.
const REFUSAL_WORD: Record<'docker' | 'credential' | 'attached', string> = {
  docker: 'No Docker',
  credential: 'Stale sign-in',
  attached: 'Not sandboxed',
};

// WHETHER THE SELECTED AGENT CAN ACTUALLY RUN, in one word and a colour, with the server's own sentence
// underneath it as the tooltip.
//
// The sentence is NOT reworded here. It is computed on the server by the same function the dispatch
// gate calls, so restating it in our own words would be a second description of a rule this bar does
// not enforce — and two descriptions of one rule in this codebase have already drifted apart. Ours is
// the heading; the server's is the detail. That split is the one `lightAdvice` already makes.
//
// `null` is NOT ASKED YET, and must never read as "nothing is wrong". Before the answer arrives the bar
// says it is asking, which is true — showing reassurance would be a lie for the length of a round trip
// and showing an alarm would be a worse one.
export function agentStatus(sandbox: SandboxState | null): {
  word: string;
  tone: 'ok' | 'bad' | 'unknown';
  title: string;
} {
  if (!sandbox) {
    return { word: 'Checking…', tone: 'unknown', title: 'Asking the server whether this agent can run.' };
  }
  if (!sandbox.agentRefusal) {
    return { word: 'Ready', tone: 'ok', title: 'This agent has what it needs to run in this project.' };
  }
  return {
    word: sandbox.refusalKind ? REFUSAL_WORD[sandbox.refusalKind] : 'Blocked',
    tone: 'bad',
    title: sandbox.agentRefusal,
  };
}

// The transport strip: play, what it is doing, what is missing, and how it works.
//
// It exists because "hit play and watch it move" was, until now, four clicks into a settings modal and a
// scroll past the copilot and sandbox sections — and the only thing on the board itself was a
// one-word chip whose explanation was in a `title` attribute nobody hovers.
//
// Deliberately NOT the whole panel — the caps and the routing table stay in Settings. Every CONTROL is
// here, though, including the two that used to be behind that modal:
//
//  - **The emergency stop.** It was Settings-only, on the reasoning that a kill button on the header is
//    one somebody presses by accident. That trade was wrong: the thing you most want to kill is a loop
//    that is running right now, and reaching it meant opening a modal on top of the board you are
//    watching. The accident is guarded by a confirm dialog that names what dies, which is the right
//    place for that guard.
//  - **The gate acknowledgement.** It was inside this bar's own drawer, behind a disclosure arrow, while
//    Settings had a Start button and no way to clear the block at all. A user hit exactly that: told to
//    read the commands in Project Control, then refused again, with the only control on another surface.
//    It is on the bar now, LAST in the row, so that when it disappears nothing else moves.
export function AutopilotBar({
  state,
  runs,
  bump,
  copilot,
  sandbox,
  onChanged,
  onBackendChanged,
  onSettings,
}: Props) {
  const [open, setOpen] = useState(false);
  // The server's own words on a refusal. A refusal names what is missing, and swallowing it turns the
  // button into one that does nothing for no stated reason.
  const { busy, error, run } = useAction();
  // ITS OWN ACTION, not the transport's. Sharing one would make the play button read "Starting…" and
  // the emergency stop go dead while a backend write is in flight — two controls reporting an act that
  // is not theirs.
  const { busy: switching, error: switchError, run: runSwitch } = useAction();
  const [helpOpen, setHelpOpen] = useState(false);
  // Re-asked whenever the project changes or the loop's state does: fixing a blocker and pressing play
  // should not require a reload, and stopping may have been caused by one.
  // Bumped locally as well, so acknowledging the gate review refetches readiness immediately rather
  // than waiting for whatever else happens to change.
  const [reviewed, setReviewed] = useState(0);
  const { confirm, dialog } = useConfirm();
  const { readiness } = useReadiness(`${bump}:${state?.state ?? 'none'}:${reviewed}`);
  const model = transportModel({ state, runs, readiness, starting: busy !== null });
  const backend = resolveChoice(copilot, {}).backend;
  const agent = agentStatus(sandbox);

  // ONE SHARED SETTING, WRITTEN TO DISK — and that is the property the whole control stands on.
  //
  // The auto-pilot loop is a separate process that reads `config.copilot.backend` from the file; a
  // selector that only moved browser state would name the thing it does not control, which is worse
  // than having no selector at all. So this writes the same value Settings writes, through the same
  // endpoint, and the consequence is on the buttons: the copilot's default and manual dispatches move
  // with it. The dock's selector stays a session override and follows this one, because
  // `useCopilotChoice` clears its override whenever the configured block changes.
  //
  // The whole block is spread back, not `{ backend }` alone: `backends` holds each agent's remembered
  // model, and the per-backend slots exist to stop one choice discarding the other's.
  function chooseBackend(next: string): void {
    if (next === backend) return;
    void runSwitch(async () => {
      await patchConfig({ copilot: { ...copilot, backend: next } });
      // AFTER the write lands, and it is not optional. `useSandbox` is keyed on the shell's counter,
      // not on the snapshot the server broadcasts here, so without this the status beside the selector
      // keeps answering for the backend just left — switching away from a dead Claude Code to a working
      // OpenCode would leave the bar still saying the project cannot run. Nothing about that is visible
      // by inspection, which is why it has a test of its own.
      onBackendChanged();
    });
  }

  function act(): void {
    void run(async () => {
      await (model.control.kind === 'stop' ? softStopAutopilot() : startAutopilot());
      onChanged();
    });
  }

  // The emergency stop. Asks first, with a dialog that names what dies — including the part people do
  // not expect, that the chat and manual runs stop working too until the project is restarted.
  function kill(): void {
    void confirm(killProjectRequest()).then((ok) => {
      if (!ok) return;
      void run(async () => {
        await killAutopilot('You stopped everything from the auto-pilot bar.');
        onChanged();
      });
    });
  }

  return (
    <div className={`ap-bar ap-bar-${model.tone}`} data-testid="ap-bar">
      <div className="ap-bar-row">
        <button
          type="button"
          className={`ap-transport ap-transport-${model.control.kind}`}
          disabled={model.control.disabled}
          title={model.control.title}
          aria-label={model.control.label}
          onClick={act}
        >
          <span aria-hidden="true">{model.control.kind === 'stop' ? '■' : '▶'}</span>
          {model.control.label}
        </button>

        {/* Beside the transport, because it IS transport — the most destructive kind. Quiet until you
            hover it: a permanently red bar teaches people to stop reading the bar. */}
        <button
          type="button"
          className="ap-kill"
          disabled={model.emergency.disabled || busy !== null}
          title={model.emergency.title}
          data-testid="ap-kill"
          onClick={kill}
        >
          <span aria-hidden="true">✕</span> Emergency stop
        </button>

        <span className={`ap-dot ap-dot-${model.tone}`} aria-hidden="true" />
        <span className="ap-status" data-testid="ap-status">
          {model.status}
        </span>

        {/* WHICH AGENT, and whether that agent can run. The two belong together and neither is useful
            alone: a provider name with no state does not say the run will start, and a state with no
            provider does not say what it is a state OF — which was the position before this, with
            auto-pilot silently taking the copilot's setting and reporting readiness for it under no
            name at all. */}
        <span className="ap-agent" data-testid="ap-agent">
          <BackendPicker
            value={backend}
            disabled={switching !== null}
            label="Which agent auto-pilot runs"
            titleFor={(b) =>
              `Run agents on ${b.label}. Saved as this project's default, so the copilot and manual runs use it too.`
            }
            onChange={chooseBackend}
          />
          <span
            className={`ap-agent-state ap-agent-${agent.tone}`}
            data-testid="ap-agent-state"
            title={agent.title}
          >
            {agent.word}
          </span>
        </span>

        {model.expandable && (
          <button
            type="button"
            className="ap-expand"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            data-testid="ap-expand"
          >
            {open ? '▾' : '▸'} {open ? 'Hide' : 'Details'}
          </button>
        )}
        <button
          type="button"
          className="ap-help-btn"
          onClick={() => setHelpOpen(true)}
          title="How auto-pilot works"
        >
          ? How it works
        </button>
        <button
          type="button"
          className="ap-settings-link"
          onClick={onSettings}
          title="Caps, the columns that mean finished, and where a blocked card goes"
        >
          Settings
        </button>

        {/*
          LAST IN THE ROW, deliberately. It is the one blocker a person CLEARS rather than fixes, so it
          is the one control that vanishes the moment it is used — and anything after it would jump
          leftwards as it went. Nothing is after it.

          It used to live inside this bar's drawer, behind a disclosure arrow, while Settings offered a
          Start button and no way to clear the block at all. A user was told to read the commands in
          Project Control, did, was refused again, and could not find the way out — because the way out
          was on a surface they had no reason to open.

          No confirm dialog: the words on the button ARE the assertion, and a second "are you sure?" over
          the top of them is the kind of prompt people learn to click through without reading.
        */}
        {model.reviewGates && (
          <button
            type="button"
            className="ap-review-gates"
            data-testid="ap-review-gates"
            title="These files hold commands this server runs outside the sandbox, as you. Read them in Project Control first."
            onClick={() => {
              void acknowledgeGates().then(() => {
                setReviewed((n) => n + 1);
                onChanged();
              });
            }}
          >
            I have read the gate commands
          </button>
        )}
      </div>

      {/* One banner for both actions. They cannot be in flight together — each disables its own
          control — and a refused backend write is as much "the server said no" as a refused start. */}
      {(error ?? switchError) && (
        <div className="ap-bar-error" data-testid="ap-bar-error">
          {error ?? switchError}
        </div>
      )}

      {/*
        WHY IT STOPPED, in full and wrapping. Its own block rather than the status line, which is a row:
        one line, ellipsised. These sentences name the branch that could not be created and quote git's
        own output underneath, so truncating them removes exactly the part worth reading — a user hit
        that twice and got the text out of the DOM by hand the second time.
      */}
      {model.detail && (
        <div className="ap-bar-detail" data-testid="ap-bar-detail">
          {model.detail}
        </div>
      )}

      {open && (
        <div className="ap-drawer" data-testid="ap-drawer">
          <div className="ap-drawer-col">
            <div className="ap-drawer-head">Working on</div>
            {model.doing.length === 0 ? (
              <div className="ap-drawer-empty">Nothing is running.</div>
            ) : (
              <ul className="ap-work">
                {model.doing.map((w) => (
                  <li key={w.run}>
                    <strong>{w.label}</strong> · {w.skill}
                    {w.waiting && <span className="ap-waiting"> waiting for a slot</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="ap-drawer-col">
            <div className="ap-drawer-head">Stopping it from starting</div>
            {model.missing.length === 0 ? (
              <div className="ap-drawer-empty">Nothing — it is ready to run.</div>
            ) : (
              <ul className="blockers">
                {model.missing.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {helpOpen && <AutopilotHelp onClose={() => setHelpOpen(false)} />}
      {dialog}
    </div>
  );
}
