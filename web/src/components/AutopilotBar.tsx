import { useState } from 'react';
import {
  type AutopilotState,
  acknowledgeGates,
  type RunList,
  softStopAutopilot,
  startAutopilot,
} from '../api';
import { transportModel } from '../autopilot/transport';
import { useReadiness } from '../autopilot/useReadiness';
import { AutopilotHelp } from './AutopilotHelp';

interface Props {
  state: AutopilotState | null;
  runs: RunList;
  // Changes when the project does, so readiness is re-asked for the new one.
  bump: number;
  onChanged: () => void;
  // Where the caps, the routing table and the emergency stop live. This strip is transport only.
  onSettings: () => void;
}

// The transport strip: play, what it is doing, what is missing, and how it works.
//
// It exists because "hit play and watch it move" was, until now, four clicks into a settings modal and a
// scroll past the copilot and sandbox sections — and the only thing on the board itself was a
// one-word chip whose explanation was in a `title` attribute nobody hovers.
//
// Deliberately NOT the whole panel. Start and stop are the two reversible things; the caps, the routing
// table and the emergency stop stay in Settings, because a kill button on the header is a kill button
// somebody presses by accident.
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
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
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
          title="Caps, routing table, stops"
        >
          Settings
        </button>
      </div>

      {error && (
        <div className="ap-bar-error" data-testid="ap-bar-error">
          {error}
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
            {/*
              The one blocker a person CLEARS rather than fixes: an agent rewrote a document whose
              commands auto-pilot will run outside the sandbox. Offered here, beside the sentence that
              explains it, because a blocker with no way to act on it is a dead end — and the words on
              the button are what is actually being asserted, not "OK".
            */}
            {model.reviewGates && (
              <button
                type="button"
                className="btn-secondary"
                data-testid="ap-review-gates"
                onClick={() => {
                  // No confirm dialog: the words on the button ARE the assertion, and a second
                  // "are you sure?" over the top of them is the kind of prompt people learn to click
                  // through without reading.
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
        </div>
      )}

      {helpOpen && <AutopilotHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
