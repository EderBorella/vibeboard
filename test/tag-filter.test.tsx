// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TagFilter } from '../web/src/board/TagFilter.js';

afterEach(cleanup);

const tags = [
  { tag: 'bug', count: 3 },
  { tag: 'ui', count: 2 },
];

describe('TagFilter', () => {
  it('renders one chip per tag with its card count, in the order given', () => {
    render(<TagFilter tags={tags} active={[]} onToggle={vi.fn()} onClear={vi.fn()} />);
    const chips = screen.getAllByRole('button');
    expect(chips.map((b) => b.textContent)).toEqual(['bug3', 'ui2']);
  });

  it('renders nothing at all when no card is tagged', () => {
    // Not an empty bar: the group itself must be absent, or the boards lose a row of height
    // to chrome that can never do anything.
    const { container } = render(<TagFilter tags={[]} active={[]} onToggle={vi.fn()} onClear={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('marks only the active chips as pressed', () => {
    render(<TagFilter tags={tags} active={['ui']} onToggle={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByTitle('Cards tagged ui: 2').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTitle('Cards tagged bug: 3').getAttribute('aria-pressed')).toBe('false');
    // Exact class, not a substring: an inactive chip's class is the bytes the CSS keys off, and
    // `not.toContain('active')` is satisfied by any wrong className at all.
    expect(screen.getByTitle('Cards tagged ui: 2').className).toBe('tag-chip active');
    expect(screen.getByTitle('Cards tagged bug: 3').className).toBe('tag-chip');
  });

  it('reports the clicked tag, active or not, so the click toggles', () => {
    const onToggle = vi.fn();
    render(<TagFilter tags={tags} active={['ui']} onToggle={onToggle} onClear={vi.fn()} />);
    screen.getByTitle('Cards tagged bug: 3').click();
    screen.getByTitle('Cards tagged ui: 2').click();
    expect(onToggle.mock.calls).toEqual([['bug'], ['ui']]);
  });

  it('offers Clear only while something is filtered', () => {
    const onClear = vi.fn();
    const { rerender } = render(<TagFilter tags={tags} active={[]} onToggle={vi.fn()} onClear={onClear} />);
    expect(screen.queryByText('Clear filter')).toBeNull();

    rerender(<TagFilter tags={tags} active={['bug']} onToggle={vi.fn()} onClear={onClear} />);
    screen.getByText('Clear filter').click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
