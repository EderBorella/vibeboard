// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCS_DIR, RESOURCES_DIR, skillRel } from '../src/core/layout.js';
import type { DispatchRequest, RunRecord, Skill } from '../web/src/api.js';
import { DispatchPane } from '../web/src/components/DispatchPane.js';
import type { Card } from '../web/src/shared.js';

const API = `${DOCS_DIR}/api.md`;
const SPEC = `${RESOURCES_DIR}/spec.md`;

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
  path: skillRel('execute', 'SKILL.md'),
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
      <DispatchPane {...props} attachable={[API, SPEC]} onDispatch={onDispatch} />,
    );
    fireEvent.click(screen.getByText(SPEC));
    fireEvent.click(screen.getByText('Run Execute'));
    expect(dispatched(onDispatch).attachments).toEqual([SPEC]);
  });

  it('offers no attachment section when the project has nothing to attach', () => {
    render(<DispatchPane {...props} />);
    expect(document.querySelector('.dispatch-attach')).toBeNull();
  });

  it('un-ticks an attachment, rather than attaching it twice', () => {
    // The toggle is a ternary over `includes`; a mutant that always adds sends the same path twice,
    // and the agent reads the same file twice.
    const onDispatch = vi.fn();
    render(<DispatchPane {...props} attachable={[API]} onDispatch={onDispatch} />);
    fireEvent.click(screen.getByText(API));
    fireEvent.click(screen.getByText(API));
    fireEvent.click(screen.getByText('Run Execute'));
    expect(dispatched(onDispatch).attachments).toEqual([]);
  });

  it('counts the attachments in the summary, so a collapsed section still says so', () => {
    // The section collapses, and this count is the only thing that tells you something is attached
    // without opening it.
    render(<DispatchPane {...props} attachable={[API, SPEC]} />);
    const summary = document.querySelector('summary') as HTMLElement;
    expect(summary.textContent).toBe('Attach material');
    fireEvent.click(screen.getByText(API));
    expect(summary.textContent).toBe('Attach material (1)');
    fireEvent.click(screen.getByText(SPEC));
    expect(summary.textContent).toBe('Attach material (2)');
  });

  it('marks the chosen connector and mode, so the form shows what will run', () => {
    // Both are switch rows where only the highlight says which is selected. With none marked, the
    // form silently claims nothing is chosen when something always is.
    render(<DispatchPane {...props} />);
    expect(screen.getByText('claude-code').className).toContain('active');
    expect(screen.getByText('opencode').className).not.toContain('active');
    expect(document.querySelectorAll('.mode-btn.active')).toHaveLength(1);
  });

  it('leaves the error line out entirely when there is no error', () => {
    render(<DispatchPane {...props} error={null} />);
    expect(document.querySelector('.dispatch-error')).toBeNull();
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
