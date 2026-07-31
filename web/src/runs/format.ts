import type { RunUsage } from '../api';

// What a run cost, as a person reads it. Kept out of the components so the arithmetic can be tested
// and mutation-measured directly — the same reason model-filter.ts exists.
//
// Every value is optional and every one may legitimately be zero: a free model really costs nothing,
// so "absent" and "zero" must never render the same way.

// Sub-cent runs are the normal case, and $0.00 for four different runs tells you nothing — so small
// amounts keep four decimals. Above a dollar the cents are what matter.
export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

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
  if (usage.costUsd !== undefined) parts.push(formatCost(usage.costUsd));
  if (usage.durationMs !== undefined) parts.push(formatDuration(usage.durationMs));
  if (usage.turns !== undefined) parts.push(`${usage.turns} ${usage.turns === 1 ? 'turn' : 'turns'}`);
  if (usage.contextTokens !== undefined) parts.push(`${formatTokens(usage.contextTokens)} ctx`);
  if (usage.outputTokens !== undefined) parts.push(`${formatTokens(usage.outputTokens)} out`);
  return parts.join(' · ');
}

// Just the money, for the places that have room for one number: a card's report row and a dashboard
// line. Empty when the backend never said, so nothing renders rather than a misleading zero.
export function costLabel(usage: RunUsage | undefined): string {
  return usage?.costUsd === undefined ? '' : formatCost(usage.costUsd);
}
