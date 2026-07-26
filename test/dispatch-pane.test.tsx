// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DispatchRequest, RunRecord, Skill } from '../web/src/api.js';
import { DispatchPane } from '../web/src/components/DispatchPane.js';
import type { Card } from '../web/src/shared.js';

afterEach(cleanup);

const card = (over: Partial<Card> = {}): Card =>
  ({
    id: 'E-010',
    title: 'Token store',
    board: 'engineering',
    columnSlug: 'todo',
    order: 0,
    tags: [],
    links: [],
    created: '2026-07-26',
    body: '',
    filePath: '/tmp/E-010.md',
    ...over,
  }) as Card;

const skill: Skill = {
  slug: 'execute',
  path: '.claude/skills/execute/SKILL.md',
  name: 'Execute',
  description: 'Implement the card',
  boards: [],
  columns: [],
  prompt: 'p',
};

const props = {
  skill,
  card: card(),
  defaults: { backend: 'claude-code', model: 'opus', effort: 'high' },
  models: [],
  attachable: [] as string[],
  busy: false,
  error: null as string | null,
  onDispatch: vi.fn(),
  onBack: vi.fn(),
  onBackend: vi.fn(),
};

const dispatched = (fn: ReturnType<typeof vi.fn>): DispatchRequest =>
  fn.mock.calls[0][0] as DispatchRequest;

describe('DispatchPane', () => {
  it('names the skill and the card it will run against', () => {
    render(<DispatchPane {...props} />);
    expect(screen.getByLabelText('Run Execute on E-010')).toBeTruthy();
    expect(screen.getByText('Implement the card')).toBeTruthy();
  });

  it('dispatches the project defaults when nothing is touched', () => {
    // Everything is pre-populated, so the shortest path is one click — the skill carries no
    // execution knobs, so these values come from the project's saved selection.
    const onDispatch = vi.fn();
    render(<DispatchPane {...props} onDispatch={onDispatch} />);
    fireEvent.click(screen.getByText('Run Execute'));
    expect(dispatched(onDispatch)).toEqual({
      board: 'engineering',
      card: 'E-010',
      skill: 'execute',
      prompt: undefined,
      attachments: [],
      previous: undefined,
      backend: 'claude-code',
      model: 'opus',
      effort: 'high',
      mode: 'bypassPermissions',
    });
  });

  it('sends the prompt trimmed', () => {
    const onDispatch = vi.fn();
    render(<DispatchPane {...props} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByLabelText('Anything to add?'), {
      target: { value: '  only the token store  ' },
    });
    fireEvent.click(screen.getByText('Run Execute'));
    expect(dispatched(onDispatch).prompt).toBe('only the token store');
  });

  it('sends no prompt at all when it is blank', () => {
    // `undefined`, not an empty string: the run record only carries a prompt when there was one.
    const onDispatch = vi.fn();
    render(<DispatchPane {...props} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByLabelText('Anything to add?'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Run Execute'));
    expect(dispatched(onDispatch).prompt).toBeUndefined();
  });

  it('changes effort and mode, and sends what was chosen', () => {
    const onDispatch = vi.fn();
    render(<DispatchPane {...props} onDispatch={onDispatch} />);
    fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'low' } });
    fireEvent.click(screen.getByText('Plan'));
    fireEvent.click(screen.getByText('Run Execute'));
    const request = dispatched(onDispatch);
    expect(request.effort).toBe('low');
    expect(request.mode).toBe('plan');
  });

  it('reports a connector change upward rather than keeping it to itself', () => {
    // The model list depends on the backend, and the shell owns that fetch.
    const onBackend = vi.fn();
    render(<DispatchPane {...props} onBackend={onBackend} />);
    fireEvent.click(screen.getByText('opencode'));
    expect(onBackend.mock.calls).toEqual([['opencode']]);
  });

  it('attaches only what was ticked', () => {
    const onDispatch = vi.fn();
    render(
      <DispatchPane {...props} attachable={['docs/api.md', 'resources/spec.md']} onDispatch={onDispatch} />,
    );
    fireEvent.click(screen.getByText('resources/spec.md'));
    fireEvent.click(screen.getByText('Run Execute'));
    expect(dispatched(onDispatch).attachments).toEqual(['resources/spec.md']);
  });

  it('offers no attachment section when the project has nothing to attach', () => {
    render(<DispatchPane {...props} />);
    expect(document.querySelector('.dispatch-attach')).toBeNull();
  });

  it('carries the run it continues, and says so', () => {
    const previous = { run: '20260726-141000-9f3e' } as RunRecord;
    const onDispatch = vi.fn();
    render(
      <DispatchPane {...props} previous={previous} initialPrompt="Split it in two" onDispatch={onDispatch} />,
    );
    // The chosen option arrives as an editable starting point, not a fixed instruction.
    expect((screen.getByLabelText('Anything to add?') as HTMLTextAreaElement).value).toBe(
      'Split it in two',
    );
    expect(screen.getByText(/Continues run 20260726-141000-9f3e/)).toBeTruthy();
    fireEvent.click(screen.getByText('Run Execute'));
    expect(dispatched(onDispatch).previous).toBe('20260726-141000-9f3e');
  });

  it('refuses to dispatch while a run is in flight, and says which', () => {
    render(<DispatchPane {...props} busy />);
    const button = screen.getByText('A run is in flight') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('shows the reason a dispatch was refused', () => {
    render(<DispatchPane {...props} error="A run is already in flight" />);
    expect(screen.getByText('A run is already in flight').className).toBe('dispatch-error');
  });

  it('goes back without dispatching, from the arrow and from Cancel', () => {
    const onBack = vi.fn();
    const onDispatch = vi.fn();
    render(<DispatchPane {...props} onBack={onBack} onDispatch={onDispatch} />);
    fireEvent.click(screen.getByTitle('Back to the card'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(onDispatch).not.toHaveBeenCalled();
  });
});
