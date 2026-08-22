import type { Meta, StoryObj } from '@storybook/react-vite';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { Menu } from './Menu';
import { Tabs } from './Tabs';

// THE ACCEPTANCE SURFACE FOR THE REVERSAL, and it is the one place the three treatments being given up are
// visible next to what replaces them. The repository refused a `Tabs` primitive TWICE, both times on a
// measurement of two candidates: "the two real tabs disagree on the two things a tab primitive would have
// to own — the face and the selected state — and two consumers disagreeing on both is a primitive that
// would carry one variant each, which is a name that decides nothing."
//
// THE MEASUREMENT WAS RIGHT AND THE POPULATION WAS WRONG. There were never two; there were SIX, and the
// six disagreed on six faces, six selected states and six heights across nineteen classes. That is not a
// primitive with one variant each — it is nineteen classes for one shape, which is the diagnosis the whole
// revamp exists to answer.
//
// WHAT IS GIVEN UP, drawn rather than argued, and there are three:
//   1. THE DOCK'S UPPERCASE AND ITS DISPLAY FACE. Two of the six wore them and two did not.
//   2. THE TOP ROW'S `--glow`. A halo on a destination made the header's current tab the brightest thing
//      on a board with work actually running on it.
//   3. THE `sm` STEP. `.vb-seg-cell-sm` was `--t-micro` in a `--t-small` row, which is the shape of the
//      10.88px incident this design system has ruled on twice. Its BOX was already 26px — see `SEG` below
//      for the transcription defect that reported 12px here and what it would have told the owner.
//
// THE OLD ROWS CARRY THEIR OWN DECLARATIONS INLINE, because their classes are deleted in the same commit
// that adds this story. Quoted verbatim from the six rules — see the git history of `top-tabs.css`,
// `dock.css`, `cards-pane.css`, `editor-layout.css`, `copilot.css` and `ui/primitives.css` — so the
// comparison is with what was really there rather than with a memory of it.
const meta = {
  title: 'Audit/Tab inventory',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;

// One row: what it is, and what its cell MEASURES. Measured and not declared, for `Audit/Control
// inventory`'s reason — a height built from padding plus a line box plus a border is written down nowhere,
// which is exactly how six of them accumulated.
//
// `probe` NAMES THE ELEMENT THE ROW IS ABOUT and it is not optional here: every new row renders a STRIP,
// and measuring the strip would report the padding this phase moved onto it rather than the cell the row
// is named for. That is the defect the atom phase's inventory shipped with and had to fix.
function Measured({ label, probe, children }: { label: string; probe: string; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState('…');
  useEffect(() => {
    const el = host.current?.querySelector(probe);
    if (!el) {
      setPx('not found');
      return;
    }
    const read = (): void =>
      setPx(`${(Math.round(el.getBoundingClientRect().height * 100) / 100).toFixed(2)}`);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [probe]);
  return (
    <>
      <div style={{ color: 'var(--muted)', fontSize: 'var(--t-small)' }}>{label}</div>
      <div ref={host}>{children}</div>
      <div className="vb-readout" style={{ textAlign: 'right' }}>
        {px}
      </div>
    </>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'max-content 1fr max-content',
        alignItems: 'center',
        gap: 'var(--s-5) var(--s-6)',
      }}
    >
      {children}
    </div>
  );
}

// The six rules, transcribed. `text-transform` and `letter-spacing` are on the dock's row and nowhere
// else; the top row is the only one with a shadow; the cards row is the only one whose SELECTED state
// colours a child rather than itself.
// `alignItems` is this story's and not `.topbar-tabs`'s, which declared none — it keeps a one-row strip on
// the grid's centre line and cannot affect a cell's height.
const OLD_STRIP: CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--s-2)' };
const TAB_BTN: CSSProperties = {
  background: 'var(--panel-2)',
  color: 'var(--accent)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)',
  padding: 'var(--s-2) var(--s-5)',
  fontSize: 'var(--t-small)',
  fontFamily: 'var(--font-display)',
  letterSpacing: 'var(--track)',
  boxShadow: 'var(--glow)',
};
const DOCK_TAB: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--s-3)',
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: 'var(--r-md)',
  padding: 'var(--s-2) var(--s-4)',
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--t-small)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--track)',
};
const CARDS_TAB: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  flex: '0 0 auto',
  background: 'var(--bg)',
  border: '1px solid var(--accent)',
  borderRadius: 'var(--r-md)',
  maxWidth: '220px',
  boxShadow: 'var(--glow)',
};
const CARDS_TAB_LABEL: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text)',
  fontSize: 'var(--t-small)',
  padding: '2px 2px 2px 8px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const CONTROL_TAB: CSSProperties = {
  background: 'var(--panel-2)',
  color: 'var(--text)',
  border: '1px solid var(--accent)',
  borderRadius: 'var(--r-md)',
  padding: 'var(--s-2) var(--s-4)',
  fontSize: 'var(--t-small)',
};
// THE ONE TRANSCRIPTION THAT WAS WRONG, and it was wrong on the row the whole reversal is argued on.
// `SEG` omitted `.vb-seg`'s `height`/`min-height`, so with no height on the group and no vertical padding
// on the cell the cell collapsed to its 11px line box and this story reported **12.00px** — telling the
// owner the `sm` cell was 12px and that the change was 12px → 26px, i.e. that a small box had grown by
// half again. It was 26px. The change is 26px → 26px, and the ONLY thing given up on this row is the FONT
// STEP: `--t-micro` in a `--t-small` row. `SEG_CELL` also omitted the divider, so the drawn group showed
// no seam between its two cells — and "the group owns one border, the cells are clipped, a divider between
// them" is one of the three things this row exists to show. Both restored; see the git history of
// `ui/primitives.css` at 6c3ca93 for the rule as it stood at the moment of deletion.
// `width: max-content` is NOT in the rule: it is here because the grid's middle column is `1fr` and a
// flex group would otherwise span it. It cannot touch the height, which is what this column reports.
const SEG: CSSProperties = {
  display: 'flex',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)',
  overflow: 'hidden',
  height: 'var(--ctl-h)',
  minHeight: 'var(--ctl-h)',
  width: 'max-content',
};
const SEG_CELL: CSSProperties = {
  background: 'var(--accent-fill)',
  color: 'var(--on-fill)',
  fontWeight: 600,
  border: 'none',
  borderRight: '1px solid var(--border)',
  padding: '0 var(--s-4)',
  fontSize: 'var(--t-small)',
};

export const SixFacesAndTwo: StoryObj = {
  render: () => (
    <Grid>
      <Measured label="1 — .tab-btn (the five destinations)" probe="button">
        <div style={OLD_STRIP}>
          <button type="button" style={TAB_BTN}>
            Execution
          </button>
        </div>
      </Measured>
      <Measured label="2 — .chat-menu-open (the session list)" probe="button">
        <div style={{ ...OLD_STRIP, background: 'var(--panel-2)', borderRadius: 'var(--r-md)' }}>
          <button
            type="button"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--s-1)',
              color: 'var(--text)',
              background: 'transparent',
              border: '1px solid transparent',
              borderLeft: 'var(--rule) solid var(--accent)',
              borderRadius: 'var(--r-md)',
              padding: 'var(--s-3) var(--s-4)',
              textAlign: 'left',
              font: 'inherit',
            }}
          >
            <span>a chat title</span>
            <span className="vb-readout" style={{ fontSize: 'var(--t-small)' }}>
              2h ago · 14 msg
            </span>
          </button>
        </div>
      </Measured>
      <Measured label="3 — .dock-tab (the utility panes)" probe="button">
        <div style={OLD_STRIP}>
          <button type="button" style={DOCK_TAB}>
            Cards
          </button>
        </div>
      </Measured>
      <Measured label="4 — .cards-tab-label (the open cards)" probe="button">
        <div style={OLD_STRIP}>
          <span style={CARDS_TAB}>
            <button type="button" style={CARDS_TAB_LABEL}>
              a card title
            </button>
          </span>
        </div>
      </Measured>
      <Measured label="5 — .control-tabs button (Fields/Edit/Preview)" probe="button">
        <div style={OLD_STRIP}>
          <button type="button" style={CONTROL_TAB}>
            Preview
          </button>
        </div>
      </Measured>
      <Measured
        label="6 — .vb-seg-cell-sm (the backend picker) — 26px already; the STEP is what goes, not the box"
        probe="button"
      >
        <div style={SEG}>
          <button type="button" style={{ ...SEG_CELL, fontSize: 'var(--t-micro)' }}>
            Claude Code
          </button>
          <button
            type="button"
            style={{
              ...SEG_CELL,
              fontSize: 'var(--t-micro)',
              borderRight: 'none',
              background: 'var(--panel-2)',
              color: 'var(--muted)',
            }}
          >
            OpenCode
          </button>
        </div>
      </Measured>

      <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)' }} />

      <Measured label="Tabs — a cell" probe=".vb-tab">
        <Tabs
          label="View"
          items={[
            { value: 'a', label: 'Preview' },
            { value: 'b', label: 'Edit' },
          ]}
          value="a"
          onChange={() => {}}
        />
      </Measured>
      <Measured label="Tabs — badged" probe=".vb-tab">
        <Tabs
          label="Utilities"
          items={[{ value: 'a', label: 'Cards', badge: 3 }]}
          value="a"
          onChange={() => {}}
        />
      </Measured>
      <Measured label="Tabs closable — a long label, clamped" probe=".vb-tab">
        <Tabs
          label="Open cards"
          closable
          onClose={() => {}}
          items={[{ value: 'E-001', label: 'a card title long enough to be cut off somewhere' }]}
          value="E-001"
          onChange={() => {}}
        />
      </Measured>
      <Measured label="Tabs grouped — the group" probe=".vb-tabs-grouped">
        <Tabs
          grouped
          label="Mode"
          items={[
            { value: 'a', label: 'Claude Code' },
            { value: 'b', label: 'OpenCode' },
          ]}
          value="a"
          onChange={() => {}}
        />
      </Measured>
      <Measured label="Tabs grouped — a cell (2px shorter, by construction)" probe=".vb-tab">
        <Tabs
          grouped
          label="Mode"
          items={[{ value: 'a', label: 'Claude Code' }]}
          value="a"
          onChange={() => {}}
        />
      </Measured>
      <Measured label="Menu row — a destination" probe=".vb-menu-item">
        <Menu
          label="View"
          items={[
            { value: 'a', label: 'Execution', badge: 3 },
            { value: 'b', label: 'Boards' },
          ]}
          value="a"
          onChange={() => {}}
        />
      </Measured>
    </Grid>
  ),
};
