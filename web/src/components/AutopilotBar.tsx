import { useState } from 'react';
import {
  type AutopilotState,
  acknowledgeGates,
  killAutopilot,
  type RunList,
  softStopAutopilot,
  startAutopilot,
} from '../api';
import { transportModel } from '../autopilot/transport';
import { useReadiness } from '../autopilot/useReadiness';
import { killProjectRequest } from '../confirm/requests';
import { useConfirm } from '../confirm/useConfirm';
import { errorText } from '../errors';
import { AutopilotHelp } from './AutopilotHelp';

interface Props {
  state: AutopilotState | null;
  runs: RunList;
  // Changes when the project does, so readiness is re-asked for the new one.
  bump: number;
  onChanged: () => void;
  // Where the caps and the routing table live. The stops are HERE now — see below.
  onSettings: () => void;
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
export function AutopilotBar({ state, runs, bump, onChanged, onSettings }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // Re-asked whenever the project changes or the loop's state does: fixing a blocker and pressing play
  // should not require a reload, and stopping may have been caused by one.
  // Bumped locally as well, so acknowledging the gate review refetches readiness immediately rather
  // than waiting for whatever else happens to change.
  const [reviewed, setReviewed] = useState(0);
  const { confirm, dialog } = useConfirm();
  const { readiness } = useReadiness(`${bump}:${state?.state ?? 'none'}:${reviewed}`);
  const model = transportModel({ state, runs, readiness, starting: busy });

  function act(): void {
    setBusy(true);
    setError(null);
    const call = model.control.kind === 'stop' ? softStopAutopilot() : startAutopilot();
    void call
      .then(() => onChanged())
      // The server's own words. A refusal names what is missing, and swallowing it turns the button
      // into one that does nothing for no stated reason.
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false));
  }

  // The emergency stop. Asks first, with a dialog that names what dies — including the part people do
  // not expect, that the chat and manual runs stop working too until the project is restarted.
  function kill(): void {
    void confirm(killProjectRequest()).then((ok) => {
      if (!ok) return;
      setBusy(true);
      setError(null);
      void killAutopilot('You stopped everything from the auto-pilot bar.')
        .then(() => onChanged())
        .catch((e: unknown) => setError(errorText(e)))
        .finally(() => setBusy(false));
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
          disabled={model.emergency.disabled || busy}
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

      {error && (
        <div className="ap-bar-error" data-testid="ap-bar-error">
          {error}
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
