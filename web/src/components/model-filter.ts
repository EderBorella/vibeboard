import type { ModelOption } from '../api';
import { providerOf } from './model-format';

// Which models the picker shows, and in what order. Lifted out of ModelPicker so it can be tested
// and mutation-measured directly: the component around it is a modal full of chips, and asserting on
// that markup was buying nothing. Formatting and favourites live in model-format.ts — this file is
// only about choosing and ordering.

export interface ModelFilter {
  query: string;
  provider: string;
  toolOnly: boolean;
  freeOnly: boolean;
  visionOnly: boolean;
  // Never hidden by a filter, however narrow: losing sight of what is selected, or of the
  // fallback, makes the list lie about what you are about to get.
  value: string;
  defaultModel: string;
}

export function matchesFilter(m: ModelOption, f: ModelFilter): boolean {
  if (m.id === f.value || m.id === f.defaultModel) return true;
  if (f.toolOnly && !m.caps?.toolCall) return false;
  if (f.freeOnly && !m.free) return false;
  if (f.visionOnly && !m.caps?.vision) return false;
  if (f.provider !== 'all' && providerOf(m.id) !== f.provider) return false;
  const q = f.query.trim().toLowerCase();
  if (q && !`${m.id} ${m.name ?? ''}`.toLowerCase().includes(q)) return false;
  return true;
}

// The backend's default sits at the top, above favourites: it answers "what am I getting if I
// don't think about this?", so it should never need scrolling for.
export function compareModels(
  a: ModelOption,
  b: ModelOption,
  ctx: { defaultModel: string; favs: Set<string> },
): number {
  if ((a.id === ctx.defaultModel) !== (b.id === ctx.defaultModel)) {
    return a.id === ctx.defaultModel ? -1 : 1;
  }
  const fa = ctx.favs.has(a.id);
  const fb = ctx.favs.has(b.id);
  if (fa !== fb) return fa ? -1 : 1;
  if (a.free !== b.free) return a.free ? -1 : 1;
  return (a.name ?? a.id).localeCompare(b.name ?? b.id);
}
