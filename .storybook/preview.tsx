import type { Decorator, Preview } from '@storybook/react-vite';
import { useEffect } from 'react';
// THE SAME SHEETS THE APP LOADS, IN THE SAME ORDER, and it is the app's own list rather than a copy of
// it: the order is load-bearing — `ui/primitives.css` comes before every surface sheet so a surface can
// still override a primitive's COLOUR at equal specificity — and a workbench showing a cascade the app
// does not have is worse than one showing nothing. Fifty files is far past what a second copy could
// be trusted to keep in step, so there is only one. See web/src/styles.ts.
import '../web/src/styles';

// EVERY STORY IN EVERY THEME, because a geometry claim about one theme is a claim about none — the rule
// `visual/support/fixtures.ts` already runs the browser harness by. The three are not skins: `themes.css`
// carries measured contrast ratios and a per-theme argument, and `--glow` is `none` in two of them.
const THEMES = ['cyberpunk', 'classic-dark', 'marshmallow'] as const;

// `data-theme` ON `<html>`, which is where `themes.css` looks for it and where the app's own `useTheme`
// puts it. Set from an effect rather than at module scope so switching the toolbar re-runs it.
const withTheme: Decorator = (Story, context) => {
  const theme = String(context.globals.theme ?? THEMES[0]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return <Story />;
};

// THE THREE WIDTHS THE PLAN ACCEPTS A PAGE AT. Named here rather than per story so the toolbar offers the
// same three everywhere and a page story is three `globals` lines rather than three copies of this block.
// They are viewport widths and not container widths — `app-shell.css` and `diary.css` each carry a
// `@media (max-width: 1100px)`, so 900 is a different layout and not a narrower one.
export const WIDTHS = {
  w900: { name: '900', styles: { width: '900px', height: '900px' }, type: 'desktop' as const },
  w1200: { name: '1200', styles: { width: '1200px', height: '900px' }, type: 'desktop' as const },
  w1440: { name: '1440', styles: { width: '1440px', height: '900px' }, type: 'desktop' as const },
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Which theme the elements are drawn in',
      toolbar: {
        title: 'Theme',
        items: THEMES.map((value) => ({ value, title: value })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: THEMES[0] },
  parameters: {
    // The app's ground, so a panel on `--panel` is not read against white. `!important`-free: the
    // preview body is Storybook's own element and nothing in the app styles it.
    backgrounds: { disable: true },
    layout: 'padded',
    controls: { expanded: true },
    viewport: { options: WIDTHS },
  },
};

export default preview;
