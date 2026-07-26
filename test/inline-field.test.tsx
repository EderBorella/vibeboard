// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineField } from '../web/src/components/InlineField.js';

afterEach(cleanup);

const type = (el: HTMLElement, value: string): void => {
  fireEvent.change(el, { target: { value } });
};

describe('InlineField', () => {
  it('shows the value until clicked, then an input carrying it', () => {
    render(<InlineField value="a title" label="title" onCommit={vi.fn()} />);
    expect(screen.getByTitle('Edit title').textContent).toBe('a title');

    fireEvent.click(screen.getByTitle('Edit title'));
    expect((screen.getByLabelText('title') as HTMLInputElement).value).toBe('a title');
  });

  it('commits a changed value on blur', () => {
    const onCommit = vi.fn();
    render(<InlineField value="old" label="title" onCommit={onCommit} />);
    fireEvent.click(screen.getByTitle('Edit title'));
    type(screen.getByLabelText('title'), 'new');
    fireEvent.blur(screen.getByLabelText('title'));
    expect(onCommit.mock.calls).toEqual([['new']]);
  });

  it('commits on Enter in a single-line field', () => {
    const onCommit = vi.fn();
    render(<InlineField value="old" label="title" onCommit={onCommit} />);
    fireEvent.click(screen.getByTitle('Edit title'));
    type(screen.getByLabelText('title'), 'new');
    fireEvent.keyDown(screen.getByLabelText('title'), { key: 'Enter' });
    expect(onCommit.mock.calls).toEqual([['new']]);
    expect(screen.getByTitle('Edit title')).toBeTruthy(); // back to display
  });

  it('reverts on Escape without committing', () => {
    const onCommit = vi.fn();
    render(<InlineField value="old" label="title" onCommit={onCommit} />);
    fireEvent.click(screen.getByTitle('Edit title'));
    type(screen.getByLabelText('title'), 'discarded');
    fireEvent.keyDown(screen.getByLabelText('title'), { key: 'Escape' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTitle('Edit title').textContent).toBe('old');
  });

  it('does not commit a value left unchanged', () => {
    // Every commit is a file write; clicking a field and clicking away must not touch the disk.
    const onCommit = vi.fn();
    render(<InlineField value="same" label="title" onCommit={onCommit} />);
    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.blur(screen.getByLabelText('title'));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('trims what it commits', () => {
    const onCommit = vi.fn();
    render(<InlineField value="old" label="title" onCommit={onCommit} />);
    fireEvent.click(screen.getByTitle('Edit title'));
    type(screen.getByLabelText('title'), '  padded  ');
    fireEvent.blur(screen.getByLabelText('title'));
    expect(onCommit.mock.calls).toEqual([['padded']]);
  });

  it('commits an emptied optional field, so a value can be removed', () => {
    const onCommit = vi.fn();
    render(<InlineField value="a group" label="group" onCommit={onCommit} />);
    fireEvent.click(screen.getByTitle('Edit group'));
    type(screen.getByLabelText('group'), '');
    fireEvent.blur(screen.getByLabelText('group'));
    expect(onCommit.mock.calls).toEqual([['']]);
  });

  it('reverts an emptied required field instead of committing it', () => {
    // A card with no title has no name anywhere it is listed.
    const onCommit = vi.fn();
    render(<InlineField value="a title" label="title" onCommit={onCommit} required />);
    fireEvent.click(screen.getByTitle('Edit title'));
    type(screen.getByLabelText('title'), '   ');
    fireEvent.blur(screen.getByLabelText('title'));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTitle('Edit title').textContent).toBe('a title');
  });

  it('offers the placeholder to click when the value is empty', () => {
    render(<InlineField value="" label="description" placeholder="Add a description" onCommit={vi.fn()} />);
    expect(screen.getByTitle('Edit description').textContent).toBe('Add a description');
    fireEvent.click(screen.getByTitle('Edit description'));
    expect((screen.getByLabelText('description') as HTMLInputElement).value).toBe('');
  });

  it('renders a value through the display function it is given', () => {
    const { container } = render(
      <InlineField
        value="**bold**"
        label="body"
        onCommit={vi.fn()}
        display={() => <em>rendered</em>}
      />,
    );
    expect(container.querySelector('em')?.textContent).toBe('rendered');
  });

  it('takes Enter as a newline in a multiline field, committing on blur only', () => {
    const onCommit = vi.fn();
    render(<InlineField value="line" label="body" onCommit={onCommit} multiline />);
    fireEvent.click(screen.getByTitle('Edit body'));
    const area = screen.getByLabelText('body');
    expect(area.tagName).toBe('TEXTAREA');
    type(area, 'line\nmore');
    fireEvent.keyDown(area, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(area);
    expect(onCommit.mock.calls).toEqual([['line\nmore']]);
  });

  it('ignores a click on a link inside a multiline value', () => {
    // Rendered markdown contains anchors; following one must not open the editor over it.
    const { container } = render(
      <InlineField
        value="see docs"
        label="body"
        onCommit={vi.fn()}
        multiline
        display={() => <a href="https://example.com">docs</a>}
      />,
    );
    const link = container.querySelector('a') as HTMLElement;
    fireEvent.click(link);
    expect(screen.queryByLabelText('body')).toBeNull();

    // A click on the value itself still opens the editor, so the ignore is about anchors only.
    fireEvent.click(container.querySelector('.inline-view') as HTMLElement);
    expect(screen.getByLabelText('body')).toBeTruthy();
  });
});

describe('InlineField editor details', () => {
  it('focuses the input it opens, so typing starts immediately', () => {
    render(<InlineField value="a title" label="title" onCommit={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Edit title'));
    const input = screen.getByLabelText('title');
    expect(document.activeElement).toBe(input);
    expect(input.className).toBe('inline-edit');
  });

  it('does not commit on any key that is not Enter', () => {
    // Otherwise every keystroke would close the editor and write the file.
    const onCommit = vi.fn();
    render(<InlineField value="old" label="title" onCommit={onCommit} />);
    fireEvent.click(screen.getByTitle('Edit title'));
    type(screen.getByLabelText('title'), 'new');
    fireEvent.keyDown(screen.getByLabelText('title'), { key: 'a' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('title')).toBeTruthy(); // still editing
  });

  it('shows a single-line value as a button and a multiline one as a div', () => {
    const { unmount } = render(<InlineField value="v" label="title" onCommit={vi.fn()} />);
    expect(screen.getByTitle('Edit title').tagName).toBe('BUTTON');
    unmount();

    // A button cannot contain the anchors rendered markdown produces.
    render(<InlineField value="v" label="body" onCommit={vi.fn()} multiline />);
    expect(screen.getByTitle('Edit body').tagName).toBe('DIV');
  });

  it('opens a multiline field from the keyboard as well as the mouse', () => {
    render(<InlineField value="v" label="body" onCommit={vi.fn()} multiline />);
    fireEvent.keyDown(screen.getByTitle('Edit body'), { key: 'Enter' });
    expect(screen.getByLabelText('body').tagName).toBe('TEXTAREA');
  });

  it('ignores other keys on a multiline display', () => {
    render(<InlineField value="v" label="body" onCommit={vi.fn()} multiline />);
    fireEvent.keyDown(screen.getByTitle('Edit body'), { key: 'a' });
    expect(screen.queryByLabelText('body')).toBeNull();
  });
});
