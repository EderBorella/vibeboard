import type { Meta, StoryObj } from '@storybook/react-vite';

// A STACKING ORDER IS THE ONE PRIMITIVE YOU CANNOT SEE IN A LIST. `Design/Tokens` prints 5 / 20 / 60 / 80
// and four numbers in a column tell you nothing about whether the confirm dialog clears the modal it was
// raised from — which is the exact path `docs/design-system.md` (*The atomic revamp: the four layers*)
// argues the four layers on, and
// the exact path `organisms/autopilot/halt.css` gets wrong today with a comment claiming the opposite
// of its code.
//
// So the four boxes OVERLAP on purpose. Each one is positioned to sit on top of the previous, and the
// only thing deciding which wins is the `z-index` token. If two of them were merged, the picture would
// change; that is the whole assertion, and it is made by eye because it is a picture.
//
// The boxes take their z-index from the token and nothing else — no `isolation`, no stacking context
// between them — so this page reads the same way the app's chrome does.

const meta = {
  title: 'Design/Layers',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;

// A GROUND TAKES THE INK THE PALETTE MEASURED FOR IT, and getting that wrong made five of these twelve
// labels unreadable: `--text` on `--accent-fill` is 1.97:1 in cyberpunk and 2.24:1 in classic-dark, and
// `--text` on `--danger` is 2.15–2.63:1 in all three. `--accent-fill` has an ink and its name is
// `--on-fill` — design/themes.css measures that pair at 7.41:1 and says so — which fixes three of the five.
//
// `--danger` HAS NO MEASURED INK, so it stops being a ground rather than acquiring one: no palette pair
// clears 4.5:1 on it (`--on-fill` reaches 6.37 and 5.86 in the dark themes and 2.30 in marshmallow, whose
// danger is a dark red), and inventing a value is out — the plan changes no palette value anywhere. The
// hue moves to a `--rule` rail instead, which is what `--rule` is for: an edge that carries meaning.
interface Layer {
  token: string;
  means: string;
  ground: string;
  ink: string;
  rail?: string;
}

const LAYERS: Layer[] = [
  {
    token: '--z-chrome',
    means: 'sticky chrome — a top bar, a column head, .explorer-head',
    ground: 'var(--panel)',
    ink: 'var(--text)',
  },
  {
    token: '--z-pop',
    means: 'menus, popovers, and their own backdrops on the SAME layer',
    ground: 'var(--panel-2)',
    ink: 'var(--text)',
  },
  {
    token: '--z-modal',
    means: 'a modal and its backdrop',
    ground: 'var(--accent-fill)',
    ink: 'var(--on-fill)',
  },
  {
    token: '--z-alert',
    means: 'a confirm raised from INSIDE a modal, and the halt overlay',
    ground: 'var(--panel)',
    ink: 'var(--text)',
    rail: 'var(--danger)',
  },
];

export const FourLayers: StoryObj = {
  render: () => (
    <div
      style={{
        position: 'relative',
        height: 260,
        fontFamily: 'var(--font-body)',
        color: 'var(--text)',
        fontSize: '0.75rem',
      }}
    >
      {/* PAINTED IN REVERSE DOM ORDER, so that source order alone would put `--z-chrome` on top: the
          picture is only right if the token is what decided it. */}
      {[...LAYERS].reverse().map((layer) => (
        <div
          key={layer.token}
          style={{
            position: 'absolute',
            top: LAYERS.indexOf(layer) * 44,
            left: LAYERS.indexOf(layer) * 56,
            width: 420,
            height: 96,
            zIndex: `var(${layer.token})`,
            background: layer.ground,
            color: layer.ink,
            border: '1px solid var(--border)',
            borderLeft: layer.rail ? `var(--rule) solid ${layer.rail}` : '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--lift)',
            padding: 'var(--s-5)',
            display: 'grid',
            gap: 'var(--s-2)',
            alignContent: 'start',
          }}
        >
          <code style={{ fontSize: '0.75rem' }}>{layer.token}</code>
          <span style={{ opacity: 0.8 }}>{layer.means}</span>
        </div>
      ))}
    </div>
  ),
};
