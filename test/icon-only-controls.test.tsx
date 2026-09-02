// @vitest-environment jsdom
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ModelOption } from '../web/src/lib/api.js';
import { ModelPicker } from '../web/src/organisms/shared/ModelPicker.js';

// THE TWO WAYS REPLACING A TEXT GLYPH WITH AN ICON BREAKS A CONTROL, both of which it actually did on
// 2026-09-02 and neither of which any gate could see. An independent review found them; this file is
// what stops the third one.
//
// The glyph was doing two jobs nobody had written down, because a character in the markup does them for
// free: it was the control's ACCESSIBLE NAME, and — where it carried a trailing space inside its own
// string — it was the SEPARATOR between itself and the words after it. An `Icon` is `aria-hidden` and
// occupies no text node, so it does neither, and the loss is silent in both directions: the button still
// looks right and the suite still passes.

// `process.cwd()` and not `import.meta.url`: under the jsdom environment this file declares, the
// module URL is not a `file:` one, and `fileURLToPath` throws before a single test runs. Vitest runs
// from the repository root, which test/agent-runner.test.ts already relies on.
const ROOT = join(process.cwd(), 'web', 'src');

// AN ELEMENT WHOSE ONLY CHILD IS AN `<Icon/>`. Deliberately not restricted to `<Button>`: the first
// sweep for this was, and a `Chip as="button"` or a span with `role="button"` is the same control with a
// different tag. `attrs` tolerates a nested `{...}` expression, which is what most `onClick`s are.
const ICON_ONLY =
  /<(?<tag>[A-Za-z][\w.]*)\b(?<attrs>(?:[^<>]|\{[^{}]*\})*?)>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<Icon\s[^<>]*\/>\s*<\/\k<tag>>/g;

interface Found {
  where: string;
  tag: string;
  attrs: string;
}

function iconOnlyElements(): Found[] {
  const out: Found[] = [];
  for (const file of globSync('**/*.tsx', { cwd: ROOT }).sort()) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    for (const m of source.matchAll(ICON_ONLY)) {
      const { tag = '', attrs = '' } = m.groups ?? {};
      const line = source.slice(0, m.index).split('\n').length;
      out.push({ where: `${file}:${line} <${tag}>`, tag, attrs });
    }
  }
  return out;
}

describe('an icon-only control keeps the name its glyph used to give it', () => {
  // The population is asserted first, because a regex that silently stops matching would make the claim
  // below pass over nothing at all — the shape of failure `.claude/CODE-QUALITY.md` opens on.
  it('finds the icon-only controls to check', () => {
    expect(iconOnlyElements().length).toBeGreaterThan(8);
  });

  // `title=` COUNTS AS A NAME HERE BECAUSE IT MEASURABLY IS ONE: rendering a bare `<Button title="Close">`
  // whose only child is an `<Icon/>` resolves under `getByRole('button', { name: 'Close' })`, with an
  // empty `textContent`. Checked rather than assumed — the whole finding this file records is that a
  // control can look named and not be.
  it('leaves none of them without an accessible name', () => {
    const nameless = iconOnlyElements()
      .filter((e) => e.tag === 'Button' || /onClick|as="button"|role="button"/.test(e.attrs))
      .filter((e) => !/\btitle=|\baria-label=/.test(e.attrs))
      .map((e) => e.where);
    // Named, not counted: the message has to say which one, or the next person reads a number.
    expect(nameless).toEqual([]);
  });
});

const MODELS: ModelOption[] = [
  { id: 'a/free-one', name: 'free-one', free: true, caps: { toolCall: true, vision: false } },
  { id: 'a/paid-one', name: 'paid-one', free: false, caps: { toolCall: true, vision: false } },
] as ModelOption[];

describe('the free mark on the model-picker trigger', () => {
  // `.vb-readout` is a plain span — no flex, no gap — so the space between the mark and the name has to
  // be in the markup. `.vb-btn` and `.blockers li` are flex rows with a gap and do not need one, which is
  // why this is the only site that lost it.
  it('is separated from the model name', () => {
    render(<ModelPicker models={MODELS} value="a/free-one" defaultModel="a/paid-one" onChange={() => {}} />);
    const text = screen.getByTitle('a/free-one').textContent ?? '';
    // The exact bytes, not a substring: one missing space is invisible to `toContain`, and a missing
    // space is the entire defect.
    expect(text.startsWith(' free-one')).toBe(true);
  });

  it('puts no stray space on a model that is not free', () => {
    render(<ModelPicker models={MODELS} value="a/paid-one" defaultModel="a/paid-one" onChange={() => {}} />);
    expect(screen.getByTitle('a/paid-one').textContent).toBe('paid-one');
  });
});
