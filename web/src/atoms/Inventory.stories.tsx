import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Field } from '../molecules/Field';
import { StatusChip } from '../molecules/StatusChip';
import { Tabs } from '../molecules/Tabs';
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
// THE ROWS THAT ARE EXPECTED TO DISAGREE ARE NAMED AS SUCH, DRAWN LAST, AND THERE ARE FOUR. Operable: a
// segmented CELL is 2px shorter than its group because the group owns the border, which is geometry
// rather than an oversight, and it is the only one left in the operable column — `.tab-btn`, `.dock-tab`
// and `.cards-tab-label` were three of the four faces no atom owned, and the molecule layer deleted all
// three rather than patching them. Marker: a `Readout` is a treatment on a `<span>` and not a box at all,
// and the pip is a circle whose height IS its width. Everything above those lines is one number, and the
// point of drawing the exceptions at the bottom is that the column above them can be read in one glance.
const meta = {
  title: 'Audit/Control inventory',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;

// One row: the thing, its name, and what it measures. The measurement runs after layout and again on
// every theme change, because the three themes do not share a font stack.
//
// `probe` NAMES THE ELEMENT THE ROW IS ABOUT, and it exists because the first version measured
// `firstElementChild` and four of its eleven rows therefore reported a WRAPPER. The worst was the row
// that exists to prove the phase's own headline: `Chip in 1.5 prose` measured the `<p>` and printed
// **19.50**, which is the paragraph's line box — so the artefact that answers the owner's complaint said
// a chip in prose was still taking its height from its context, when check 13 measures 16px for the same
// chip on the real Project Log. `Field / Control` reported the whole field at 49.39 and
// `vb-seg-cell (part of a group)` reported the GROUP at 28, hiding the very 2px the row is named for.
// A story that measures the wrong box is worse than one that measures nothing: it is read as evidence.
function Measured({ label, probe, children }: { label: string; probe?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<string>('…');
  useEffect(() => {
    const host = box.current;
    const el = (probe ? host?.querySelector(probe) : host?.firstElementChild) ?? null;
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
  }, [probe]);
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
      {/* ONE GROUP WHERE THERE WERE TWO SIZES. `SegmentedControl` is `Tabs grouped`, and `sm` is gone —
          an 11px cell in a 12px row is the shape of the 10.88px incident. */}
      <Measured label="Tabs grouped">
        <Tabs
          grouped
          label="Mode"
          items={[
            { value: 'a', label: 'Claude' },
            { value: 'b', label: 'OpenCode' },
          ]}
          value="a"
          onChange={() => {}}
        />
      </Measured>
      <Measured label="Tabs (a cell)" probe=".vb-tab">
        <Tabs
          label="View"
          items={[
            { value: 'a', label: 'Fields' },
            { value: 'b', label: 'Edit' },
          ]}
          value="a"
          onChange={() => {}}
        />
      </Measured>
      <Measured label="Control in a Field" probe=".vb-ctl">
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
      {/* THE ONE ROW ALLOWED TO DISAGREE, drawn last so the column above is read as one number. `.tab-btn`
          is gone — it is a `Menu` item at `--ctl-h`, which is why it is up in the column now. */}
      <Measured label="a grouped cell (a part, 2px shorter)" probe=".vb-tabs-grouped .vb-tab">
        <Tabs
          grouped
          label="Mode"
          items={[{ value: 'a', label: 'a cell' }]}
          value="a"
          onChange={() => {}}
        />
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
      {/* THE SAME CHIP IN PROSE, and the row is the phase's own proof rather than a curiosity: this
          measured 25.25px against 15px on the board while `.vb-chip` said `line-height: inherit` and
          declared no height, so the paragraph around it was deciding a marker's size. `--mark-h` and
          `line-height: 1` is what makes it the same 16px as the row above. Drawn among the markers and
          NOT among the rows allowed to disagree, because agreeing is the whole point of it. */}
      <Measured label="Chip in 1.5 prose" probe=".vb-chip">
        <p style={{ lineHeight: 1.5, margin: 0 }}>
          <Chip pill tone="neutral">
            in prose
          </Chip>
        </p>
      </Measured>
      {/* THE TWO ROWS ALLOWED TO DISAGREE HERE, and neither is a marker BOX. A `Readout` is a TREATMENT —
          mono, tabular numerals, one tracking exception — on a `<span>` that declares no height at all,
          so what it reports is the line box of whatever it sits in; that is what taking the step of the
          atom around it MEANS. The pip is a circle, so its height IS its width and it cannot be
          `--mark-h` without ceasing to be one — the reason `check:box-scale` names it by hand. ONE pip
          where there were three: `Dot` had three sizes and one consumer, which is the `StatusChip` above. */}
      <Measured label="Readout (a treatment, not a box)">
        <Readout>1 234 ms</Readout>
      </Measured>
      <Measured label="the pip (a circle is a width)" probe=".vb-dot">
        <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
          <span className="vb-dot vb-tone-ok" />
        </span>
      </Measured>
    </Grid>
  ),
};
