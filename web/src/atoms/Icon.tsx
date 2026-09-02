// ARTWORK WHOSE BOX IS ITS ARTWORK — the whole reason this exists.
//
// Every icon in this app was a text character until now, and the measurement that ended that was the
// auto-pilot Start button: its `▶` sat visibly low beside the word "Start". Measured in the browser
// rather than guessed at, the glyph's box and the label's box were IDENTICAL — same 14px line box, same
// baseline, `align-items: center` centring both, off by 0px. What was off was the ink inside the box. At
// the button's own 12px/600 face, `TextMetrics` gives:
//
//     ▶       ascent 8px   descent 2px   ink centre +3px
//     Start   ascent 9px   descent 0px   ink centre +4.5px
//
// So the arrow sits 1.5px low — 0.125em. That is not this font being odd and it is not fixable where it
// appears: geometric glyphs are drawn centred on the MATHS AXIS, letters are read centred on HALF THEIR
// CAP HEIGHT, and nothing in CSS aligns ink. Any correction applied to the character is a magic number
// tuned to one font at one size, silently wrong at the next type step.
//
// An SVG has no such gap. Centring the box centres the shape, at every size, in every font.
//
// FOUR PROPERTIES, AND EACH ONE REMOVES A HAND-WRITTEN VALUE:
//
//  - `1em` ON BOTH AXES, so an icon is the size of the type step it sits in and no gate has a length to
//    check. A `px` here would be the eleventh box height Parts One to Four spent four phases deleting.
//  - `currentColor`, so it follows a Button's variant, its hover and its `:disabled` opacity, and never
//    names a colour of its own. Nothing here may appear in `check:state-tones`.
//  - `aria-hidden` ALWAYS, with `focusable="false"` for the browsers that still tab into SVG. Every call
//    site is a control that already carries its own label, so an icon that announced itself would make
//    every one of them say its name twice.
//  - AND NO STYLESHEET. `check:class-budget` is a ratchet with zero slack; all four of the above are
//    attributes rather than rules. An icon that wants a class is a signal it is doing something an icon
//    should not — `Pulse` is the precedent, and it has no sheet either.
//
// `viewBox="0 0 16 16"` FOR EVERY ONE, so the shapes share a grid and a stroke weight. A per-icon
// viewBox is how an icon set stops looking like a set.

import type { ReactNode } from 'react';

// STROKED OR FILLED, PER ICON, because the two cannot share a rule. An outline drawn with a fill is a
// blob and a solid triangle drawn with a stroke is a wireframe — `▶`, `▾`, `▴` and `■` were solid
// characters and have to stay solid, while `⚙` and `👁` were outlines.
type Ink = 'stroke' | 'fill';

interface Art {
  ink: Ink;
  d: ReactNode;
}

// 1.7 AT 16px. It was 1.5, and 1.5 was too light — seen in the Explorer, where a column of thirty rows
// each carrying a thin outline reads as grey texture rather than as icons. A glyph fills more of its box
// than a stroked shape does, so replacing one with the other loses weight unless the stroke pays it back.
// At 1 the strokes disappear on a light theme; at 2 the small ones fill in; 1.7 is what survives 11px and
// still has presence at 13.
const WEIGHT = 1.7;

// THE SET, and it is deliberately the census and nothing more. Twenty symbols were counted across
// `web/src`; an icon nobody uses is an icon nobody notices going wrong, so this grows when a call site
// needs it and not before.
const ART: Record<string, Art> = {
  // ✕ — 24 instances, the most common by a distance. Dismiss, close, remove.
  close: { ink: 'stroke', d: <path d="M4 4l8 8M12 4l-8 8" /> },
  // → and ← — a hand-over, a step, a link to somewhere.
  'arrow-right': { ink: 'stroke', d: <path d="M3 8h10M9 4l4 4-4 4" /> },
  'arrow-left': { ink: 'stroke', d: <path d="M13 8H3M7 4L3 8l4 4" /> },
  // ▾ ▸ ▴ — disclosure. Solid, and the same triangle rotated, so a tree's open and shut states are the
  // same shape and read as one control rather than two.
  'caret-down': { ink: 'fill', d: <path d="M4 6.5h8L8 11z" /> },
  'caret-right': { ink: 'fill', d: <path d="M6.5 4v8L11 8z" /> },
  'caret-up': { ink: 'fill', d: <path d="M4 9.5h8L8 5z" /> },
  // ▶ — the transport play. Slightly narrower than the caret: it is a button's subject, not a hinge.
  play: { ink: 'fill', d: <path d="M5 3.5v9L12.5 8z" /> },
  // ■ — stop. A square with the corners softened, because a hard square at 11px reads as a bullet.
  stop: { ink: 'fill', d: <rect x="4" y="4" width="8" height="8" rx="1.2" /> },
  // ⚠ — the warning triangle. Bang drawn as two pieces so the dot stays a dot at every size.
  warning: {
    ink: 'stroke',
    d: (
      <>
        <path d="M8 2.5L14.5 13.5h-13z" strokeLinejoin="round" />
        <path d="M8 6.5v3.5" />
        <circle cx="8" cy="12" r="0.6" fill="currentColor" stroke="none" />
      </>
    ),
  },
  // 🔧 — tool use. A spanner as ONE outline: the open jaw, the round of the head, and the shaft.
  //
  // The first two attempts drew the head as a separate arc plus a zigzag jaw, and both rendered as a
  // scribble. One closed path is what makes it read — the jaw is a notch in the outline rather than a
  // shape sitting on top of one.
  tool: {
    ink: 'stroke',
    d: (
      <path
        d="M12.1 2.1a3.4 3.4 0 00-3.2 5.4l-5.5 5.5a1.3 1.3 0 001.8 1.8l5.5-5.5a3.4 3.4 0 003.2-5.4L11.6 6 9.9 4.3z"
        strokeLinejoin="round"
      />
    ),
  },
  // 🔗 — a link between two cards. Two half-links and the bar between them.
  //
  // THE RADIUS MUST EXCEED HALF THE CHORD, and the first version's did not: `a2.5 2.5` across a delta of
  // (3.6, 3.6) is a chord of 5.09 against a radius of 2.5, so SVG scales the radius up to make the arc
  // reachable and draws a semicircle. Both halves came out as hooks and the icon read as a squiggle.
  // Nothing warns about it — it is a silent correction in the renderer, visible only by looking.
  link: {
    ink: 'stroke',
    d: (
      <>
        <path d="M6.4 9.6l3.2-3.2" strokeLinecap="round" />
        <path d="M9.2 5.2l1.4-1.4a3 3 0 014.2 4.2l-1.4 1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.8 10.8l-1.4 1.4a3 3 0 01-4.2-4.2l1.4-1.4" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  // 📄 and 📁 — the explorer's two row kinds. The page has its corner folded, which is what tells them
  // apart at a glance when they are stacked in a tree.
  file: {
    ink: 'stroke',
    d: (
      <>
        <path
          d="M9.4 1.4H4.2a.9.9 0 00-.9.9v11.4a.9.9 0 00.9.9h7.6a.9.9 0 00.9-.9V4.4z"
          strokeLinejoin="round"
        />
        <path d="M9.4 1.4v3h3.3" strokeLinejoin="round" />
      </>
    ),
  },
  // THE TAB HAS TO BE A REAL STEP. The first version's was 0.8 units on a 16 grid — at 13px, which is
  // where the Explorer draws it, that is one and a half pixels and the icon read as a plain rounded
  // rectangle indistinguishable from the page beside it. Seen at 4x on the real tree, not reasoned about.
  folder: {
    ink: 'stroke',
    d: (
      <path
        d="M1.5 13.1V3.6a.9.9 0 01.9-.9h3.3a.9.9 0 01.71.35L7.7 4.8h5.8a.9.9 0 01.9.9v7.4a.9.9 0 01-.9.9H2.4a.9.9 0 01-.9-.9z"
        strokeLinejoin="round"
      />
    ),
  },
  // 👁 — watching, or a preview.
  eye: {
    ink: 'stroke',
    d: (
      <>
        <path d="M1.5 8S4 4 8 4s6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4z" strokeLinejoin="round" />
        <circle cx="8" cy="8" r="1.8" />
      </>
    ),
  },
  // ⚙ — settings. Six teeth rather than eight: eight blur into a circle below 14px.
  settings: {
    ink: 'stroke',
    d: (
      <>
        <circle cx="8" cy="8" r="4.6" />
        <circle cx="8" cy="8" r="1.8" />
        <path
          d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8L3.5 3.5"
          strokeLinecap="round"
        />
      </>
    ),
  },
  // ★ and ☆ — the same outline, filled or not, so a toggled favourite does not change shape when it
  // changes state.
  'star-filled': {
    ink: 'fill',
    d: <path d="M8 1.8l1.9 4 4.3.6-3.1 3 .8 4.3L8 11.7l-3.9 2 .8-4.3-3.1-3 4.3-.6z" />,
  },
  star: {
    ink: 'stroke',
    d: <path d="M8 1.8l1.9 4 4.3.6-3.1 3 .8 4.3L8 11.7l-3.9 2 .8-4.3-3.1-3 4.3-.6z" strokeLinejoin="round" />,
  },
  // 🗄 — the archive drawer.
  archive: {
    ink: 'stroke',
    d: (
      <>
        <rect x="2" y="3" width="12" height="3" rx="0.8" />
        <path d="M3 6v7h10V6" strokeLinejoin="round" />
        <path d="M6.5 9h3" strokeLinecap="round" />
      </>
    ),
  },
  // ＋ — the new-file and new-folder actions, which pair it with the kind being created.
  plus: { ink: 'stroke', d: <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" /> },
  // ⤴ — a symlink that resolves OUTSIDE the project. Listed so it can be removed, never traversed, so
  // the arrow leaves the box rather than pointing within it.
  'out-of-tree': {
    ink: 'stroke',
    d: (
      <>
        <path d="M13 3h-3M13 3v3M13 3L8.5 7.5" strokeLinecap="round" strokeLinejoin="round" />
        <path
          d="M11 9.5v3.3a.7.7 0 01-.7.7H3.7a.7.7 0 01-.7-.7V6.2a.7.7 0 01.7-.7H7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  // ？ — an entry that is neither a file nor a directory: a socket, a device, a broken link. The tab
  // lists it because an entry it hides is an entry nobody can remove.
  unknown: {
    ink: 'stroke',
    d: (
      <>
        <path
          d="M6.1 6.1a2 2 0 113 1.7c-.6.4-1.1.8-1.1 1.6v.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="8" cy="12" r="0.7" fill="currentColor" stroke="none" />
      </>
    ),
  },
  // 🆓 — a model that costs nothing. A price tag, because "free" has no shape of its own and the tag is
  // what the badge is about: a price, and this one is zero.
  free: {
    ink: 'stroke',
    d: (
      <>
        <path
          d="M8.2 1.8H2.6a.8.8 0 00-.8.8v5.6a.8.8 0 00.23.57l5.6 5.6a.8.8 0 001.13 0l5.6-5.6a.8.8 0 000-1.13l-5.6-5.6a.8.8 0 00-.57-.23z"
          strokeLinejoin="round"
        />
        <circle cx="5" cy="5" r="0.9" />
      </>
    ),
  },
  // ⚑ — flagged, and the only asymmetric shape here: a flag that pointed both ways would be a diamond.
  flag: {
    ink: 'stroke',
    d: (
      <>
        <path d="M4 14V2.5" strokeLinecap="round" />
        <path d="M4 3h8l-2 2.75L12 8.5H4z" strokeLinejoin="round" />
      </>
    ),
  },
  // 🧠 — the model picker's REASONING badge, and it sits beside tool-use and vision at 11px. A brain is
  // not drawable at that size: the first attempt rendered as a circle with a line through it. A sparkle
  // is the conventional mark for it, it survives 11px, and it is distinct from the two badges beside it,
  // which is the whole job of a badge.
  reasoning: {
    ink: 'fill',
    d: (
      <>
        <path d="M7.4 1.9l1.1 3.3 3.3 1.1-3.3 1.1-1.1 3.3-1.1-3.3L3 7.3l3.3-1.1z" />
        <path d="M12.1 9.4l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z" />
      </>
    ),
  },
};

export type IconName = keyof typeof ART;

// EVERY NAME THE SET HOLDS, for the Inventory story and for a test that wants to render all of them
// rather than a list it has to keep in step by hand.
export const ICON_NAMES = Object.keys(ART) as IconName[];

interface Props {
  name: IconName;
  // LAYOUT ONLY, the same allowance every other atom makes — `vb-fixed` on a row, and nothing else. An
  // icon that wants a class of its own is the signal described at the top of this file.
  className?: string;
}

export function Icon({ name, className }: Props) {
  const art = ART[name];
  const stroked = art.ink === 'stroke';
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      // `block` because an inline SVG sits on the text baseline and gains the line box's descender gap,
      // which is the very thing this atom exists to remove. Every call site puts it in a flex row.
      style={{ display: 'block', flex: 'none' }}
      fill={stroked ? 'none' : 'currentColor'}
      stroke={stroked ? 'currentColor' : 'none'}
      strokeWidth={stroked ? WEIGHT : undefined}
      // `focusable` is not a React DOM property in the types but IS honoured by browsers that tab into
      // SVG; without it an icon inside a button is a second tab stop on the same control.
      focusable="false"
      aria-hidden="true"
      {...(className ? { className } : {})}
    >
      {art.d}
    </svg>
  );
}
