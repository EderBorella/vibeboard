import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionProvider } from './design/MotionProvider';
import { App } from './shell/App';
// EVERY STYLESHEET, IN CASCADE ORDER, from the one list `./styles.ts` holds — see there for why the
// order is load-bearing and why it is not written out twice.
import './styles';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root is missing from index.html');

createRoot(rootEl).render(
  <StrictMode>
    {/* AT THE ROOT AND NOT INSIDE `App`, because `App` has early returns — the sign-in gate and the
        no-project state each return before the shell renders, and a provider mounted inside it would
        not cover them. Motion is configuration, not layout: it belongs where nothing can branch
        around it. See design/MotionProvider.tsx for what it configures and why. */}
    <MotionProvider>
      <App />
    </MotionProvider>
  </StrictMode>,
);
