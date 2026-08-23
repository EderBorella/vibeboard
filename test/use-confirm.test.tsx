// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunRecord } from '../web/src/lib/api.js';
import { archiveCardRequest, stopRunRequest } from '../web/src/organisms/shared/requests.js';
import { type ConfirmRequest, useConfirm } from '../web/src/lib/useConfirm.js';
import type { Card } from '../web/src/lib/shared.js';

afterEach(cleanup);

// A host that does what every real owner does: ask, then record the answer. `answer` is written only
// when the promise settles, so a promise left hanging shows up as a blank rather than as a pass.
function Host({ request }: { request: ConfirmRequest }) {
  const { confirm, dialog } = useConfirm();
  const [answer, setAnswer] = useState<string>('unanswered');
  return (
    <div>
      <button type="button" onClick={() => void confirm(request).then((ok) => setAnswer(String(ok)))}>
        ask
      </button>
      <span data-testid="answer">{answer}</span>
      {dialog}
    </div>
  );
}

const request: ConfirmRequest = {
  title: 'Delete this chat?',
  body: 'The transcript is removed from disk.',
  action: 'Delete chat',
  danger: true,
};

const ask = (): void => {
  fireEvent.click(screen.getByText('ask'));
};
const answer = (): string => screen.getByTestId('answer').textContent ?? '';

describe('useConfirm', () => {
  it('asks nothing until it is asked', () => {
    render(<Host request={request} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the question, the consequence and the action as the button label', () => {
    render(<Host request={request} />);
    ask();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Delete this chat?')).toBeTruthy();
    expect(screen.getByText('The transcript is removed from disk.')).toBeTruthy();
    // The button says what it does. "OK" would be answerable without reading anything.
    expect(screen.getByText('Delete chat')).toBeTruthy();
  });

  it('resolves true only when the action is clicked', async () => {
    render(<Host request={request} />);
    ask();
    expect(answer()).toBe('unanswered');
    fireEvent.click(screen.getByText('Delete chat'));
    await screen.findByText('true');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('resolves false on Cancel', async () => {
    render(<Host request={request} />);
    ask();
    fireEvent.click(screen.getByText('Cancel'));
    await screen.findByText('false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('resolves false on Escape', async () => {
    render(<Host request={request} />);
    ask();
    fireEvent.keyDown(window, { key: 'Escape' });
    await screen.findByText('false');
  });

  it('resolves false on a click outside, but not on one that lands inside', async () => {
    render(<Host request={request} />);
    ask();
    // A click on the dialog itself must not cancel — the backdrop is the parent, and a naive
    // handler on it fires for anything that bubbles up.
    fireEvent.click(screen.getByRole('dialog'));
    expect(answer()).toBe('unanswered');
    expect(screen.queryByRole('dialog')).toBeTruthy();

    fireEvent.click(document.querySelector('.vb-modal-backdrop') as HTMLElement);
    await screen.findByText('false');
  });

  it('focuses Cancel, not the destructive button', () => {
    // A stray Enter or Space arriving as the dialog opens must not be what confirms it.
    render(<Host request={request} />);
    ask();
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('marks a destructive action, and leaves a reversible one plain', () => {
    render(<Host request={request} />);
    ask();
    expect(screen.getByText('Delete chat').className).toContain('danger');
    cleanup();

    render(<Host request={{ title: 'Archive E-1?', action: 'Archive' }} />);
    ask();
    expect(screen.getByText('Archive').className).not.toContain('danger');
  });

  it('renders no body paragraph when there is nothing to warn about', () => {
    render(<Host request={{ title: 'Archive E-1?', action: 'Archive' }} />);
    ask();
    expect(document.querySelector('.vb-text-lead')).toBeNull();
  });

  it('answers an abandoned question rather than leaving its caller waiting', async () => {
    // Asking again while one is open. The first await MUST settle: a caller that never returns is
    // worse than a wrong answer, because nothing downstream ever runs.
    function Twice() {
      const { confirm, dialog } = useConfirm();
      const [log, setLog] = useState<string[]>([]);
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              void confirm({ title: 'first', action: 'go' }).then((ok) => setLog((l) => [...l, `1:${ok}`]));
              void confirm({ title: 'second', action: 'go' }).then((ok) => setLog((l) => [...l, `2:${ok}`]));
            }}
          >
            ask twice
          </button>
          <span data-testid="log">{log.join(',')}</span>
          {dialog}
        </div>
      );
    }
    render(<Twice />);
    fireEvent.click(screen.getByText('ask twice'));
    await screen.findByText('1:false');
    // The second question is the one on screen, and it is still answerable.
    expect(screen.getByText('second')).toBeTruthy();
    fireEvent.click(screen.getByText('go'));
    await screen.findByText('1:false,2:true');
  });

  it('answers no when the owner unmounts mid-question', async () => {
    // Closing a card while its Stop dialog is open. Without this the caller's await never returns
    // and the `.then` never runs — a leak with no symptom.
    const settled: boolean[] = [];
    function Unmounting() {
      const { confirm, dialog } = useConfirm();
      return (
        <div>
          <button type="button" onClick={() => void confirm(request).then((ok) => settled.push(ok))}>
            ask
          </button>
          {dialog}
        </div>
      );
    }
    const { unmount } = render(<Unmounting />);
    ask();
    unmount();
    await vi.waitFor(() => expect(settled).toEqual([false]));
  });
});

describe('the shared questions', () => {
  const run = (over: Partial<RunRecord> = {}): RunRecord =>
    ({ run: 'r1', card: 'E-010', skill: 'execute', ...over }) as RunRecord;

  it('names the skill and the card when stopping a run, and marks it destructive', () => {
    const req = stopRunRequest(run({ skill: 'research', card: 'P-007' }));
    expect(req.title).toBe('Stop the research run?');
    expect(req.body).toContain('P-007');
    expect(req.action).toBe('Stop the run');
    expect(req.danger).toBe(true);
  });

  it('says archiving is reversible, and does not dress it as a deletion', () => {
    // The whole reason for an in-app dialog rather than window.confirm: this one is recoverable and
    // is allowed to say so, instead of every dialog sounding equally final.
    const req = archiveCardRequest({ id: 'E-010', title: 'Token store' } as Card);
    expect(req.title).toBe('Archive E-010?');
    expect(req.body).toContain('restore it from the archive drawer');
    expect(req.danger).toBeUndefined();
  });
});

describe('useConfirm with a typed confirmation', () => {
  const folder: ConfirmRequest = {
    title: 'Delete attic and everything in it?',
    body: 'attic holds 12 entries.',
    action: 'Delete folder',
    danger: true,
    requireText: 'attic',
  };
  const go = (): HTMLButtonElement =>
    screen.getByRole('button', { name: 'Delete folder' }) as HTMLButtonElement;
  const field = (): HTMLInputElement => screen.getByRole('textbox') as HTMLInputElement;

  it('keeps the destructive button unusable until the name is typed exactly', async () => {
    render(<Host request={folder} />);
    ask();
    expect(go().disabled).toBe(true);

    fireEvent.change(field(), { target: { value: 'att' } });
    expect(go().disabled).toBe(true);
    fireEvent.change(field(), { target: { value: 'Attic' } }); // case matters
    expect(go().disabled).toBe(true);
    fireEvent.change(field(), { target: { value: 'attic' } });
    expect(go().disabled).toBe(false);

    fireEvent.click(go());
    await screen.findByText('true');
  });

  // Pinned for Phase 9 of docs/design-system.md before `Field` took this row. The box is `autoFocus`
  // and the words above it name what has to be typed — a `<label>` wrapping both, so the name is a
  // click target into the box. Everything else about it is asserted above; these are the parts a
  // migration moves the wrapper past without failing anything.
  it('is a labelled, auto-focused box that names the word it wants', () => {
    render(<Host request={folder} />);
    ask();
    expect(field().tagName).toBe('INPUT');
    expect(field().closest('label')).not.toBeNull();
    expect(document.activeElement).toBe(field());
    expect(field().closest('label')?.textContent).toBe('Type attic to confirm');
  });

  it('forgives whitespace around the name, which a paste often brings', () => {
    render(<Host request={folder} />);
    ask();
    fireEvent.change(field(), { target: { value: '  attic\n' } });
    expect(go().disabled).toBe(false);
  });

  it('confirms on Enter in the field, but only once it matches', async () => {
    render(<Host request={folder} />);
    ask();
    fireEvent.change(field(), { target: { value: 'att' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(answer()).toBe('unanswered');

    fireEvent.change(field(), { target: { value: 'attic' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await screen.findByText('true');
  });

  it('starts every question with an empty field, so the last answer cannot unlock the next', async () => {
    // Two folders of the same name in a row would otherwise be one keystroke away from a delete the
    // user never typed.
    render(<Host request={folder} />);
    ask();
    fireEvent.change(field(), { target: { value: 'attic' } });
    fireEvent.click(go());
    await screen.findByText('true');

    ask();
    expect(field().value).toBe('');
    expect(go().disabled).toBe(true);
  });

  it('focuses the field, since there is nothing else to do first', () => {
    render(<Host request={folder} />);
    ask();
    expect(document.activeElement).toBe(field());
  });

  it('still cancels on Escape while the field is unmatched', async () => {
    render(<Host request={folder} />);
    ask();
    fireEvent.change(field(), { target: { value: 'att' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    await screen.findByText('false');
  });

  it('asks for no text, and unlocks immediately, when none is required', () => {
    render(<Host request={request} />);
    ask();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect((screen.getByText('Delete chat') as HTMLButtonElement).disabled).toBe(false);
  });
});
