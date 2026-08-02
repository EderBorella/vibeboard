import { useEffect, useState } from 'react';
import { getReadiness, type Readiness } from '../api';
import { BOARD_LABELS, type ProjectConfig } from '../shared';

// The lifecycle as it will actually be executed, plus what is stopping it.
//
// A routing table nobody can see is the same failure as a gate nobody has watched fail: it looks
// like a decision and behaves like an assumption. Every route is listed, in order, with the skill
// that runs and the column a passing card moves to.
//
// Read-only on purpose. The knobs become editable in the slice that ENFORCES them — a budget dial
// wired to nothing is what AutoGPT and AgentGPT both shipped, and a control that changes no
// behaviour tells you the opposite of the truth.

export function AutopilotPanel({ config }: { config: ProjectConfig }) {
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
      <div className="settings-hint">
        Finished at:{' '}
        {Object.entries(ap.terminal)
          .map(([b, c]) => `${b} ${c.join('/')}`)
          .join(', ')}{' '}
        · blocked cards go to {ap.blockedColumn} on engineering · a checkup every {ap.checkupEvery} dispatches
        · {ap.attemptCap} attempts per card · at most {ap.maxIterations} iterations.
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
