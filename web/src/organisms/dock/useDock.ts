import { useState } from 'react';
import { useDockCollapsed } from '../../lib/useLocalPrefs';

export interface Dock {
  pane: string | null;
  collapsed: boolean;
  // Bring a pane up. Also unfolds the dock: a card that opens into a collapsed dock has silently
  // gone nowhere, which reads as the click having failed.
  show: (paneId: string) => void;
  toggle: () => void;
}

// Which pane the dock shows and whether it is folded away. Its own hook so the reveal rule is
// testable without mounting the shell — the collapse itself is persisted by useDockCollapsed.
export function useDock(): Dock {
  const [pane, setPane] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useDockCollapsed();

  return {
    pane,
    collapsed,
    show: (paneId) => {
      setPane(paneId);
      setCollapsed(false);
    },
    toggle: () => setCollapsed(!collapsed),
  };
}
