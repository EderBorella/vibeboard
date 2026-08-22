import type { Decorator, Preview } from '@storybook/react-vite';
import { useEffect } from 'react';
// THE SAME FOUR FILES THE APP LOADS, IN THE SAME ORDER, and the order is load-bearing rather than tidy:
// `primitives.css` comes BEFORE `styles.css` so a surface can still override a primitive's COLOUR at
// equal specificity — the emergency stop is a ghost button with a danger hover, the connection light
// tints its own dot. Loading them the other way round here would make this workbench show a cascade the
// app does not have, which is worse than showing nothing.
import '../web/src/design/tokens.css';
import '../web/src/design/themes.css';
import '../web/src/ui/primitives.css';
import '../web/src/styles.css';

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
  },
};

export default preview;
