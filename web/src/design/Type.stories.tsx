import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

// FIVE STEPS, AND THE ACCEPTANCE IS THAT YOU CAN SEE THERE IS NO SIXTH. There was one: `--t-display` at
// 24px, defined to carry "the one big number per surface", and no number in the app was ever set in it —
// its only consumer was a markdown `h1`. A step with one consumer and not the one it was named for is a
// name that decides nothing, so it is gone and the heading ladder in `atoms/prose.css` slid down onto the
// three steps the scale already had. The visible half is that a preview's `h1` is 18px rather than 24px.
//
// IN ALL THREE STACKS, ON ONE PAGE, and that is the reason this is not a column of numbers. The
// mono/proportional split IS the signature (`docs/design-system.md`, *The signature*) — machine-measured
// facts are monospace and everything a person wrote is not — and a step is only usable if it survives all
// three faces at the size it claims. 11px is where that stops being obvious: `--t-micro` carries chip
// text, and condensed display caps at 11px was the last thing the owner reported he could not read.
//
// THE SPECIMEN IS DELIBERATELY NOT "THE QUICK BROWN FOX". Every row is a string this app actually renders:
// a card title, a run status, a cost. A pangram tests a typeface; this tests the decision.
//
// MEASURED, NOT TRANSCRIBED — the size comes from `getComputedStyle` on `<html>`, so a step retuned in
// design/tokens.css shows here. IT IS NOT A TEST: `npm run check:scale` holds the claim that every
// authored `font-size` in `web/src` is one of these five, and browser check 1 holds the computed side.

interface Step {
  token: string;
  means: string;
  specimen: string;
}

// In the order the scale is defined, smallest first, so the ladder reads down the page.
const STEPS: Step[] = [
  { token: '--t-micro', means: 'chips, state words, tags', specimen: 'needs you · 3' },
  { token: '--t-small', means: 'controls, secondary text, table cells', specimen: 'Refresh suggestions' },
  {
    token: '--t-body',
    means: 'default UI text, card titles on the board',
    specimen: 'Split the dispatch pane',
  },
  { token: '--t-lead', means: 'panel headings, an open card’s title', specimen: 'Project log' },
  {
    token: '--t-title',
    means: 'surface titles, and a rendered document’s h1',
    specimen: 'Auto-pilot halted',
  },
];

const STACKS = [
  { token: '--font-body', means: 'ink — what a person wrote' },
  { token: '--font-display', means: 'chrome caps — the label on a control' },
  { token: '--font-mono', means: 'machine text — a figure the machine measured' },
];

function useSizes(): Map<string, string> {
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
  title: 'Design/Type',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;

function Specimens() {
  const sizes = useSizes();
  return (
    <div style={{ display: 'grid', gap: 'var(--s-7)', color: 'var(--text)', fontFamily: 'var(--font-body)' }}>
      {STACKS.map((stack) => (
        <section key={stack.token} style={{ display: 'grid', gap: 'var(--s-4)' }}>
          <h3
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--track)',
              fontSize: 'var(--t-lead)',
            }}
          >
            {stack.token}
          </h3>
          <p style={{ margin: 0, fontSize: 'var(--t-small)', opacity: 0.7, maxWidth: '68ch' }}>
            {stack.means}
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content max-content 1fr',
              gap: 'var(--s-3) var(--s-5)',
              // BASELINE, not centre: the five specimens are the same words at five sizes, and centring
              // line boxes of different sizes puts their baselines at different heights — which is the
              // same argument `.topbar` makes, and it is exactly what a type ladder must not do.
              alignItems: 'baseline',
            }}
          >
            {STEPS.map((step) => (
              <Specimen key={step.token} step={step} size={sizes.get(step.token) ?? ''} stack={stack.token} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Specimen({ step, size, stack }: { step: Step; size: string; stack: string }) {
  // The display stack is the CAPS treatment wherever it is used, so the specimen has to carry the
  // transform and the tracking too — a display face set in sentence case is not a face this app draws.
  const caps = stack === '--font-display';
  return (
    <>
      <code style={{ fontSize: 'var(--t-small)' }}>{step.token}</code>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', opacity: 0.75 }}>
        {size || 'undefined'}
      </span>
      <span
        style={{
          fontFamily: `var(${stack})`,
          fontSize: size || undefined,
          textTransform: caps ? 'uppercase' : 'none',
          letterSpacing: caps ? 'var(--track)' : 'normal',
        }}
        title={step.means}
      >
        {step.specimen}
      </span>
    </>
  );
}

export const FiveSteps: StoryObj = { render: () => <Specimens /> };
