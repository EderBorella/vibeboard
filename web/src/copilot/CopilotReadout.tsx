import { CONTEXT_BUDGET, fmtK, fmtUsd } from './format';
import type { CopilotStats } from './useCopilot';

// The footer readout: cumulative cost, turn count, last turn's duration, and context occupancy.
export function CopilotReadout({ stats }: { stats: CopilotStats }) {
  const pct = Math.min(100, Math.round((stats.contextTokens / CONTEXT_BUDGET) * 100));
  const nearFull = stats.contextTokens > CONTEXT_BUDGET * 0.8;

  return (
    <div className="copilot-readout">
      <span title="cumulative session cost">{fmtUsd(stats.costUsd)}</span>
      <span>{stats.turns} turns</span>
      <span>{(stats.lastDurationMs / 1000).toFixed(1)}s</span>
      <span className={`ctx${nearFull ? ' ctx-warn' : ''}`} title={`context window: ${stats.contextTokens.toLocaleString()} / ${CONTEXT_BUDGET.toLocaleString()} tokens`}>
        <span className="ctx-bar"><span className="ctx-fill" style={{ width: `${pct}%` }} /></span>
        ctx {fmtK(stats.contextTokens)}{nearFull ? ' · consider /compact' : ''}
      </span>
    </div>
  );
}
