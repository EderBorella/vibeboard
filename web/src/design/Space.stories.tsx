import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

// SEVEN STEPS, AND THE ACCEPTANCE IS THAT YOU CAN SEE THERE IS NO EIGHTH. `Design/Tokens` prints
// 2 / 4 / 6 / 8 / 12 / 16 / 24 in a column, and a column of numbers cannot answer the only question this
// scale has ever been asked — whether the gap between two adjacent steps is a distinction a person can
// make. Stacked from a shared left edge, it is one picture: the four small steps are visibly a ladder,
// and the hole a "10px" would fill is visibly not a hole.
//
// THIS IS THE PHASE'S OWN EVIDENCE. 176 hand-written lengths landed on these seven, carrying 32 distinct
// values — `0.75rem` twenty-eight times, `1rem` eighteen, `0.2rem` seventeen, `0.9rem` fifteen — and the
// argument for refusing an eighth step was made on the numbers in `notes/atomic-revamp-plan.md` §3.2.
// This is the same argument as a thing rather than as a table: every value that moved is written beside
// the step it moved onto, so the owner can see WHICH crowd each step absorbed and judge whether it should
// have been two. The four counts above were re-counted off the diff; three of them were wrong first time,
// which is what a figure typed beside a picture costs when nothing re-derives it.
//
// MEASURED, NOT TRANSCRIBED. The width of every bar comes from `getComputedStyle` on `<html>`, so a step
// renamed or retuned in design/tokens.css shows up here as a bar that is the wrong length or absent —
// which is the state a hand-written figure hides. IT IS NOT A TEST: `npm run check:scale` holds the claim
// that nothing in the stylesheets is off this scale.

interface Step {
  token: string;
  means: string;
  // The hand-written values this step absorbed in Phase 3, in px, largest first. `—` where the step was
  // already the only thing anybody wrote.
  absorbed: string;
}

const STEPS: Step[] = [
  { token: '--s-1', means: 'hairline separation, icon-to-label', absorbed: '2.88 · 2.4 · 2 · 1.6 · 0.8px' },
  { token: '--s-2', means: 'inside a chip', absorbed: '4.8 · 4 · 3.9 · 3.2px' },
  { token: '--s-3', means: 'inside a control', absorbed: '6.4 · 5.6px' },
  { token: '--s-4', means: 'between controls', absorbed: '8.8 · 8 · 7.2px' },
  { token: '--s-5', means: 'between groups', absorbed: '13.6 · 12.8 · 12 · 11.2 · 10.4 · 9.6px' },
  { token: '--s-6', means: 'panel padding', absorbed: '19.2 · 17.6 · 16 · 14.4px' },
  { token: '--s-7', means: 'between sections', absorbed: '48 · 40 · 32 · 24 · 22.4 · 20.8 · 20px' },
];

// The value the browser actually gives each name, re-read when the theme decorator flips `data-theme`.
// The space scale is shared geometry and no palette may touch it, which `npm run check:tokens` asserts —
// so a bar that CHANGED between themes would be the finding, and reading it per theme is how you see that.
function useSteps(): Map<string, string> {
  const [values, setValues] = useState(() => new Map<string, string>());
  useEffect(() => {
    const read = (): void => {
      const style = getComputedStyle(document.documentElement);
      setValues(new Map(STEPS.map(({ token }) => [token, style.getPropertyValue(token).trim()])));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return values;
}

const meta = {
  title: 'Design/Space',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;

function Scale() {
  const values = useSteps();
  return (
    <div style={{ display: 'grid', gap: 'var(--s-5)', color: 'var(--text)', fontFamily: 'var(--font-body)' }}>
      <p style={{ margin: 0, fontSize: 'var(--t-small)', opacity: 0.7, maxWidth: '68ch' }}>
        Seven steps on a 2px grid, stacked from one edge. The right-hand column is what each step absorbed
        when the hand-written lengths went onto the scale — if one of those crowds wanted a step of its own,
        this is where it would show.
      </p>
      <div
        style={{
          display: 'grid',
          // The bar column is `max-content` so every bar is drawn at its true width against a shared
          // left edge; a `1fr` would scale them all and delete the whole point.
          gridTemplateColumns: 'max-content max-content max-content 1fr',
          gap: 'var(--s-3) var(--s-5)',
          alignItems: 'center',
        }}
      >
        {STEPS.map(({ token, means, absorbed }) => {
          const value = values.get(token) ?? '';
          return <Row key={token} token={token} value={value} means={means} absorbed={absorbed} />;
        })}
      </div>
    </div>
  );
}

function Row({
  token,
  value,
  means,
  absorbed,
}: {
  token: string;
  value: string;
  means: string;
  absorbed: string;
}) {
  return (
    <>
      <code style={{ fontSize: 'var(--t-small)' }}>{token}</code>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', opacity: 0.75 }}>
        {value || 'undefined'}
      </span>
      {/* `1` is the floor for a step that resolved to NOTHING — a bar of zero width is invisible and
          reads as "this step does not exist", which is the one thing this story must not say by accident.
          A 2px step is drawn at its true 2px: making the smallest bar bigger than it is would delete the
          question the picture exists to ask. */}
      <div
        style={{
          width: value || 1,
          minWidth: 1,
          height: 14,
          background: 'var(--accent)',
          border: '1px solid var(--border)',
        }}
      />
      <span style={{ fontSize: 'var(--t-small)' }}>
        {means}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', opacity: 0.6 }}>
          {'  ← '}
          {absorbed}
        </span>
      </span>
    </>
  );
}

export const SevenSteps: StoryObj = { render: () => <Scale /> };
