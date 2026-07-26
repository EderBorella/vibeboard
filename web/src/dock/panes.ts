import type { ReactNode } from 'react';

// One occupant of the utility dock. The dock owns the strip, the collapse state and which pane is
// active; it knows nothing about what a pane contains. Adding the terminal later is one more
// descriptor where the dock is mounted, plus its component — no change to the dock itself.
export interface DockPane {
  id: string;
  label: string;
  // Shown beside the label (the open-card count). Absent means no badge, which is not the same as
  // a badge of 0 — a pane can be worth showing with nothing counted.
  badge?: number;
  // False when the pane has nothing worth showing: it drops out of the strip, and a dock whose
  // panes all say false renders nothing at all rather than an empty bar.
  hasContent: boolean;
  // For panes whose state cannot survive a remount — a terminal's scrollback and its PTY. They
  // stay in the DOM while another pane is active, hidden. Presentational panes leave this unset;
  // the alternative is lifting the state out of the pane, as the copilot dock does.
  keepMounted?: boolean;
  render: () => ReactNode;
}

export function visiblePanes(panes: DockPane[]): DockPane[] {
  return panes.filter((p) => p.hasContent);
}

// The pane to show: the requested one while it is still visible, else the first that is. Closing
// the last card takes the Cards pane out of the strip, so focus has to land somewhere.
export function activePane(panes: DockPane[], activeId: string | null): DockPane | null {
  const visible = visiblePanes(panes);
  return visible.find((p) => p.id === activeId) ?? visible[0] ?? null;
}
