import { useEffect, useState } from 'react';
import { getReadiness, type Readiness } from '../api';
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
}: {
  config: ProjectConfig;
  // Called with the whole set of edited caps on every change. The modal merges them into the config's
  // autopilot block and saves once, with everything else.
  onCaps?: (caps: Partial<AutopilotConfig>) => void;
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
  const edit = (key: keyof AutopilotConfig, value: number): void => {
    const next = { ...caps, [key]: value };
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
        {accounting?.cap.why ?? 'Whichever of these is reached first stops the run.'}
      </div>
      {CAPS.map((cap) => (
        <label className="field" key={cap.key}>
          <span>{cap.label}</span>
          <input
            type="number"
            min={cap.min}
            step={cap.step}
            value={caps[cap.key] ?? ap[cap.key]}
            onChange={(e) => edit(cap.key, Number(e.target.value))}
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
          onChange={(e) => edit('runTimeoutMs', Math.max(1, Number(e.target.value)) * 60_000)}
        />
        <span className="field-hint">
          One run is abandoned after this long and recorded as failed, which burns an attempt — a card that
          hangs every time must not retry for ever.
        </span>
      </label>

      <div className="settings-hint">
        Finished at:{' '}
        {Object.entries(ap.terminal)
          .map(([b, c]) => `${b} ${c.join('/')}`)
          .join(', ')}{' '}
        · blocked cards go to {ap.blockedColumn} on engineering.
      </div>

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
