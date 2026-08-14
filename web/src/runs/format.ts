import type { RunUsage } from '../api';
import { formatCost, isMoney } from '../format';

// What a run cost, as a person reads it. Kept out of the components so the arithmetic can be tested
// and mutation-measured directly — the same reason model-filter.ts exists.
//
// Every value is optional and every one may legitimately be zero: a free model really costs nothing,
// so "absent" and "zero" must never render the same way.
//
// The money formatter itself is in web/src/format.ts, because the copilot dock renders the same number
// and had written its own.

// Thousands as `48.2k`; below that, exact. Token counts are read for magnitude, not precision.
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 100 ? k.toFixed(1) : Math.round(k)}k`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

// The one-line summary: only the parts the backend actually reported, in the order they answer
// "what did this cost me" — money, then time, then work, then size.
export function usageLine(usage: RunUsage | undefined): string {
  if (!usage) return '';
  const parts: string[] = [];
  if (isMoney(usage.costUsd)) parts.push(formatCost(usage.costUsd));
  if (usage.durationMs !== undefined) parts.push(formatDuration(usage.durationMs));
  if (usage.turns !== undefined) parts.push(`${usage.turns} ${usage.turns === 1 ? 'turn' : 'turns'}`);
  if (usage.contextTokens !== undefined) parts.push(`${formatTokens(usage.contextTokens)} ctx`);
  if (usage.outputTokens !== undefined) parts.push(`${formatTokens(usage.outputTokens)} out`);
  return parts.join(' · ');
}

// A total across runs, as a person reads it. The honesty is the point: `costUsd` is absent when NOT
// ONE run reported a cost, and a total of "$0" there would be a lie about a project that has spent
// real money on a subscription. So the sentence says what is missing instead.
//
// "usage", never "cost": for Claude Code on a Max or Pro plan the figure is API-equivalent rather than
// what you were billed, which is why RunUsage is named as it is.
export function usageTotal(spend: {
  runs: number;
  withCost: number;
  withoutCost: number;
  costUsd?: number;
  durationMs?: number;
}): string {
  const runs = `${spend.runs} ${spend.runs === 1 ? 'run' : 'runs'}`;
  // `isMoney` rather than `=== undefined`: see formatCost. An absent cost and an unusable one read the
  // same to a person — neither is a figure — and the alternative is throwing during render.
  const costUsd = spend.costUsd;
  if (!isMoney(costUsd)) {
    return `${runs} · usage not reported by this backend`;
  }
  const parts = [runs, `${formatCost(costUsd)} usage`];
  if (spend.durationMs !== undefined) parts.push(formatDuration(spend.durationMs));
  // Only when some runs are missing from the total: otherwise the caveat is noise on every screen.
  if (spend.withoutCost > 0) parts.push(`${spend.withoutCost} reported none`);
  return parts.join(' · ');
}

// Just the money, for the places that have room for one number: a card's report row and a dashboard
// line. Empty when the backend never said, so nothing renders rather than a misleading zero.
export function costLabel(usage: RunUsage | undefined): string {
  return isMoney(usage?.costUsd) ? formatCost(usage.costUsd) : '';
}
