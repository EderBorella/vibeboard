import type { Meta, StoryObj } from '@storybook/react-vite';

// A STACKING ORDER IS THE ONE PRIMITIVE YOU CANNOT SEE IN A LIST. `Design/Tokens` prints 5 / 20 / 60 / 80
// and four numbers in a column tell you nothing about whether the confirm dialog clears the modal it was
// raised from — which is the exact path `notes/atomic-revamp-plan.md` §3.3 argues the four layers on, and
// the exact path `styles.css:1358` gets wrong today with a comment claiming the opposite of its code.
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

const LAYERS = [
  {
    token: '--z-chrome',
    means: 'sticky chrome — a top bar, a column head, .explorer-head',
    ground: 'var(--panel)',
  },
  {
    token: '--z-pop',
    means: 'menus, popovers, and their own backdrops on the SAME layer',
    ground: 'var(--panel-2)',
  },
  { token: '--z-modal', means: 'a modal and its backdrop', ground: 'var(--accent-fill)' },
  {
    token: '--z-alert',
    means: 'a confirm raised from INSIDE a modal, and the halt overlay',
    ground: 'var(--danger)',
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
            border: '1px solid var(--border)',
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
