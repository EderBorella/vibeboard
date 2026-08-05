import { useEffect, useState } from 'react';
import { type AutopilotState, getReadiness, killAutopilot, type Readiness, softStopAutopilot } from '../api';
import { killProjectRequest } from '../confirm/requests';
import { useConfirm } from '../confirm/useConfirm';
import { useAccounting } from '../runs/useAccounting';
import { type AutopilotConfig, BOARD_LABELS, type ProjectConfig } from '../shared';

// The lifecycle as it will actually be executed, plus what is stopping it.
//
// A routing table nobody can see is the same failure as a gate nobody has watched fail: it looks
// like a decision and behaves like an assumption. Every route is listed, in order, with the skill
// that runs and the column a passing card moves to.
//
// The caps ARE editable now, because they are now enforced: the budget and the iteration cap are
// compared in backend code between dispatches (src/core/dispatch-gate.ts). Until that existed they
// were deliberately read-only — a budget dial wired to nothing is what AutoGPT and AgentGPT both
// shipped, and a control that changes no behaviour tells you the opposite of the truth.
//
// Changes are reported UP rather than saved here, so the modal keeps one Save button and the server's
// refusal — which may be about the routing table, not the number you touched — surfaces in one place.

// The caps, and what each one is for. A table rather than five near-identical blocks of JSX: the only
// things that differ are the bounds and the sentence.
const CAPS = [
  {
    key: 'budgetUsd' as const,
    label: 'Budget (USD)',
    min: 0,
    step: 1,
    hint: 'Auto-pilot stops when the project’s runs have cost this much. Zero means no dollar budget — for a subscription or a local model the reported figure is not what you are billed.',
  },
  {
    key: 'maxIterations' as const,
    label: 'Max dispatches',
    min: 1,
    step: 10,
    hint: 'The cap on how many times auto-pilot may dispatch in one run. This is what bounds a project with no dollar budget.',
  },
  {
    key: 'attemptCap' as const,
    label: 'Attempts per card',
    min: 1,
    step: 1,
    hint: 'How many runs of one skill a card gets before it is blocked. A run you stopped does not count against it.',
  },
  {
    key: 'checkupEvery' as const,
    label: 'Checkup every N dispatches',
    min: 1,
    step: 1,
    hint: 'How often the supervisor reads the board and the diary to judge whether the project is circling.',
  },
];

export function AutopilotPanel({
  config,
  onCaps,
  autopilot,
  onAutopilotChanged,
}: {
  config: ProjectConfig;
  // Called with the whole set of edited caps on every change. The modal merges them into the config's
  // autopilot block and saves once, with everything else.
  onCaps?: (caps: Partial<AutopilotConfig>) => void;
  // The one copy of the state, owned by App. See the note on SettingsModal's props for why the panel
  // must not open its own.
  autopilot: AutopilotState | null;
  onAutopilotChanged: () => void;
}) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [failed, setFailed] = useState(false);
  const hasLifecycle = config.autopilot !== undefined;
  useEffect(() => {
    // Nothing to be ready for without a lifecycle, and the endpoint would only answer with the same
    // sentence the panel already shows. The hook still runs — the early return is inside it, because
    // a conditional hook is a different bug.
    if (!hasLifecycle) return;
    let live = true;
    getReadiness()
      .then((r) => live && setReadiness(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [hasLifecycle]);

  // Seeded from config and edited locally; the modal owns the save. Declared before the early return
  // below, because a hook after a conditional return is a different bug.
  const [caps, setCaps] = useState<Partial<AutopilotConfig>>({});
  const accounting = useAccounting(config);
  // Clamped here, not merely validated on the server. An emptied number box gives `Number('') === NaN`,
  // which `JSON.stringify` puts on the wire as `null`, and `min={0}` on the input does not stop a typed
  // `-5` — so the user cleared a box and got a 400 about column routing. A box that cannot express an
  // invalid value needs no refusal.
  // `max` is for the critic threshold, which is a FRACTION rather than a count: `min` alone would let a
  // typed 5 reach the server, and a bar no score can clear blocks every critic-verified card. Absent
  // for every other field, where there is no upper bound to express.
  const edit = (key: keyof AutopilotConfig, value: number, min: number, max?: number): void => {
    const clamped = Number.isFinite(value) ? Math.max(min, value) : min;
    const next = { ...caps, [key]: max === undefined ? clamped : Math.min(max, clamped) };
    setCaps(next);
    onCaps?.(next);
  };

  const ap = config.autopilot;
  if (!ap) {
    return (
      <>
        <div className="settings-section">Auto-pilot</div>
        <div className="settings-hint">
          This project has no autopilot block in its config, so there is no lifecycle to run. Projects created
          before auto-pilot are upgraded in one pass once the work lands — until then this is an honest
          refusal rather than a half-upgrade.
        </div>
      </>
    );
  }

  return (
    <>
      <div className="settings-section">Auto-pilot</div>
      <div className="settings-hint">
        What runs where. A card in a routed column gets that skill; when the work passes its check it moves to
        the column on the right. Edit these in <code>.vibeboard/config.yaml</code>.
      </div>
      <div className="routes-wrap">
        <table className="routes">
          <thead>
            <tr>
              <th>Board</th>
              <th>Column</th>
              <th>Skill</th>
              <th>Verified by</th>
              <th>Then</th>
            </tr>
          </thead>
          <tbody>
            {ap.routes.map((r) => (
              <tr key={`${r.board}/${r.column}`}>
                <td>{BOARD_LABELS[r.board]}</td>
                <td>{r.column}</td>
                <td>{r.skill}</td>
                <td>{r.verify}</td>
                <td>{r.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="settings-section">Caps</div>
      <div className="settings-hint">
        {/* S10: the number that will actually stop this project, in words. A dollar dial beside a
            budget that can never trip tells the reader the opposite of the truth. */}
        {accounting?.cap?.why ?? 'Whichever of these is reached first will stop the run.'}
      </div>
      {CAPS.map((cap) => (
        <label className="field" key={cap.key}>
          <span>{cap.label}</span>
          <input
            type="number"
            min={cap.min}
            step={cap.step}
            value={caps[cap.key] ?? ap[cap.key]}
            onChange={(e) => edit(cap.key, Number(e.target.value), cap.min)}
          />
          <span className="field-hint">{cap.hint}</span>
        </label>
      ))}
      <label className="field">
        <span>Run timeout (minutes)</span>
        {/* Minutes, because 1800000 in a box is unreadable. The enforceable per-run bound is
            wall-clock: a dollar ceiling per run is not implementable, since usage is only known once
            the run has finished spending it. */}
        <input
          type="number"
          min={1}
          step={5}
          value={Math.round((caps.runTimeoutMs ?? ap.runTimeoutMs) / 60_000)}
          onChange={(e) => edit('runTimeoutMs', Number(e.target.value) * 60_000, 60_000)}
        />
        <span className="field-hint">
          One run is abandoned after this long and recorded as failed, which burns an attempt — a card that
          hangs every time must not retry for ever.
        </span>
      </label>
      <label className="field">
        <span>Critic passes at</span>
        {/* A fraction, not a count, so it gets its own field rather than a row in the table above.
            Visible because it decides every card that has nothing runnable to check: a threshold hidden
            in code is a decision nobody can argue with. */}
        <input
          type="number"
          min={0.05}
          max={1}
          step={0.05}
          value={caps.criticThreshold ?? ap.criticThreshold}
          onChange={(e) => edit('criticThreshold', Number(e.target.value), 0.05, 1)}
        />
        <span className="field-hint">
          How good a critic’s score has to be for a card to advance. Cards with nothing runnable to check
          advance on one model’s opinion, judged by another — this is the number that decides it.
        </span>
      </label>

      <div className="settings-hint">
        Finished at:{' '}
        {Object.entries(ap.terminal)
          .map(([b, c]) => `${b} ${c.join('/')}`)
          .join(', ')}{' '}
        · blocked cards go to {ap.blockedColumn} on engineering.
      </div>

      <StopControls state={autopilot} refresh={onAutopilotChanged} />

      <div className="settings-hint" style={{ marginTop: '0.6rem' }}>
        Before auto-pilot can start:
      </div>
      {readiness === null && !failed && <div className="settings-hint">Checking…</div>}
      {failed && <div className="settings-hint">Could not read this project’s readiness.</div>}
      {readiness?.ok && <div className="ready-ok">Everything auto-pilot needs is in place.</div>}
      {readiness && !readiness.ok && (
        <ul className="blockers">
          {readiness.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </>
  );
}

// Soft stop and emergency stop. The way BACK from a halt is on the overlay rather than here, because a
// halted project is not one you can reach Settings through.
//
// Two buttons rather than one with a modifier: one of these is reversible and the other kills work in
// flight, and that difference should not live in a checkbox.
function StopControls({ state, refresh }: { state: AutopilotState | null; refresh: () => void }) {
  const { confirm, dialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const running = state?.state === 'running';
  const halted = state?.state === 'halted';

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="settings-section">Stopping</div>
      <div className="settings-hint">
        A soft stop leaves the app alone: chat, manual runs and the board carry on, and only dispatching
        stops. An emergency stop kills every agent in this project and halts it until you restart it.
      </div>
      <div className="ap-controls">
        <button
          type="button"
          className="btn-secondary"
          // Nothing to stop when it is not running, and refused outright while halted.
          disabled={!running}
          onClick={() => void act(() => softStopAutopilot('You stopped it from Settings.'))}
        >
          Soft stop
        </button>
        <button
          type="button"
          className="btn-danger"
          disabled={halted}
          onClick={() => {
            void confirm(killProjectRequest()).then((ok) => {
              if (ok) void act(() => killAutopilot('You stopped everything from Settings.'));
            });
          }}
        >
          Emergency stop
        </button>
      </div>
      {error && <div className="settings-error">{error}</div>}
      {dialog}
    </>
  );
}
