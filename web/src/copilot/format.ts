// Pure display helpers for the copilot dock. No React, no state — just the formatters and the
// backend list the dock's controls render from.

export const BACKENDS: { value: string; label: string }[] = [
  { value: 'claude-code', label: 'Claude' },
  { value: 'opencode', label: 'OpenCode' },
];

// Short backend label for the chat list — chats don't carry context across backends, so
// each one is tagged with the backend it ran on.
export function backendLabel(b: string): string {
  return BACKENDS.find((x) => x.value === b)?.label ?? b;
}

// Money is NOT here: it is `formatCost` in web/src/format.ts, shared with the runs pane. This module
// held a second, unguarded formatter that rounded to different places than that one.
export function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// Compact relative time for the chat switcher (e.g. "just now", "5m", "2h", "3d").
export function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
