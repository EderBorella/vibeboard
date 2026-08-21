// @vitest-environment jsdom
//
// WHICH VOICE EACH CONTROL SPEAKS IN, and it is a test because the two mistakes it pins are both
// invisible: a control wearing the wrong variant renders perfectly, and jsdom has no CSS to look at.
//
// Two claims, and they are different kinds. The first two tests read the SOURCE, because "no button
// anywhere is a ghost unless it explains" is a claim about the tree and not about one render — a
// rendered test can only ever cover the surfaces it mounts, and the ghost that goes wrong will be on
// the one it does not. The rest render, because "this button is `bare` and its handler fires" is a
// claim about a component.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardTile } from '../web/src/board/CardTile.js';
import { Column } from '../web/src/board/Column.js';
import { CardTabs } from '../web/src/cards/CardTabs.js';
import type { Card } from '../web/src/shared.js';

afterEach(cleanup);

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src');

const sources = (): { file: string; text: string }[] =>
  readdirSync(WEB, { recursive: true })
    .filter((e): e is string => typeof e === 'string' && e.endsWith('.tsx'))
    .sort()
    .map((e) => ({ file: e, text: readFileSync(join(WEB, e), 'utf8') }));

// Every `variant="ghost"` in the tree, named by the control's OWN test id rather than by a line
// number: a line number moves whenever anything above it is edited, which turns an unrelated fix into
// a red suite and teaches everyone to re-record the expectation without reading it.
// The end of an opening tag: the first `>` OUTSIDE any braces. A plain `indexOf('>')` stops inside
// `onClick={() => …}` and reads half a tag — which it did on the first run of this file, and both
// ghosts came back UNIDENTIFIED because their handler is written before their test id.
const tagEnd = (text: string, from: number): number => {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return i;
  }
  return text.length;
};

const ghostSites = (): string[] =>
  sources()
    .flatMap(({ file, text }) =>
      [...text.matchAll(/variant="ghost"/g)].map((m) => {
        const open = text.lastIndexOf('<Button', m.index);
        const id = /data-testid="([^"]+)"/.exec(text.slice(open, tagEnd(text, open)));
        return `${file}:${id?.[1] ?? 'UNIDENTIFIED'}`;
      }),
    )
    .sort();

describe('the ghost variant is reserved for controls that explain', () => {
  // THE OWNER'S RULING of 2026-08-20, and the sentence that decides it: "dashed reads as explanatory
  // rather than actionable, which is what a help affordance ('How it works') actually is." Eight sites
  // were ghosts and six of them ACTED — the clearest being the emergency stop, the most actionable
  // control on the board, drawn as a footnote.
  it('is worn by exactly two controls, and both of them only reveal information', () => {
    // `ap-help-btn` shows prose; `ap-expand` shows the bar's own numbers. Neither touches the project,
    // which is the whole of the category.
    expect(ghostSites()).toEqual([
      'autopilot/AutopilotBar.tsx:ap-expand',
      'autopilot/AutopilotBar.tsx:ap-help-btn',
    ]);
  });

  it('is worn by no control that writes, stops or navigates', () => {
    // Named rather than counted: these six were ghosts and are not. A regression here is somebody
    // reaching for `ghost` to mean "quiet", which is what put the dash on five of them.
    const acted = ['ap-kill', 'ap-settings-link', 'report-stop', 'report-dismiss', 'reports-forgive'];
    for (const { file, text } of sources()) {
      for (const id of acted) {
        const at = text.indexOf(`data-testid="${id}"`);
        if (at < 0) continue;
        // The whole opening tag, not just up to the attribute: `variant` may be written after it.
        const open = text.lastIndexOf('<Button', at);
        const tag = text.slice(open, tagEnd(text, open));
        expect(tag, `${file} renders ${id} as a ghost, but it acts`).not.toContain('variant="ghost"');
      }
    }
  });
});

const card = (over: Partial<Card> = {}): Card =>
  ({
    id: 'E-001',
    title: 'A card',
    board: 'engineering',
    columnSlug: 'todo',
    order: 10,
    tags: [],
    links: [],
    created: '2026-07-25',
    body: '',
    filePath: '/tmp/E-001.md',
    ...over,
  }) as Card;

describe('the bare variant carries the glyph buttons', () => {
  // CHARACTERISATION. Twelve classes were hand-rolled copies of `background: transparent; border:
  // none; color: var(--muted)`, and not one of them had a test that its button was reachable and did
  // anything — so the migration onto `bare` had nothing holding it in place. Three of the twelve are
  // on surfaces a unit test can mount cheaply; they stand for the shape.
  it('draws the column head + and reports the click', () => {
    const onAdd = vi.fn();
    render(
      <Column board="engineering" title="Todo" slug="todo" cards={[]} miniatureChars={40} onAdd={onAdd} />,
    );
    const add = screen.getByTitle('New card');
    expect(add.tagName).toBe('BUTTON');
    expect(add.classList.contains('vb-btn-bare')).toBe(true);
    // The box is the primitive's and the position is the surface's — the split the whole phase is for.
    // `.push` and not `.column-add`: Phase 5 merged the seven classes whose whole content was
    // `margin-left: auto` into the one utility that names what they all said. The claim is unchanged —
    // the box is the primitive's, the position is the surface's — so this stays a class assertion.
    expect(add.classList.contains('push')).toBe(true);
    add.click();
    expect(onAdd.mock.calls).toEqual([['engineering', 'todo']]);
  });

  it('draws the tile archive ✕ and does not also open the card', () => {
    const onArchive = vi.fn();
    const onOpen = vi.fn();
    render(<CardTile card={card()} miniatureChars={40} onArchive={onArchive} onOpen={onOpen} />);
    const archive = screen.getByTitle('Archive');
    expect(archive.classList.contains('vb-btn-bare')).toBe(true);
    archive.click();
    expect(onArchive).toHaveBeenCalledOnce();
    // The tile's own onClick opens the editor; the ✕ has to stop the bubble. Migrating the element
    // from `<button>` to `<Button>` is exactly where a stopPropagation gets dropped.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('draws the card tab ✕ and reports which tab to close', () => {
    const onClose = vi.fn();
    render(
      <CardTabs
        tabs={[{ id: 'E-001', board: 'engineering' }]}
        activeTabId="E-001"
        live={[card()]}
        rawAvailable={false}
        rawActive={false}
        onFocus={vi.fn()}
        onClose={onClose}
        onToggleRaw={vi.fn()}
      />,
    );
    const close = screen.getByTitle('Close E-001');
    expect(close.classList.contains('vb-btn-bare')).toBe(true);
    close.click();
    expect(onClose.mock.calls).toEqual([['E-001']]);
  });
});
