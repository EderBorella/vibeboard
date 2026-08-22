import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useEffect, useState } from 'react';

// THE WHOLE VOCABULARY ON ONE PAGE, and it is the owner's acceptance surface for the primitive layer
// rather than documentation of it. `notes/atomic-revamp-plan.md` §3 argues every token against N−1 with a
// consumer count; a count in a document is an argument, and this is the thing itself — every name, the
// value it actually resolves to in the theme currently selected, how many declarations spend it, and a
// specimen you can compare against the one above it.
//
// MEASURED, NOT TRANSCRIBED, and that is the whole reason it is a story rather than a table in a
// markdown file. The value comes from `getComputedStyle` on `<html>` and the consumer count from the
// stylesheets the browser has actually loaded, so a token renamed in the CSS and not here shows up as an
// empty value and a zero — which is the state a hand-written table hides.
//
// IT IS NOT A TEST. It has no assertion and cannot fail; `npm run check:tokens` holds the claims.

type Kind = 'font' | 'type' | 'space' | 'radius' | 'height' | 'border' | 'track' | 'shadow' | 'z' | 'colour';

interface Row {
  name: string;
  means: string;
  kind: Kind;
  // Struck through, with the phase that takes it away. `notes/atomic-revamp-plan.md` §3.1 — four names,
  // each of which fails the owner's own test that a token justify its existence.
  retires?: string;
}

interface Group {
  title: string;
  note: string;
  rows: Row[];
}

const GROUPS: Group[] = [
  {
    title: 'Type',
    note: 'Five steps at 11 / 12 / 13 / 15 / 18px, and the sixth retires with its one consumer.',
    rows: [
      { name: '--t-micro', means: 'chips, state words, tags', kind: 'type' },
      { name: '--t-small', means: 'controls, secondary text', kind: 'type' },
      { name: '--t-body', means: 'default UI text', kind: 'type' },
      { name: '--t-lead', means: 'panel headings', kind: 'type' },
      { name: '--t-title', means: 'surface titles', kind: 'type' },
      { name: '--t-display', means: 'no number in the app is set in it', kind: 'type', retires: 'Phase 3' },
    ],
  },
  {
    title: 'Space',
    note: 'The 2px grid. No eighth step: a value between two of these is a value nobody can name.',
    rows: [
      { name: '--s-1', means: 'hairline separation', kind: 'space' },
      { name: '--s-2', means: 'inside a chip', kind: 'space' },
      { name: '--s-3', means: 'inside a control', kind: 'space' },
      { name: '--s-4', means: 'between controls', kind: 'space' },
      { name: '--s-5', means: 'between groups', kind: 'space' },
      { name: '--s-6', means: 'panel padding', kind: 'space' },
      { name: '--s-7', means: 'between sections', kind: 'space' },
      { name: '--tile-gap', means: '8.8px — a token off its own scale', kind: 'space', retires: 'Phase 3' },
    ],
  },
  {
    title: 'Radius',
    note: 'Four corners plus `50%`, which stays a named exception in the gate rather than a token.',
    rows: [
      { name: '--r-sm', means: 'inputs, small chips', kind: 'radius' },
      { name: '--r-md', means: 'buttons, cards, panels', kind: 'radius' },
      { name: '--r-lg', means: 'surfaces and modals', kind: 'radius' },
      { name: '--r-pill', means: 'state chips and tags', kind: 'radius' },
    ],
  },
  {
    title: 'Boxes',
    note: 'The height of a box you operate, the height of a box you read, and the board’s two constants.',
    rows: [
      { name: '--ctl-h', means: 'every box you operate', kind: 'height' },
      { name: '--mark-h', means: 'every box you read', kind: 'height' },
      { name: '--tile-h', means: 'the board tile', kind: 'height' },
      { name: '--col-w', means: 'the board track', kind: 'space' },
    ],
  },
  {
    title: 'Edges, tracking and elevation',
    note: 'An edge that MEANS something, the uppercase treatment, and the one statement that a surface is off the page.',
    rows: [
      { name: '--rule', means: 'a rail that carries meaning (1px only separates)', kind: 'border' },
      { name: '--track', means: 'the uppercase chrome treatment', kind: 'track' },
      { name: '--lift', means: 'this surface is off the page', kind: 'shadow' },
      { name: '--glow', means: 'emphasis, and per-theme — `none` in two of the three', kind: 'shadow' },
    ],
  },
  {
    title: 'Layers',
    note: 'Four, because a confirm raised inside a modal must clear it and a popover must clear sticky chrome. See Design/Layers.',
    rows: [
      { name: '--z-chrome', means: 'sticky chrome', kind: 'z' },
      { name: '--z-pop', means: 'menus, popovers and their backdrops', kind: 'z' },
      { name: '--z-modal', means: 'modals', kind: 'z' },
      { name: '--z-alert', means: 'a confirm raised from inside a modal', kind: 'z' },
    ],
  },
  {
    title: 'Fonts',
    note: 'The mono/proportional split IS the signature; display carries the caps treatment.',
    rows: [
      { name: '--font-body', means: 'ink', kind: 'font' },
      { name: '--font-display', means: 'chrome caps', kind: 'font' },
      { name: '--font-mono', means: 'machine text', kind: 'font' },
    ],
  },
  {
    title: 'Palette',
    note: 'Fifteen per theme, every one carrying a measured-contrast or per-theme argument in design/themes.css. Switch the theme in the toolbar: this is the half that changes.',
    rows: [
      { name: '--bg', means: 'the ground', kind: 'colour' },
      { name: '--panel', means: 'chrome', kind: 'colour' },
      { name: '--panel-2', means: 'cards', kind: 'colour' },
      { name: '--border', means: 'edges', kind: 'colour' },
      { name: '--text', means: 'ink', kind: 'colour' },
      { name: '--muted', means: 'secondary ink', kind: 'colour' },
      { name: '--accent', means: 'primary, and it must read as TEXT', kind: 'colour' },
      { name: '--accent-2', means: 'secondary', kind: 'colour' },
      { name: '--accent-fill', means: 'a fill is not a text colour', kind: 'colour' },
      { name: '--on-fill', means: 'ink on a fill', kind: 'colour' },
      { name: '--danger', means: 'destructive', kind: 'colour' },
      { name: '--warn', means: 'a warning, in the palette it is in', kind: 'colour' },
      { name: '--ok', means: 'a good outcome', kind: 'colour' },
      { name: '--wash', means: 'the signature behind the boards', kind: 'colour' },
      {
        name: '--on-accent',
        means: 'an alias of nothing — its consumer becomes a Chip fill',
        kind: 'colour',
        retires: 'Phase 3',
      },
      {
        name: '--scan',
        means: 'a theme token nothing ever read, in all three palettes',
        kind: 'colour',
        retires: 'GONE — Phase 1',
      },
    ],
  },
];

const NAMES = GROUPS.flatMap((g) => g.rows.map((r) => r.name));

// Every rule the browser has actually loaded, as text. Storybook serves the app's own stylesheets from
// the same origin, so `cssRules` is readable; the guard is there because one unreadable sheet must not
// take the page down.
function loadedCss(): string {
  let text = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) text += rule.cssText;
    } catch {
      // A sheet from another origin refuses `cssRules`; none of the app's own is one.
    }
  }
  return text;
}

// `var(--x, var(--y))` spends BOTH names, so the count is anchored on the opening `var(` and the name
// rather than on a closing bracket — counting `var(--tone)` misses the two live fallback declarations.
const consumersOf = (css: string, name: string): number =>
  css.match(new RegExp(`var\\(\\s*${name}\\b`, 'g'))?.length ?? 0;

interface Resolved {
  value: string;
  consumers: number;
}

// The value and the consumer count for every name, re-read whenever `data-theme` changes — the theme
// decorator sets that attribute from an effect, so the first render always predates it.
function useResolved(): Map<string, Resolved> {
  const [resolved, setResolved] = useState(() => new Map<string, Resolved>());
  useEffect(() => {
    const read = (): void => {
      const style = getComputedStyle(document.documentElement);
      const css = loadedCss();
      const entries: [string, Resolved][] = NAMES.map((name) => [
        name,
        { value: style.getPropertyValue(name).trim(), consumers: consumersOf(css, name) },
      ]);
      setResolved(new Map(entries));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return resolved;
}

// A SWATCH OR A SPECIMEN, and which one depends on what the token decides. A length shown as a number is
// a number; shown as a bar next to the step above it, it is a decision you can accept or reject.
function specimen(kind: Kind, value: string): ReactNode {
  const box = { border: '1px solid var(--border)', background: 'var(--panel-2)' };
  if (kind === 'colour') return <div style={{ ...box, width: 72, height: 16, background: value }} />;
  if (kind === 'space')
    return <div style={{ ...box, width: value, height: 10, background: 'var(--accent)' }} />;
  if (kind === 'radius') return <div style={{ ...box, width: 40, height: 20, borderRadius: value }} />;
  if (kind === 'height') return <div style={{ ...box, width: 40, height: value }} />;
  if (kind === 'border')
    return <div style={{ width: 40, height: 20, borderLeft: `${value} solid var(--accent)` }} />;
  if (kind === 'shadow') return <div style={{ ...box, width: 40, height: 20, boxShadow: value }} />;
  if (kind === 'type') return <span style={{ fontSize: value }}>Handoff 0123</span>;
  if (kind === 'font') return <span style={{ fontFamily: value }}>Handoff 0123</span>;
  if (kind === 'track')
    return (
      <span style={{ letterSpacing: value, textTransform: 'uppercase', fontFamily: 'var(--font-display)' }}>
        Dispatch
      </span>
    );
  return <span style={{ fontFamily: 'var(--font-mono)' }}>{value || '—'}</span>;
}

function Cell({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: '0.6875rem', fontFamily: 'var(--font-mono)', opacity: 0.75 }}>{children}</div>
  );
}

function TokenRow({ row, value, consumers }: { row: Row; value: string; consumers: number }) {
  const gone = row.retires !== undefined;
  return (
    <>
      <code style={{ fontSize: '0.75rem', textDecoration: gone ? 'line-through' : 'none' }}>{row.name}</code>
      <Cell>{value || 'undefined'}</Cell>
      <Cell>{consumers}×</Cell>
      <div style={{ display: 'flex', alignItems: 'center', minHeight: 20 }}>{specimen(row.kind, value)}</div>
      <Cell>{gone ? `${row.means} — retires ${row.retires}` : row.means}</Cell>
    </>
  );
}

const meta = {
  title: 'Design/Tokens',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;

// A COMPONENT AND NOT AN INLINE `render`, because the hook has to sit at the top level of one.
function Vocabulary() {
  const resolved = useResolved();
  return (
    <div style={{ display: 'grid', gap: '1.25rem', color: 'var(--text)', fontFamily: 'var(--font-body)' }}>
      {GROUPS.map((group) => (
        <section key={group.title} style={{ display: 'grid', gap: '0.5rem' }}>
          <h3
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontSize: '0.9375rem',
            }}
          >
            {group.title}
          </h3>
          <p style={{ margin: 0, fontSize: '0.75rem', opacity: 0.7, maxWidth: '60ch' }}>{group.note}</p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content max-content max-content max-content 1fr',
              gap: '0.4rem 1rem',
              alignItems: 'center',
            }}
          >
            {group.rows.map((row) => (
              <TokenRow
                key={row.name}
                row={row}
                value={resolved.get(row.name)?.value ?? ''}
                consumers={resolved.get(row.name)?.consumers ?? 0}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export const Everything: StoryObj = { render: () => <Vocabulary /> };
