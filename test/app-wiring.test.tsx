// @vitest-environment jsdom
//
// THE ONE HOP NOTHING PINNED. `refusalKind` travels `App.tsx → TopBar → ConnectionLight → lightAdvice`.
// Every hop after `TopBar` is held by a planted defect, and `lightProps` — the pure function that
// computes what `TopBar` is given — has its own file in `test/light-props.test.ts`. What nothing
// covered is the first hop: that `App` actually calls it and hands the result on. There is no React
// test for `App.tsx` at all; every `test/app.*.ts` is a server test despite the name.
//
// So a prop dropped in `App.tsx` would silently return the connection balloon to naming the wrong
// cause, and the suite would stay green — which is how the original defect got in.
//
// WHAT THIS DELIBERATELY IS NOT: a test of the whole shell. `App` is a composition root, and pinning
// its output would mean asserting on everything below it. It mocks the network-facing hooks and
// asserts one thing — the sandbox's refusal reaches the bar with its KIND intact, not flattened to a
// generic fault. That is the claim the entry makes and the whole of what was missing.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The network-facing hooks, stubbed at the module boundary. Each returns the shape its consumer reads
// and nothing more; anything richer would be this file inventing a second source of truth for what a
// hook returns, which is what `test/mirror.test.ts` exists to prevent elsewhere.
const sandbox = vi.hoisted(() => ({ state: null as unknown }));

vi.mock('../web/src/lib/ws', () => ({
  useSharedWs: () => ({ subscribe: () => () => {}, send: () => {}, state: 'open' }),
}));
vi.mock('../web/src/lib/useSnapshot', () => ({
  useSnapshot: () => ({
    snapshot: {
      name: 'T',
      boards: { features: [], product: [], engineering: [] },
      // `config.copilot` is read in three places in App, so the stub carries it — a snapshot without
      // one is not a state the app can be in.
      config: { copilot: { backend: 'claude-code', model: 'opus', effort: 'high' }, boards: {} },
    },
    conn: 'online',
  }),
}));
vi.mock('../web/src/lib/useSandbox', () => ({ useSandbox: () => ({ sandbox: sandbox.state }) }));
vi.mock('../web/src/lib/useSignin', () => ({
  useSignin: () => ({ signedIn: true, waiting: false, refused: false, retry: () => {} }),
}));
vi.mock('../web/src/lib/usePendingSignins', () => ({ usePendingSignins: () => [] }));
vi.mock('../web/src/lib/useAutopilot', () => ({ useAutopilot: () => ({ state: null, refresh: () => {} }) }));
vi.mock('../web/src/organisms/copilot/useCopilot', () => ({
  useCopilot: () => ({
    items: [],
    running: false,
    stats: { costUsd: 0, turns: 0, lastDurationMs: 0, contextTokens: 0 },
    chats: [],
    currentChatId: null,
    send: vi.fn(),
    compact: vi.fn(),
    newSession: vi.fn(),
    openChat: vi.fn(),
    deleteChat: vi.fn(),
    cancel: vi.fn(),
    authorised: false,
    setCopilotAuthority: vi.fn(),
    sentAt: { current: null },
    lastEventAt: { current: null },
    sawText: { current: false },
  }),
}));
vi.mock('../web/src/organisms/runs/useRuns', () => ({ useRuns: () => ({ runs: [], refresh: () => {} }) }));
vi.mock('../web/src/organisms/skills/useSkills', () => ({ useSkills: () => ({ skills: [], problems: [] }) }));

const { App } = await import('../web/src/shell/App.js');

afterEach(cleanup);

describe('App hands the sandbox refusal to the bar with its kind intact', () => {
  it('names the CAUSE, not a generic fault, when the sandbox refuses', async () => {
    // `docker` is the kind whose remedy differs most from the others — it is the one where the answer
    // is "build the image", not "sign in again". If the kind is dropped anywhere on the way, the
    // balloon falls back to a generic refusal and this assertion fails.
    sandbox.state = {
      ok: false,
      agentRefusal: 'Docker is not running, so no agent can start.',
      refusalKind: 'docker',
      recentFailure: null,
    };
    render(<App />);
    // The light is in the top bar and titles itself from the server's own sentence — which is the
    // thing that must survive the hop, since `lightAdvice` refuses to reword it.
    const light = await screen.findByTitle(/Docker is not running/);
    expect(light).toBeTruthy();
  });

  // THE NEGATIVE, and without it the assertion above passes on an App that renders the refusal
  // unconditionally. A healthy sandbox must produce no refusal text at all.
  it('says nothing about a refusal when the sandbox is healthy', async () => {
    sandbox.state = { ok: true, agentRefusal: null, refusalKind: null, recentFailure: null };
    render(<App />);
    await screen.findByRole('banner').catch(() => null);
    expect(screen.queryByTitle(/Docker is not running/)).toBeNull();
  });
});
