import type { StorybookConfig } from '@storybook/react-vite';
import react from '@vitejs/plugin-react';

// THE WORKBENCH. Every element of the app, on its own, in all three themes.
//
// WHY IT EXISTS, in the owner's words: "for a 6 or 7 page app, hundreds of classes seems totally off —
// it means we don't have standards". The app has ONE screen's worth of chrome rebuilt in seventeen
// feature directories, and nothing has ever shown the pieces side by side. A census in a document says
// there are ten control heights; a page showing the ten of them next to each other is what makes that a
// design problem rather than a number. This is the instrument for the atomic-design work, not a
// deliverable of it.
//
// STORIES LIVE BESIDE THE COMPONENT, `web/src/**/*.stories.tsx`, and the gates in `tools/` deliberately
// do NOT read them — see the exclusion in `tools/lib/source.mjs`. A story is not application code, and a
// class kept alive only by a story is exactly the dead class `check:class-budget` exists to find.
//
// `@vitejs/plugin-react` IS ADDED BY HAND, AND IT HAS TO BE — `@storybook/react-vite` does not supply it.
// That is measured rather than assumed: printing the plugin chain from `viteFinal` lists fifteen
// `storybook:*` plugins and no React one, with `vite.esbuild` undefined. So JSX fell through to whichever
// tsconfig esbuild resolved, which from the project root is `./tsconfig.json` — a Node config with no
// `jsx` field — and every story built cleanly and then died at run time on `React is not defined`, the
// classic transform emitting `React.createElement` with nothing importing React.
//
// TWO WRONG FIXES WERE TRIED FIRST, both recorded because each looked right. Rooting Vite at `web/` so
// `web/tsconfig.json`'s `"jsx": "react-jsx"` would apply moves `.storybook/preview.tsx` OUTSIDE the root,
// which breaks it the same way. And setting `esbuild.jsx` would work while quietly giving the workbench a
// different transform from the app's. The app renders through this exact plugin; so does this.
//
// A CLEAN BUILD IS NOT EVIDENCE HERE, which is the trap worth naming: the first attempted fix produced a
// bundle with a byte-identical hash to the broken one, so "it rebuilt successfully" meant nothing. The
// output directory has to be deleted and the story actually rendered in a browser.
//
// AND `npm run storybook:build` IS NOT A TYPECHECK — measured, not assumed. It exits 0 on a tree with a
// hard TS error in it (`.storybook/route-stub.ts`'s `StubHandler | unknown`, which `tsc` rejects and which
// broke `npm run build`), because esbuild strips types without checking them. Never quote a green Storybook
// build as evidence about types; `npm run typecheck` ×4 is the only thing that says anything about them.
const config: StorybookConfig = {
  stories: ['../web/src/**/*.stories.tsx'],
  // THE ONE ADDON, and it is built in rather than fetched. The plan's acceptance for the page stories is
  // "each at 900 / 1200 / 1440": the app has two `@media (max-width: 1100px)` rules and a `@container`
  // query on the boards, so a fixed-width DIV would show the wrong layout at 900 while looking right. The
  // viewport has to be the real one.
  addons: ['storybook/viewport'],
  framework: { name: '@storybook/react-vite', options: {} },
  // Dev-only, and never deployed: the app is served by the Fastify process from `dist/web`, which this
  // does not touch. `storybook build` emits to `storybook-static/`, which is gitignored.
  core: { disableTelemetry: true },
  viteFinal: (vite) => ({ ...vite, plugins: [...(vite.plugins ?? []), react()] }),
};

export default config;
