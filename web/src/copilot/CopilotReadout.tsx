import { formatCost } from '../format';
import { Readout, ReadoutLine } from '../atoms/Readout';
import { fmtK } from './format';
import type { CopilotStats } from './useCopilot';

// The footer readout: cumulative cost, turn count, last turn's duration, and context occupancy.
// `budget` is the project setting, not a constant: context windows differ by an order of
// magnitude between models, so one baked-in number misreports occupancy for most of them.
export function CopilotReadout({ stats, budget }: { stats: CopilotStats; budget: number }) {
  const pct = Math.min(100, Math.round((stats.contextTokens / budget) * 100));
  const nearFull = stats.contextTokens > budget * 0.8;

  return (
    <ReadoutLine className="copilot-readout">
      <Readout title="cumulative session cost">
        {formatCost(stats.costUsd)}
      </Readout>
      <Readout>{stats.turns} turns</Readout>
      <Readout>{(stats.lastDurationMs / 1000).toFixed(1)}s</Readout>
      <span
        className={`ctx${nearFull ? ' ctx-warn' : ''}`}
        title={`context window: ${stats.contextTokens.toLocaleString()} / ${budget.toLocaleString()} tokens`}
      >
        <span className="ctx-bar">
          <span className="ctx-fill" style={{ width: `${pct}%` }} />
        </span>
        ctx <Readout>{fmtK(stats.contextTokens)}</Readout>
        {nearFull ? ' · consider /compact' : ''}
      </span>
    </ReadoutLine>
  );
}
