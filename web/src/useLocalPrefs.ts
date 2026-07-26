import { useEffect, useState } from 'react';
import type { BoardName } from './shared';

// View preferences that belong to this browser, not to the project: they live in
// localStorage and never reach the server. Keys are load-bearing — changing one loses
// everybody's saved preference.

// Theme: applied to <html data-theme>, persisted. Default cyberpunk.
export function useTheme(): [string, (t: string) => void] {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('vb-theme') || 'cyberpunk');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('vb-theme', theme);
  }, [theme]);
  return [theme, setTheme];
}

// Utility dock folded away, persisted. Distinct from the dock having no pane with content, which
// removes it entirely — this is the user having chosen to fold it.
export function useDockCollapsed(): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem('vb-dock-collapsed') === '1',
  );
  // Takes the value rather than toggling: opening a card has to make the dock visible whatever
  // state it was in, and a toggle cannot express that.
  const set = (next: boolean): void => {
    localStorage.setItem('vb-dock-collapsed', next ? '1' : '0');
    setCollapsed(next);
  };
  return [collapsed, set];
}

// Collapsed boards, persisted.
export function useCollapsedBoards(): [Set<BoardName>, (b: BoardName) => void] {
  const [collapsed, setCollapsed] = useState<Set<BoardName>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('vb-collapsed') ?? '[]'));
    } catch {
      return new Set();
    }
  });
  const toggleBoard = (b: BoardName): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      localStorage.setItem('vb-collapsed', JSON.stringify([...next]));
      return next;
    });
  return [collapsed, toggleBoard];
}
