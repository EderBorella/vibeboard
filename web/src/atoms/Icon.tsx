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

import {
  Archive,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  ExternalLink,
  Eye,
  File,
  Flag,
  Folder,
  Link,
  type LucideIcon,
  Play,
  Plus,
  Settings,
  Sparkles,
  Square,
  Star,
  Tag,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react';

// THE SHAPES ARE LUCIDE'S, NOT MINE, AND THAT IS A CORRECTION.
//
// The first version of this file hand-drew all twenty-four on a 16-grid. They were adequate — checked at
// five sizes and three of them redrawn after looking — but hand-drawn geometry does not hold together as
// a SET. The optical weight, the corner radii and the way a stroke terminates have to agree across every
// shape or the row of them reads as a collection rather than a family, and that agreement is craft. Two
// of mine took three attempts each: the spanner and the chain both rendered as scribbles because my arc
// radii were smaller than half the chord, which SVG silently corrects into a semicircle.
//
// `lucide-react` is ISC, tree-shakeable — `sideEffects: false`, so only what is imported here ships —
// and maintained. NOTHING ELSE IN THIS FILE CHANGED: the argument at the top, the `1em` rule, the
// `currentColor` rule, `aria-hidden`, and no stylesheet are all still ours, and they are the part with
// the reasoning in them. Only the table's contents moved.

// FILLED OR OUTLINED, per icon. Lucide draws everything as an outline, which is right for most of these
// and wrong for the four that were solid characters: a play triangle, a stop square, a caret and a
// favourited star all read as solid marks, and an outlined one reads as a different control.
interface Art {
  of: LucideIcon;
  filled?: true;
}

// THE SET, and it is deliberately the census and nothing more. An icon nobody uses is an icon nobody
// notices going wrong, so this grows when a call site needs it and not before.
const ART = {
  // ✕ — the most common by a distance. Dismiss, close, remove.
  close: { of: X },
  'arrow-right': { of: ArrowRight },
  'arrow-left': { of: ArrowLeft },
  // ▾ ▸ ▴ — disclosure. Chevrons rather than the solid triangles they replace: the same hinge in three
  // rotations, which is what makes a tree's open and shut states read as one control.
  'caret-down': { of: ChevronDown },
  'caret-right': { of: ChevronRight },
  'caret-up': { of: ChevronUp },
  // ▶ and ■ — the transport. Solid, because a button's subject is a mark and not a diagram.
  play: { of: Play, filled: true },
  stop: { of: Square, filled: true },
  warning: { of: TriangleAlert },
  // 🔧 and 👁 and 🧠 — the model picker's three capability badges, at 11px beside each other. The third
  // is a SPARKLE and not a brain: a brain is not drawable at that size, and the sparkle is both the
  // conventional mark for reasoning and distinct from the two beside it, which is a badge's whole job.
  tool: { of: Wrench },
  eye: { of: Eye },
  reasoning: { of: Sparkles },
  // 🆓 — a model that costs nothing. A price tag, because "free" has no shape of its own.
  free: { of: Tag },
  link: { of: Link },
  // 📄 and 📁 — the Explorer's two row kinds, and the pair a reader tells apart while scanning a column.
  file: { of: File },
  folder: { of: Folder },
  settings: { of: Settings },
  // ★ and ☆ — the same shape, filled or not, so a toggled favourite does not change outline when it
  // changes state.
  'star-filled': { of: Star, filled: true },
  star: { of: Star },
  archive: { of: Archive },
  flag: { of: Flag },
  plus: { of: Plus },
  // ⤴ — a symlink resolving OUTSIDE the project: listed so it can be removed, never traversed.
  'out-of-tree': { of: ExternalLink },
  // ？ — an entry that is neither a file nor a directory. The tab lists it because an entry it hides is
  // an entry nobody can remove.
  unknown: { of: CircleHelp },
} as const satisfies Record<string, Art>;

// LUCIDE'S OWN DEFAULT IS 2 ON A 24-GRID and it is left alone. The hand-drawn set needed 1.7 on a 16-grid
// — 2.55 in these units — because thin outlines of my drawing lost the weight the glyphs they replaced
// had. These shapes are tuned; a thumb on the scale here would be undoing that.
const WEIGHT = 2;

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
  const { of: Shape, filled } = ART[name] as Art;
  return (
    <Shape
      // `1em` ON BOTH AXES — lucide puts `size` on width and height, and a string is allowed. This is the
      // rule the whole atom is for: an icon is the size of the type step it sits in, and no gate has a
      // length to check.
      size="1em"
      strokeWidth={WEIGHT}
      // `inline-block`, NOT `block`, and that is a correction the owner found on screen.
      //
      // It was `block`, on the reasoning that an inline SVG sits on the text baseline and inherits the
      // line box's descender gap — true — with the comment "every call site puts it in a flex row". That
      // was an assumption and it was false for a dozen of them: a card tile's flag and link chips put the
      // icon inline beside a count, and a block-level SVG takes the whole line, so the count dropped
      // underneath and the chip grew into a tall box. Visible immediately, invisible to every gate.
      //
      // `inline-block` + `vertical-align: middle` works in BOTH places. A flex parent blockifies its
      // items and ignores `vertical-align`, so every button is exactly as it was; inline, the box centres
      // on the text's midline instead of hanging off its baseline, which is the gap this atom exists to
      // close. `middle` is a keyword rather than a tuned length — the thing the top of this file refuses.
      style={{ display: 'inline-block', verticalAlign: 'middle', flex: 'none' }}
      // Lucide already draws in `currentColor`; the fill is ours, for the four that were solid marks.
      {...(filled ? { fill: 'currentColor' } : {})}
      // `focusable` is not in React's SVG types but IS honoured by the browsers that tab into SVG.
      // Without it an icon inside a button is a second tab stop on the same control.
      focusable="false"
      aria-hidden="true"
      {...(className ? { className } : {})}
    />
  );
}
