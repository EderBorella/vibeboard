import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { Chip } from './Chip';
import { Dot } from './Dot';
import { Field } from './Field';
import { Readout } from './Readout';
import { SegmentedControl } from './SegmentedControl';
import { StatusChip } from './StatusChip';

// THE INVENTORY, AND IT IS THE POINT OF THE WORKBENCH RATHER THAN AN EXTRA.
//
// `notes/token-audit.md` reports ten distinct interactive control heights on one board. A number in a
// document is an argument; this is the thing itself — every control the app can draw, on one line, each
// labelled with the height it actually renders at, measured from the DOM rather than read off a stylesheet.
//
// MEASURED, NOT DECLARED. A height computed from padding plus font-size plus a border is not written down
// anywhere; it only exists once a browser has laid it out. That is exactly why ten of them accumulated
// without anyone choosing them, and why this story reports `getBoundingClientRect()` instead of a token.
//
// IT IS NOT A TEST. It has no assertion and cannot fail — the browser harness holds the claims. What this
// does is make the disagreement legible in one glance, which is what nothing in the repository has ever
// done and what the owner asked for.
const meta = {
  title: 'Audit/Control inventory',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;

// One row: the thing, its name, and what it measures. The measurement runs after layout and again on
// every theme change, because the three themes do not share a font stack.
function Measured({ label, children }: { label: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<string>('…');
  useEffect(() => {
    const el = box.current?.firstElementChild;
    if (!el) return;
    const read = (): void => {
      const r = el.getBoundingClientRect();
      setSize(`${r.height.toFixed(2)} × ${r.width.toFixed(2)}`);
    };
    read();
    // The face changes with the theme, and the height changes with the face.
    const obs = new ResizeObserver(read);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <>
      <code style={{ opacity: 0.6, fontSize: '0.6875rem', whiteSpace: 'nowrap' }}>{label}</code>
      <div ref={box} style={{ display: 'flex', alignItems: 'center' }}>
        {children}
      </div>
      <code style={{ opacity: 0.6, fontSize: '0.6875rem', whiteSpace: 'nowrap' }}>{size}</code>
    </>
  );
}

const Grid = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'max-content max-content max-content',
      gap: '0.5rem 1rem',
      alignItems: 'center',
    }}
  >
    {children}
  </div>
);

// EVERY BOX YOU CAN OPERATE, sorted the way the audit sorts them: by the height nobody chose.
export const ControlHeights: StoryObj = {
  render: () => (
    <Grid>
      <Measured label="Button sm">
        <Button>Settings</Button>
      </Measured>
      <Measured label="Button md">
        <Button size="md">Authorise</Button>
      </Measured>
      <Measured label="Button sm ghost">
        <Button variant="ghost">? How it works</Button>
      </Measured>
      <Measured label="Button sm bare">
        <Button variant="bare">✕</Button>
      </Measured>
      <Measured label="SegmentedControl md">
        <SegmentedControl
          label="Mode"
          items={[
            { value: 'a', label: 'Claude' },
            { value: 'b', label: 'OpenCode' },
          ]}
          value="a"
          onChange={() => {}}
        />
      </Measured>
      <Measured label="SegmentedControl sm">
        <SegmentedControl
          label="Mode"
          size="sm"
          items={[
            { value: 'a', label: 'Claude' },
            { value: 'b', label: 'OpenCode' },
          ]}
          value="a"
          onChange={() => {}}
        />
      </Measured>
      <Measured label="Field / input">
        <Field label="Cap">
          <input className="vb-input" defaultValue="12" />
        </Field>
      </Measured>
      <Measured label=".vb-input alone">
        <input className="vb-input" defaultValue="a rename" />
      </Measured>
      <Measured label="select .vb-input">
        <select className="vb-input" defaultValue="cyberpunk">
          <option value="cyberpunk">Cyberpunk</option>
        </select>
      </Measured>
    </Grid>
  ),
};

// EVERY BOX YOU CAN ONLY READ. A chip ends `line-height: inherit` with no vertical padding, so its height
// is its CONTEXT's — which is why the same chip is one height on the board and another in prose. Both are
// shown, because the difference is the finding.
export const MarkerHeights: StoryObj = {
  render: () => (
    <Grid>
      <Measured label="Chip (tone)">
        <Chip pill tone="accent">
          tag
        </Chip>
      </Measured>
      <Measured label="Chip (fill, readout)">
        <Chip pill fill className="vb-readout">
          7
        </Chip>
      </Measured>
      <Measured label="StatusChip">
        <StatusChip
          state="ready"
          word="Ready"
          advice={{ heading: 'Ready', detail: 'This agent has what it needs to run.' }}
        />
      </Measured>
      <Measured label="Readout">
        <Readout>1 234 ms</Readout>
      </Measured>
      <Measured label="Dot 7 / 8 / 12">
        <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
          <Dot size={7} state="ready" />
          <Dot size={8} state="running" />
          <Dot size={12} state="failing" />
        </span>
      </Measured>
      {/* THE SAME CHIP IN PROSE, at the line-height of the paragraph around it rather than its own. */}
      <Measured label="Chip in 1.5 prose">
        <p style={{ lineHeight: 1.5, margin: 0 }}>
          <Chip pill tone="neutral">
            in prose
          </Chip>
        </p>
      </Measured>
    </Grid>
  ),
};
