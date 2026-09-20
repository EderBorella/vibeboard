// The kinds a project can be. A fixed list, because the box's package set has to be decidable from it
// — an open list puts image selection back to guessing. Three to start; a kind is added when it earns
// a toolchain of its own. decision 75.
export const BOX_KINDS = ['web', 'game', 'research'] as const;

export type BoxKind = (typeof BOX_KINDS)[number];

// A predicate, not a boolean check at each site: config arrives as untyped YAML, and a mistyped kind
// is refused rather than defaulted — backfilling would run the project on an image the person was
// trying to leave (the `mode` precedent, decision 72).
export function isBoxKind(value: unknown): value is BoxKind {
  return typeof value === 'string' && (BOX_KINDS as readonly string[]).includes(value);
}
