import type { ModelOption } from '../api';

// Pure formatting and favourites storage, lifted out of ModelPicker so they can be tested
// directly. They were module-private, so nothing but a rendered component could reach them —
// and none of it needs the DOM.

const FAV_KEY = 'vb-fav-models';

export function loadFavs(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

export function saveFavs(ids: Set<string>): void {
  localStorage.setItem(FAV_KEY, JSON.stringify([...ids]));
}

// Provider is the id prefix (opencode/deepseek/openrouter); claude aliases have none.
export function providerOf(id: string): string {
  const i = id.indexOf('/');
  return i < 0 ? 'claude' : id.slice(0, i);
}

// Context windows span three orders of magnitude, so they are shown as 200K / 1M rather than
// raw tokens. A fractional million keeps one decimal; a whole one drops it.
export function fmtCtx(n?: number): string {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export function fmtPrice(m: ModelOption): string {
  if (m.free) return 'Free';
  if (m.promptPerM == null) return '';
  return `$${m.promptPerM} / $${m.completionPerM ?? 0}`;
}
