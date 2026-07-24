// Wire types the UI consumes. Mirrors the small public surface of src/core/types.ts
// across the Vite/tsc boundary — keep in sync with the server's core.

// Mirrors src/core/types.ts BOARDS — ordered, highest level of management first.
export const BOARDS = ['features', 'product', 'engineering'] as const;
export type BoardName = (typeof BOARDS)[number];

export const BOARD_LABELS: Record<BoardName, string> = {
  features: 'Features',
  product: 'Product',
  engineering: 'Engineering',
};

// Backends are NOT symmetric: each exposes its own modes and effort scale. The UI renders
// controls from here; the server maps these values to each CLI's flags.
export interface BackendCaps {
  modes: { value: string; label: string; hint: string }[];
  efforts: { value: string; label: string }[]; // value '' = backend default
}
export const BACKEND_CAPS: Record<string, BackendCaps> = {
  'claude-code': {
    modes: [
      { value: 'research', label: 'Research', hint: 'brainstorm & web research, no edits' },
      { value: 'plan', label: 'Plan', hint: 'read & plan only, no edits' },
      { value: 'acceptEdits', label: 'Execute', hint: 'auto-accept file edits' },
      { value: 'bypassPermissions', label: 'Full-auto', hint: 'everything, unattended' },
    ],
    efforts: [
      { value: '', label: 'Default effort' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' }, { value: 'xhigh', label: 'X-high' }, { value: 'max', label: 'Max' },
    ],
  },
  opencode: {
    // Headless OpenCode always auto-approves; it has no plan/acceptEdits permission split.
    modes: [
      { value: 'build', label: 'Build', hint: 'auto-approve; can edit files' },
      { value: 'research', label: 'Research', hint: 'brainstorm & web (persona-guided, still auto)' },
    ],
    efforts: [ // maps to --variant (OpenCode's own reasoning scale)
      { value: '', label: 'Default variant' }, { value: 'minimal', label: 'Minimal' },
      { value: 'high', label: 'High' }, { value: 'max', label: 'Max' },
    ],
  },
};

export function backendCaps(backend: string): BackendCaps {
  return BACKEND_CAPS[backend] ?? BACKEND_CAPS['claude-code'];
}

export interface Card {
  id: string;
  title: string;
  description?: string;
  order: number;
  tags: string[];
  links: string[];
  group?: string;
  created: string;
  board: BoardName;
  columnSlug: string;
  body: string;
  filePath: string;
}

// Fields the PATCH /cards endpoint accepts (frontmatter subset + optional body).
export interface CardFrontmatterPatch {
  title?: string;
  description?: string;
  tags?: string[];
  links?: string[];
  group?: string;
  body?: string;
}

export interface BoardConfig {
  columns: string[];
}

export interface ProjectConfig {
  name: string;
  boards: Record<BoardName, BoardConfig>;
  miniatureChars: number;
  idPadding: number;
  copilot: { backend: string; model?: string; effort?: string };
}

export interface ProjectSnapshot {
  root: string;
  name: string;
  config: ProjectConfig;
  boards: Record<BoardName, Card[]>;
}
