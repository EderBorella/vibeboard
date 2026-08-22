import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
// Geometry before colour, and both before anything that spends them: the primitives are one layer and
// the split is what `npm run check:tokens` asserts.
import './design/tokens.css';
import './design/themes.css';
// BEFORE styles.css, so a surface can still override a primitive's COLOUR at equal specificity — the
// emergency stop is a ghost button with a danger hover, and the connection light tints its own dot.
// What stops that override becoming a padding is `npm run check:radius-scale`, not the cascade.
import './ui/primitives.css';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root is missing from index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
