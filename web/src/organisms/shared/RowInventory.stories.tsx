import type { Meta } from '@storybook/react-vite';
import { type CSSProperties, Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { Readout } from '../../atoms/Readout';
import { Text } from '../../atoms/Text';
import { List } from './List';
import { Row } from './Row';

// THE NINETEEN OLD ROW FAMILIES AGAINST THE ONE `Row`, and it is the acceptance surface for the merge:
// the four things they disagreed about are drawn here rather than argued.
//
// WHAT THEY DISAGREED ABOUT, MEASURED FROM THE NINETEEN RULES:
//   THE GAP — seven values across nineteen families: `--s-1` ×2, `--s-2` ×3, `--s-3` ×5, `--s-4` ×6,
//     `--s-5` ×2, plus one with none. Nothing chose the spread; `Row` is `--s-4`, which six already were.
//   THE RAIL — eleven `border-left` rails, split 6:5 between 3px and 2px, with `--tone`, `--accent` and
//     `--border` each appearing on BOTH sides of that split. That is the measurement `--rule` was created
//     for one phase earlier, and this is the phase where one declaration reads it.
//   THE SLACK — five spellings of "this cell takes the rest": `flex: 1`, `flex: 1 1 auto`,
//     `flex: 1; min-width: 0`, and twice with the three overflow declarations `.vb-clip` now owns.
//   SELECTED — four states for one fact: `.control-item.active` (ground + accent edge + accent ink),
//     `.mp-sel` (ground only, with a second rule to colour its child's name), `.gate-list button:hover`
//     (edge only) and `.suggestions-row.picked` (rail colour + a `--wash` ground).
//
// THE OLD ROWS CARRY THEIR DECLARATIONS INLINE, quoted from the rules deleted in this same commit, so the
// comparison is with what was really there rather than with a memory of it. `Audit/Tab inventory` is the
// same instrument one layer down and this follows its construction — including its lesson: the
// transcription there omitted `height`/`min-height` and reported 12px for a 26px cell, on the exact row
// the argument rested on. So the numbers below are MEASURED off the rendered box, never declared.
const meta = {
  title: 'Audit/Row inventory',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;

// A height built from padding plus a line box plus a border is written down nowhere, which is exactly how
// nineteen of them accumulated. `probe` names the element the row is ABOUT: measuring the wrapper would
// report the LIST's gap rather than the row's own box.
function Measured({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState('—');
  useEffect(() => {
    const el = host.current?.querySelector('[data-probe]');
    if (!(el instanceof HTMLElement)) return;
    const box = el.getBoundingClientRect();
    setSize(`${box.height.toFixed(2)} × ${box.width.toFixed(0)}`);
  }, []);
  return (
    <>
      <div ref={host} style={{ minWidth: 0 }}>
        {children}
      </div>
      <Readout>{size}</Readout>
    </>
  );
}

// The gap, the rail and the selected state each family declared, verbatim.
const OLD: [string, CSSProperties, string][] = [
  ['.control-item', { display: 'flex', alignItems: 'center', gap: 'var(--s-3)', width: '100%' }, 's-3'],
  ['.explorer-item', { display: 'flex', alignItems: 'center', gap: 'var(--s-2)', width: '100%' }, 's-2'],
  ['.mp-item', { display: 'flex', alignItems: 'center', borderRadius: 'var(--r-md)' }, 'no gap'],
  ['.report-row', { display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }, 's-3'],
  ['.settings-row', { display: 'flex', gap: 'var(--s-5)' }, 's-5'],
  ['.skill-row', { display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }, 's-4'],
  ['.resource-row', { display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }, 's-3'],
  ['.gate-row', { display: 'flex', gap: 'var(--s-4)' }, 's-4'],
  ['.archive-item', { display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }, 's-4'],
  [
    '.dispatch-row',
    { display: 'flex', alignItems: 'center', gap: 'var(--s-4)', flexWrap: 'wrap' },
    's-4 + wrap',
  ],
  [
    '.signin-row',
    {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'var(--s-5)',
      padding: 'var(--s-4) 0',
      borderBottom: '1px solid var(--border)',
    },
    's-5 + a rule',
  ],
];

// The five that STACKED, and every one of them wrote the same three declarations.
const OLD_STACKED: [string, CSSProperties, string][] = [
  [
    '.diary-entry',
    {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--s-2)',
      padding: 'var(--s-4) 0 var(--s-4) var(--s-5)',
      borderLeft: 'var(--rule) solid var(--border)',
    },
    '3px --border',
  ],
  [
    '.filed-entry',
    {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--s-2)',
      padding: 'var(--s-4) 0 var(--s-4) var(--s-5)',
      borderLeft: 'var(--rule) solid var(--tone, var(--border))',
    },
    '3px --tone',
  ],
  [
    '.exec-run',
    { display: 'flex', flexDirection: 'column', gap: 'var(--s-2)', alignItems: 'flex-start' },
    'no rail',
  ],
  [
    '.mp-pick',
    { display: 'flex', flexDirection: 'column', gap: 'var(--s-1)', flex: 1, color: 'var(--text)' },
    'no rail',
  ],
  [
    '.suggestions-pick',
    { display: 'flex', flexDirection: 'column', gap: 'var(--s-2)', alignItems: 'flex-start' },
    'no rail',
  ],
];

const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content minmax(0, 1fr) max-content max-content',
  alignItems: 'center',
  gap: 'var(--s-4) var(--s-5)',
};

function Head({ what }: { what: string }) {
  return (
    <>
      <Text caps>family</Text>
      <Text caps>{what}</Text>
      <Text caps>rail / gap</Text>
      <Text caps>measured px</Text>
    </>
  );
}

export const Inline = {
  render: () => (
    <div style={GRID}>
      <Head what="as it was" />
      {OLD.map(([name, style, note]) => (
        <Fragment key={name}>
          <Readout>{name}</Readout>
          <Measured>
            <div data-probe style={style}>
              <span className="vb-clip">config/agents.md</span>
              <Readout>2.1 kB</Readout>
            </div>
          </Measured>
          <Readout>{note}</Readout>
        </Fragment>
      ))}
      <Readout>&lt;Row&gt;</Readout>
      <Measured>
        <div data-probe className="vb-row">
          <span className="vb-clip">config/agents.md</span>
          <Readout>2.1 kB</Readout>
        </div>
      </Measured>
      <Readout>s-4</Readout>
    </div>
  ),
};

export const Stacked = {
  render: () => (
    <div style={GRID}>
      <Head what="as it was" />
      {OLD_STACKED.map(([name, style, note]) => (
        <Fragment key={name}>
          <Readout>{name}</Readout>
          <Measured>
            <div data-probe style={style}>
              <Text caps>checkup</Text>
              <p style={{ margin: 0 }}>What the agent did, in one line.</p>
            </div>
          </Measured>
          <Readout>{note}</Readout>
        </Fragment>
      ))}
      <Readout>&lt;Row stack rail&gt;</Readout>
      <Measured>
        <Row data-probe stack variant="flat" rail>
          <Text caps>checkup</Text>
          <p style={{ margin: 0 }}>What the agent did, in one line.</p>
        </Row>
      </Measured>
      <Readout>3px --tone</Readout>
    </div>
  ),
};

// THE FOUR SELECTED STATES FOR ONE FACT, side by side with the one that replaces them. This is the row of
// the inventory the merge is actually argued on: `.mp-sel` coloured its CHILD's ink and not its own, which
// is the same asymmetry `Audit/Tab inventory` found on `.cards-tab`.
export const Selected = {
  render: () => (
    <List>
      <Row variant="flat" style={{ background: 'var(--panel-2)', borderColor: 'var(--accent)', color: 'var(--accent)' }}>
        <Readout>.control-item.active</Readout>
        <span className="vb-clip">ground + edge + ink</span>
      </Row>
      <Row variant="flat" style={{ background: 'var(--panel-2)' }}>
        <Readout>.mp-sel</Readout>
        <span className="vb-clip" style={{ color: 'var(--accent)' }}>
          ground, and its CHILD's ink
        </span>
      </Row>
      <Row variant="inset" style={{ borderColor: 'var(--accent)' }}>
        <Readout>.gate-list button:hover</Readout>
        <span className="vb-clip">edge only</span>
      </Row>
      <Row variant="flat" rail style={{ borderLeftColor: 'var(--accent)', background: 'var(--wash)' }}>
        <Readout>.suggestions-row.picked</Readout>
        <span className="vb-clip">rail colour + a --wash ground</span>
      </Row>
      <Row variant="flat" interactive active>
        <Readout>&lt;Row interactive active&gt;</Readout>
        <span className="vb-clip">one state, every row in the app</span>
      </Row>
    </List>
  ),
};
