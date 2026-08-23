import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './templates/App';
// EVERY STYLESHEET, IN CASCADE ORDER, from the one list `./styles.ts` holds — see there for why the
// order is load-bearing and why it is not written out twice.
import './styles';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root is missing from index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
