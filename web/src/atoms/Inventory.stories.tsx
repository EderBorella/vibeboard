import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Dot } from '../ui/Dot';
import { Field } from '../ui/Field';
import { SegmentedControl } from '../ui/SegmentedControl';
import { StatusChip } from '../ui/StatusChip';
import { Button } from './Button';
import { Chip } from './Chip';
import { Control } from './Control';
import { Readout } from './Readout';

// THE INVENTORY, AND IT IS THE POINT OF THE WORKBENCH RATHER THAN AN EXTRA.
//
// TEN DISTINCT INTERACTIVE CONTROL HEIGHTS ON ONE BOARD is the measurement the whole revamp answers, and
// this story is the ACCEPTANCE TEST for the answer: after the atom layer there must be ONE number in the
// operable column and ONE in the marker column. Ten rows of the same number is what the owner asked to
// see, and it is the one artefact here that replies to his original complaint directly.
//
// MEASURED, NOT DECLARED. A height computed from padding plus a line box plus a border is not written down
// anywhere; it exists only once a browser has laid it out. That is exactly why ten of them accumulated
// without anyone choosing them, and why this story reports `getBoundingClientRect()` rather than a token —
// a story that read `--ctl-h` back out of the stylesheet would agree with itself whatever rendered.
//
// IT IS NOT A TEST. It has no assertion and cannot fail; `npm run visual`'s checks 12 and 13 hold the
// claims, and the drift baseline records the two tallies. What this does is make agreement — or its
// absence — legible in one glance.
//
// THE TWO ROWS THAT ARE EXPECTED TO DISAGREE ARE NAMED AS SUCH, and there are two kinds. A segmented CELL
// is 2px shorter than its group because the group owns the border, which is geometry rather than an
// oversight; and `.tab-btn`/`.dock-tab` are the tab faces no atom owns yet, deleted in Phases 5 and 6
// rather than patched here — patching a class you are about to delete is migration scaffolding.
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
      <Measured label="Field / Control">
        <Field label="Cap">
          <Control defaultValue="12" />
        </Field>
      </Measured>
      <Measured label="Control alone">
        <Control defaultValue="a rename" />
      </Measured>
      <Measured label="Control as=select">
        <Control as="select" defaultValue="cyberpunk">
          <option value="cyberpunk">Cyberpunk</option>
        </Control>
      </Measured>
      {/* THE TWO ROWS ALLOWED TO DISAGREE, drawn last so the column above is read as one number. */}
      <Measured label="vb-seg-cell (part of a group)">
        <span className="vb-seg">
          <button type="button" className="vb-seg-cell active">
            a cell
          </button>
        </span>
      </Measured>
      <Measured label=".tab-btn (Phase 5 deletes it)">
        <button type="button" className="tab-btn">
          Boards
        </button>
      </Measured>
    </Grid>
  ),
};

// EVERY BOX YOU CAN ONLY READ. The chip used to end `line-height: inherit` with no vertical padding, so its
// height was its CONTEXT's — which is why the same chip measured one height on the board and another in
// prose. Both are still shown, because the pair that used to be the finding is now the proof.
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
