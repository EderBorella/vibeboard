// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportOptions } from '../web/src/components/ReportOptions.js';

afterEach(cleanup);

const columns = [
  { slug: 'todo', name: 'Todo' },
  { slug: 'in-progress', name: 'In Progress' },
  { slug: 'review', name: 'Review' },
  { slug: 'done', name: 'Done' },
];

const props = {
  options: ['Split into E-041 and E-042', 'Do just the token store'],
  cardId: 'E-010',
  columns,
  currentColumn: 'todo',
  onContinue: vi.fn(),
  onClose: vi.fn(),
  canContinue: true,
};

const buttons = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('.option-btn'),
];

describe('ReportOptions', () => {
  it('offers the agent’s options first, then the fixed ones', () => {
    render(<ReportOptions {...props} />);
    expect(buttons().map((b) => b.textContent)).toEqual([
      'Split into E-041 and E-042',
      'Do just the token store',
      'Create new cards',
      'Write my own input',
    ]);
  });

  it('still offers the fixed options when the agent gave none', () => {
    render(<ReportOptions {...props} options={[]} />);
    expect(buttons().map((b) => b.textContent)).toEqual(['Create new cards', 'Write my own input']);
  });

  it('passes the chosen option through as the starting prompt', () => {
    const onContinue = vi.fn();
    render(<ReportOptions {...props} onContinue={onContinue} />);
    fireEvent.click(screen.getByText('Do just the token store'));
    expect(onContinue.mock.calls).toEqual([['Do just the token store']]);
  });

  it('fills a card-splitting prompt that names the card and forbids implementing', () => {
    const onContinue = vi.fn();
    render(<ReportOptions {...props} onContinue={onContinue} />);
    fireEvent.click(screen.getByText('Create new cards'));
    const prompt = onContinue.mock.calls[0][0] as string;
    expect(prompt).toContain('link each one to E-010');
    expect(prompt).toContain('Do not implement them');
  });

  it('starts the details step empty for "Write my own input"', () => {
    const onContinue = vi.fn();
    render(<ReportOptions {...props} onContinue={onContinue} />);
    fireEvent.click(screen.getByText('Write my own input'));
    expect(onContinue.mock.calls).toEqual([['']]);
  });

  it('closes the card deterministically, with no agent involved', () => {
    // Ignoring a finding means no work, so nothing is dispatched — this is the one resolution that
    // never reaches the details step.
    const onClose = vi.fn();
    const onContinue = vi.fn();
    render(<ReportOptions {...props} onClose={onClose} onContinue={onContinue} />);
    fireEvent.click(screen.getByText('Close card'));
    expect(onClose.mock.calls).toEqual([['done']]);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('defaults the close to the board’s last column, and takes another when chosen', () => {
    const onClose = vi.fn();
    render(<ReportOptions {...props} onClose={onClose} />);
    const select = screen.getByLabelText('Column to close the card into') as HTMLSelectElement;
    expect(select.value).toBe('done');
    // Every column is offered by display name, in board order.
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Todo',
      'In Progress',
      'Review',
      'Done',
    ]);

    fireEvent.change(select, { target: { value: 'review' } });
    fireEvent.click(screen.getByText('Close card'));
    expect(onClose.mock.calls).toEqual([['review']]);
  });

  it('refuses to close into the column the card is already in', () => {
    render(<ReportOptions {...props} currentColumn="done" />);
    expect((screen.getByText('Close card') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables continuing when the skill has gone, but still allows closing', () => {
    render(<ReportOptions {...props} canContinue={false} />);
    expect(buttons().every((b) => b.disabled)).toBe(true);
    expect((screen.getByText('Close card') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/no longer in the project/)).toBeTruthy();
  });

  it('says nothing about a missing skill when the skill is there', () => {
    render(<ReportOptions {...props} />);
    expect(document.querySelector('.options-warn')).toBeNull();
  });
});
