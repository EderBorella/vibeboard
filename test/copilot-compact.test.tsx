// @vitest-environment jsdom
//
// THE PANEL WITHOUT THE DOCK AROUND IT (ruling W11). `compact` is not a style: it decides which of the
// panel's rows are the CONVERSATION and which are the DOCK asking about it. Setup's review embeds this
// organism beside six documents it has just written, and every control it drops there is either a
// question the wizard has already answered on an earlier screen — which assistant, which model, may it
// write — or a way out of a screen that has exactly one way on.
//
// BOTH DIRECTIONS, IN ONE FILE, AND THAT IS THE POINT. A test that only asserted the absences would pass
// on a panel that renders nothing at all, and one that only asserted the dock would not notice `compact`
// being ignored. Each piece is named twice: gone under `compact`, there without it.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listModels: vi.fn(),
  getModelStatus: vi.fn(),
}));
vi.mock('../web/src/lib/api.js', () => api);
vi.mock('../web/src/lib/api', () => api);

const { CopilotPanel } = await import('../web/src/organisms/copilot/CopilotPanel.js');

afterEach(cleanup);
beforeEach(() => {
  // The CALLS, not the implementations: two cases below assert that a compact panel asks for nothing,
  // and a spy carrying the previous case's dock renders would answer for them.
  vi.clearAllMocks();
  // jsdom implements no scrolling, and the transcript scrolls itself to the bottom on mount — the same
  // environment gap test/thinking-indicator-renders.test.tsx names.
  Element.prototype.scrollTo = vi.fn();
  api.listModels.mockResolvedValue([]);
  api.getModelStatus.mockResolvedValue(null);
});

// One turn in the transcript, because an empty one cannot say whether the transcript rendered.
function copilotStub(over: Record<string, unknown> = {}) {
  return {
    items: [
      { id: 1, kind: 'user' as const, text: 'the testing one reads like a list of rules' },
      { id: 2, kind: 'assistant' as const, text: 'Rewritten — it says what a smoke test means here.' },
    ],
    running: false,
    stats: { costUsd: 1.5, turns: 4, lastDurationMs: 2000, contextTokens: 9000 },
    chats: [{ id: 'c-1', title: 'Setting the project up', backend: 'claude-code', updatedAt: '' }],
    currentChatId: 'c-1',
    send: vi.fn(),
    compact: vi.fn(),
    newSession: vi.fn(),
    openChat: vi.fn(),
    deleteChat: vi.fn(),
    cancel: vi.fn(),
    authorised: false,
    setCopilotAuthority: vi.fn(),
    sessionId: undefined,
    model: undefined,
    sentAt: { current: null },
    lastEventAt: { current: null },
    sawText: { current: false },
    ...over,
  };
}

function panel(props: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
  const copilot = copilotStub(over) as never;
  return render(
    <CopilotPanel
      copilot={copilot}
      backend="claude-code"
      mode={'bypassPermissions' as never}
      model="sonnet"
      effort={'medium' as never}
      contextBudget={200_000}
      overridden={false}
      onMode={vi.fn()}
      onModel={vi.fn()}
      onEffort={vi.fn()}
      onBackend={vi.fn()}
      onReset={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

// Each row of the dock, named by something only it renders. The ✕ is found by its title because its
// label is an icon, and the readout by the turn count — the one figure on the surface that is a number
// of turns rather than a cost or a percentage.
const CHROME: [string, () => unknown][] = [
  ['the panel title', () => screen.queryByText('Copilot')],
  ['the assistant picker', () => screen.queryByLabelText('Backend')],
  ['the chat history', () => screen.queryByRole('button', { name: /Setting the project up/ })],
  ['the authority grant', () => screen.queryByRole('button', { name: 'Authorise' })],
  ['the compact-the-conversation button', () => screen.queryByRole('button', { name: 'Compact' })],
  ['the effort select', () => screen.queryByRole('combobox')],
  ['the spend readout', () => screen.queryByText('4 turns')],
  ['the hide control', () => screen.queryByTitle('Hide (session keeps running)')],
];

describe('the compact panel', () => {
  it('renders none of the dock’s own controls', () => {
    panel({ compact: true });

    for (const [what, find] of CHROME) expect(find(), `${what} is still rendered under compact`).toBeNull();
  });

  // THE SAME LIST, WITHOUT THE OPTION. Without this the case above passes on a panel that stopped
  // rendering its header for some other reason entirely — or on a `compact` that is always on.
  it('leaves every one of them in place without it', () => {
    panel();

    for (const [what, find] of CHROME) expect(find(), `${what} is missing from the dock`).toBeTruthy();
  });

  // WHAT IT IS FOR: the conversation, and the four things that make it usable.
  it('keeps the transcript, the composer and the way to stop a turn', () => {
    // THE CLOCKS PUT BACK PAST THE STALL THRESHOLD, because Cancel is the one control the indicator
    // offers conditionally: a turn that has said nothing for 90 seconds is the state it exists for, and
    // a fresh `sentAt` renders the reassuring half with no button on it at all.
    const stalled = Date.now() - 120_000;
    panel(
      { compact: true },
      { running: true, sentAt: { current: stalled }, lastEventAt: { current: stalled } },
    );

    const transcript = screen.getByTestId('verbatim-conversation');
    expect(within(transcript).getByText('Rewritten — it says what a smoke test means here.')).toBeTruthy();
    // The indicator and its Cancel, which is the whole of what a long turn has to say for itself.
    expect(screen.getByTestId('thinking')).toBeTruthy();
    expect(within(screen.getByTestId('thinking')).getByRole('button', { name: 'Stop' })).toBeTruthy();
    // The composer is still a composer while a turn runs — it says so and offers the other Stop.
    expect(screen.getByPlaceholderText('Running…')).toBeTruthy();
  });

  // THE EXEMPTION IS THE TRANSCRIPT AND NOT THE PANEL, which is what setup's plain-words sweep skips by
  // element (W7). The composer is outside it in both modes, because its label is the embedder's copy.
  it('marks the model’s words and nothing around them', () => {
    panel({ compact: true, placeholder: 'Say what you’d change' });

    const transcript = screen.getByTestId('verbatim-conversation');
    expect(transcript.contains(screen.getByPlaceholderText('Say what you’d change'))).toBe(false);
    expect(within(transcript).getByText('Rewritten — it says what a smoke test means here.')).toBeTruthy();
  });

  // A COMPOSER'S LABEL IS ITS PLACEHOLDER, so the dock keeps its own when nobody supplies one.
  it('says “Message the copilot” only when the embedder has not relabelled it', () => {
    panel();
    expect(screen.getByPlaceholderText('Message the copilot (Enter to send)')).toBeTruthy();
    cleanup();

    panel({ placeholder: 'Say what you’d change' });
    expect(screen.getByPlaceholderText('Say what you’d change')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Message the copilot (Enter to send)')).toBeNull();
  });

  // THE DOCK'S OWN EMPTY STATE IS CHROME TOO. It names the copilot and the backend — it is the dock
  // explaining itself — and an embedder has already said what the conversation is for in its own words.
  it('shows the dock’s opening sentence over an empty transcript, and not under compact', () => {
    panel({}, { items: [] });
    expect(screen.getByText(/Ask the copilot to work on this project/)).toBeTruthy();
    cleanup();

    panel({ compact: true }, { items: [] });
    expect(screen.queryByText(/Ask the copilot to work on this project/)).toBeNull();
  });

  // A MENU NOBODY IS SHOWN IS A MENU NOBODY NEEDS FETCHING. Both reads feed controls in the header.
  it('asks for neither the model list nor the model’s status', () => {
    panel({ compact: true });

    expect(api.listModels).not.toHaveBeenCalled();
    expect(api.getModelStatus).not.toHaveBeenCalled();
    cleanup();

    panel();
    expect(api.listModels).toHaveBeenCalledWith('claude-code');
    expect(api.getModelStatus).toHaveBeenCalledWith('sonnet');
  });
});
