// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirListing, FileRead, FsNode } from '../web/src/lib/api.js';
import type { ProjectSnapshot } from '../web/src/lib/shared.js';

const api = vi.hoisted(() => ({
  listDir: vi.fn(),
  readFsFile: vi.fn(),
  putFsFile: vi.fn(),
  createFsNode: vi.fn(),
  renameFsNode: vi.fn(),
  deleteFsEntry: vi.fn(),
  deleteFsTree: vi.fn(),
  moveFsNode: vi.fn(),
}));
vi.mock('../web/src/lib/api.js', () => api);
vi.mock('../web/src/lib/api', () => api);

const { ExplorerView } = await import('../web/src/pages/explorer/ExplorerView.js');

afterEach(cleanup);
// A rejecting mock must be `...Once` here — see the note in explorer-tree.test.tsx.
beforeEach(() => {
  api.listDir.mockReset();
  api.readFsFile.mockReset();
  api.putFsFile.mockReset();
  api.createFsNode.mockReset();
  api.renameFsNode.mockReset();
  api.deleteFsEntry.mockReset();
  api.deleteFsTree.mockReset();
  api.moveFsNode.mockReset();
});

const dir = (path: string): FsNode => ({ path, name: path.split('/').pop() ?? path, kind: 'dir' });
const file = (path: string, size = 10): FsNode => ({
  path,
  name: path.split('/').pop() ?? path,
  kind: 'file',
  size,
});

const listing = (path: string, entries: FsNode[], truncated?: number): DirListing => ({
  path,
  parent: path === '' ? null : path.split('/').slice(0, -1).join('/'),
  entries,
  ...(truncated ? { truncated } : {}),
});

const text = (path: string, content: string): FileRead => ({
  kind: 'text',
  path,
  name: path.split('/').pop() ?? path,
  size: content.length,
  content,
});

// The component only ever passes the snapshot through as a change signal, so a stub is honest here.
const snapshot = { name: 'T' } as unknown as ProjectSnapshot;

const row = (name: string): HTMLElement => screen.getByRole('button', { name: new RegExp(name) });

describe('ExplorerView', () => {
  it('shows the project root and invites a selection', async () => {
    api.listDir.mockResolvedValue(listing('', [dir('docs'), file('README.md', 20)]));
    render(<ExplorerView snapshot={snapshot} />);

    await waitFor(() => expect(screen.getByText('README.md')).toBeTruthy());
    expect(screen.getByText('docs')).toBeTruthy();
    expect(screen.getByText('Select a file to view or edit it.')).toBeTruthy();
    expect(api.readFsFile).not.toHaveBeenCalled();
  });

  it('expands a folder on click without opening anything', async () => {
    api.listDir.mockImplementation((path: string) =>
      Promise.resolve(path === '' ? listing('', [dir('docs')]) : listing('docs', [file('docs/a.md')])),
    );
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('docs')).toBeTruthy());

    fireEvent.click(row('docs'));
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());
    expect(api.readFsFile).not.toHaveBeenCalled();
    expect(row('docs').getAttribute('aria-expanded')).toBe('true');
  });

  it('opens a text file into the editor, showing its path', async () => {
    api.listDir.mockResolvedValue(listing('', [file('README.md')]));
    api.readFsFile.mockResolvedValue(text('README.md', '# hello\n'));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('README.md')).toBeTruthy());

    fireEvent.click(row('README.md'));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# hello\n');
    expect(screen.getByText('README.md', { selector: '[data-testid="editor-path"]' })).toBeTruthy();
  });

  it('saves the buffer and refreshes the folder, because the size just changed', async () => {
    api.listDir.mockResolvedValue(listing('', [file('README.md')]));
    api.readFsFile.mockResolvedValue(text('README.md', 'one'));
    api.putFsFile.mockResolvedValue(undefined);
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('README.md')).toBeTruthy());
    fireEvent.click(row('README.md'));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());

    const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save().disabled).toBe(true); // nothing to save yet
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'one two' } });
    expect(save().disabled).toBe(false);

    fireEvent.click(save());
    await waitFor(() => expect(api.putFsFile.mock.calls).toEqual([['README.md', 'one two']]));
    await waitFor(() => expect(save().disabled).toBe(true)); // no longer dirty
    // The listing is re-read: the file's size in the tree is stale the moment it is written.
    await waitFor(() => expect(api.listDir.mock.calls.length).toBeGreaterThan(1));
  });

  it('says what a binary file is instead of loading it into a textarea', async () => {
    // The whole point of the three read outcomes: a PNG is visible, selectable and honest about
    // itself, rather than hidden or silently corrupted by a round-trip through the editor.
    api.listDir.mockResolvedValue(listing('', [file('logo.png', 2048)]));
    api.readFsFile.mockResolvedValue({ kind: 'binary', path: 'logo.png', name: 'logo.png', size: 2048 });
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('logo.png')).toBeTruthy());

    fireEvent.click(row('logo.png'));
    await waitFor(() => expect(screen.getByText(/no reader for this kind of file yet/)).toBeTruthy());
    expect(screen.getByText(/2.0 KB of binary/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('says a file is too large rather than pretending to open it', async () => {
    api.listDir.mockResolvedValue(listing('', [file('big.log', 5_000_000)]));
    api.readFsFile.mockResolvedValue({
      kind: 'too-large',
      path: 'big.log',
      name: 'big.log',
      size: 5_000_000,
    });
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('big.log')).toBeTruthy());

    fireEvent.click(row('big.log'));
    await waitFor(() => expect(screen.getByText(/too large to open/)).toBeTruthy());
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows the tail of a capped folder as a row, so it never reads as complete', async () => {
    api.listDir.mockResolvedValue(listing('', [file('f0.md')], 4231));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText(/4231 more, not shown/)).toBeTruthy());
  });

  it('marks a link out of the project and refuses to open it', async () => {
    api.listDir.mockResolvedValue(
      listing('', [
        { path: 'escape', name: 'escape', kind: 'other', symlink: true, escapes: true, target: '/etc' },
      ]),
    );
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('escape')).toBeTruthy());
    expect(within(row('escape')).getByText('outside')).toBeTruthy();

    fireEvent.click(row('escape'));
    expect(api.readFsFile).not.toHaveBeenCalled();
    expect(api.listDir.mock.calls).toEqual([['']]);
  });

  it('surfaces a failed read, and a refused save, where the user is looking', async () => {
    api.listDir.mockResolvedValue(listing('', [file('a.md')]));
    api.readFsFile.mockRejectedValueOnce(new Error('Path not allowed'));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());

    fireEvent.click(row('a.md'));
    await waitFor(() => expect(screen.getByText('Path not allowed')).toBeTruthy());
  });

  it('shows the save failure and keeps the buffer dirty, so the work is not lost', async () => {
    api.listDir.mockResolvedValue(listing('', [file('a.md')]));
    api.readFsFile.mockResolvedValue(text('a.md', 'x'));
    api.putFsFile.mockRejectedValueOnce(new Error('This file is not editable text'));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());
    fireEvent.click(row('a.md'));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('This file is not editable text')).toBeTruthy());
    // Still enabled: the edit is still unsaved, and disabling it would strand the text.
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('re-reads the open file when the project changes, but never over unsaved edits', async () => {
    api.listDir.mockResolvedValue(listing('', [file('a.md')]));
    api.readFsFile.mockResolvedValue(text('a.md', 'from disk'));
    const { rerender } = render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());
    fireEvent.click(row('a.md'));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());

    api.readFsFile.mockResolvedValue(text('a.md', 'changed by an agent'));
    rerender(<ExplorerView snapshot={{ ...snapshot } as ProjectSnapshot} />);
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('changed by an agent'),
    );

    // Now with unsaved typing in the buffer, the same signal must leave it alone.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my own words' } });
    api.readFsFile.mockResolvedValue(text('a.md', 'changed again'));
    rerender(<ExplorerView snapshot={{ ...snapshot } as ProjectSnapshot} />);
    await waitFor(() => expect(api.listDir.mock.calls.length).toBeGreaterThan(2));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('my own words');
  });

  it('re-reads the tree on demand', async () => {
    api.listDir.mockResolvedValue(listing('', [file('a.md')]));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());

    fireEvent.click(screen.getByTitle('Re-read the project from disk'));
    await waitFor(() => expect(api.listDir.mock.calls).toEqual([[''], ['']]));
  });
});

describe('ExplorerView — creating and renaming', () => {
  it('creates a file in the root, opens it, and puts its row straight into rename mode', async () => {
    // The whole flow in one: no browser prompt anywhere, because a suppressed prompt would leave no
    // way to name anything.
    api.listDir
      .mockResolvedValueOnce(listing('', []))
      .mockResolvedValue(listing('', [file('Untitled.md', 0)]));
    api.createFsNode.mockResolvedValue({ path: 'Untitled.md', name: 'Untitled.md', kind: 'file', size: 0 });
    api.readFsFile.mockResolvedValue(text('Untitled.md', ''));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('— empty —')).toBeTruthy());

    fireEvent.click(screen.getByTitle('New file in the project root'));
    await waitFor(() => expect(api.createFsNode.mock.calls).toEqual([['', 'file']]));
    // The row is an input carrying the new name, ready to type over.
    await waitFor(() =>
      expect((screen.getByDisplayValue('Untitled.md') as HTMLInputElement).tagName).toBe('INPUT'),
    );
    expect(api.readFsFile.mock.calls).toEqual([['Untitled.md']]);
  });

  it('creates a folder without trying to open it', async () => {
    api.listDir.mockResolvedValue(listing('', [dir('New folder')]));
    api.createFsNode.mockResolvedValue({ path: 'New folder', name: 'New folder', kind: 'dir' });
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByTitle(/New folder in/)).toBeTruthy());

    fireEvent.click(screen.getByTitle('New folder in the project root'));
    await waitFor(() => expect(api.createFsNode.mock.calls).toEqual([['', 'dir']]));
    expect(api.readFsFile).not.toHaveBeenCalled();
  });

  it('creates inside the selected folder, and says so before you click', async () => {
    // The buttons name their destination: a ＋ whose target you have to guess is how files end up in
    // the wrong folder.
    api.listDir.mockImplementation((path: string) =>
      Promise.resolve(path === '' ? listing('', [dir('docs')]) : listing('docs', [])),
    );
    api.createFsNode.mockResolvedValue({
      path: 'docs/Untitled.md',
      name: 'Untitled.md',
      kind: 'file',
      size: 0,
    });
    api.readFsFile.mockResolvedValue(text('docs/Untitled.md', ''));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('docs')).toBeTruthy());

    fireEvent.click(row('docs'));
    await waitFor(() => expect(screen.getByTitle('New file in docs')).toBeTruthy());
    fireEvent.click(screen.getByTitle('New file in docs'));
    await waitFor(() => expect(api.createFsNode.mock.calls).toEqual([['docs', 'file']]));
  });

  it('creates beside the selected FILE, not inside it', async () => {
    api.listDir.mockImplementation((path: string) =>
      Promise.resolve(path === '' ? listing('', [dir('docs')]) : listing('docs', [file('docs/a.md')])),
    );
    api.readFsFile.mockResolvedValue(text('docs/a.md', 'a'));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('docs')).toBeTruthy());
    fireEvent.click(row('docs'));
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());

    fireEvent.click(row('a.md'));
    await waitFor(() => expect(screen.getByTitle('New file in docs')).toBeTruthy());
  });

  it('renames on Enter and re-opens the file under its new path', async () => {
    api.listDir.mockResolvedValue(listing('', [file('old.md')]));
    // Keyed by path, not a fixed value: a mock that answers with the old path however it is called
    // cannot tell a re-open under the new name from no re-open at all.
    api.readFsFile.mockImplementation((p: string) => Promise.resolve(text(p, 'body')));
    api.renameFsNode.mockResolvedValue({ path: 'new name.md', name: 'new name.md', kind: 'file', size: 4 });
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('old.md')).toBeTruthy());
    fireEvent.click(row('old.md'));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());

    fireEvent.doubleClick(row('old.md'));
    const input = screen.getByDisplayValue('old.md');
    fireEvent.change(input, { target: { value: 'new name.md' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(api.renameFsNode.mock.calls).toEqual([['old.md', 'new name.md']]));
    // The editor was showing the old path; it must follow the file rather than keep a dead one.
    await waitFor(() =>
      expect(screen.getByText('new name.md', { selector: '[data-testid="editor-path"]' })).toBeTruthy(),
    );
  });

  it('cancels a rename on Escape, and does not rename when the name is unchanged', async () => {
    api.listDir.mockResolvedValue(listing('', [file('a.md')]));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());

    fireEvent.doubleClick(row('a.md'));
    fireEvent.change(screen.getByDisplayValue('a.md'), { target: { value: 'b.md' } });
    fireEvent.keyDown(screen.getByDisplayValue('b.md'), { key: 'Escape' });
    expect(api.renameFsNode).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy()); // back to a row

    // And committing the name it already has is a no-op, not a rename onto itself.
    fireEvent.doubleClick(row('a.md'));
    fireEvent.keyDown(screen.getByDisplayValue('a.md'), { key: 'Enter' });
    expect(api.renameFsNode).not.toHaveBeenCalled();
  });

  it('shows what the server said when a name is taken', async () => {
    api.listDir.mockResolvedValue(listing('', [file('a.md'), file('b.md')]));
    api.renameFsNode.mockRejectedValueOnce(new Error('Something with that name is already there'));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());

    fireEvent.doubleClick(row('a.md'));
    fireEvent.change(screen.getByDisplayValue('a.md'), { target: { value: 'b.md' } });
    fireEvent.keyDown(screen.getByDisplayValue('b.md'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('Something with that name is already there')).toBeTruthy());
  });

  it('surfaces a refused create', async () => {
    api.listDir.mockResolvedValue(listing('', []));
    api.createFsNode.mockRejectedValueOnce(new Error('Cannot create that here'));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByTitle(/New file in/)).toBeTruthy());

    fireEvent.click(screen.getByTitle('New file in the project root'));
    await waitFor(() => expect(screen.getByText('Cannot create that here')).toBeTruthy());
  });
});

describe('ExplorerView — deleting', () => {
  const del = (): HTMLButtonElement =>
    screen.getByTitle(/^Delete |^Select something to delete$/) as HTMLButtonElement;

  it('offers nothing to delete until something is selected', async () => {
    api.listDir.mockResolvedValue(listing('', [file('a.md')]));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());
    expect((screen.getByTitle('Select something to delete') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(row('a.md'));
    await waitFor(() => expect(screen.getByTitle('Delete a.md')).toBeTruthy());
  });

  it('deletes a file after one confirmation, and closes the editor showing it', async () => {
    api.listDir.mockResolvedValue(listing('', [file('a.md')]));
    api.readFsFile.mockResolvedValue(text('a.md', 'body'));
    api.deleteFsEntry.mockResolvedValue('ok');
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());
    fireEvent.click(row('a.md'));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());

    fireEvent.click(del());
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    // A file is one thing, so it asks once and asks for no typing.
    expect(screen.getByText('a.md is removed from disk. This cannot be undone.')).toBeTruthy();
    // Scoped to the dialog: the editor's own textarea is a textbox too, and an unscoped query here
    // would be asserting about the wrong element entirely.
    expect(within(screen.getByRole('dialog')).queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    await waitFor(() => expect(api.deleteFsEntry.mock.calls).toEqual([['a.md']]));
    // The editor was showing the file that no longer exists.
    await waitFor(() => expect(screen.getByText('Select a file to view or edit it.')).toBeTruthy());
  });

  it('deletes nothing when the confirmation is cancelled', async () => {
    api.listDir.mockResolvedValue(listing('', [file('a.md')]));
    api.readFsFile.mockResolvedValue(text('a.md', 'body'));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());
    fireEvent.click(row('a.md'));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());

    fireEvent.click(del());
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.deleteFsEntry).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeTruthy(); // editor untouched
  });

  it('deletes an empty folder with one click and no typing — the case that started this', async () => {
    // A skill folder with no SKILL.md: invisible in Project Control, and therefore unclearable.
    api.listDir.mockImplementation((path: string) =>
      Promise.resolve(path === '' ? listing('', [dir('new-skill')]) : listing('new-skill', [])),
    );
    api.deleteFsEntry.mockResolvedValue('ok');
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('new-skill')).toBeTruthy());
    fireEvent.click(row('new-skill'));

    await waitFor(() => expect(screen.getByTitle('Delete new-skill')).toBeTruthy());
    fireEvent.click(del());
    await waitFor(() => expect(screen.getByText('new-skill is empty, and will be removed.')).toBeTruthy());
    // No typed confirmation for an empty folder — nothing is lost that the dialog has not named.
    expect(within(screen.getByRole('dialog')).queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete folder' }));
    await waitFor(() => expect(api.deleteFsEntry.mock.calls).toEqual([['new-skill']]));
    expect(api.deleteFsTree).not.toHaveBeenCalled();
  });

  it('makes a folder with contents be typed out, and says how much is in it', async () => {
    api.listDir.mockImplementation((path: string) =>
      Promise.resolve(
        path === ''
          ? listing('', [dir('attic')])
          : listing('attic', [file('attic/a.md'), file('attic/b.md')], 10),
      ),
    );
    api.deleteFsTree.mockResolvedValue(undefined);
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('attic')).toBeTruthy());
    fireEvent.click(row('attic'));
    await waitFor(() => expect(screen.getByTitle('Delete attic')).toBeTruthy());

    fireEvent.click(del());
    // 12, not 2: the count includes what the listing was capped at, or the dialog would understate
    // what is about to be destroyed.
    await waitFor(() => expect(screen.getByText(/attic holds 12 entries/)).toBeTruthy());
    const go = () => screen.getByRole('button', { name: 'Delete folder' }) as HTMLButtonElement;
    expect(go().disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'attic' } });
    fireEvent.click(go());
    await waitFor(() => expect(api.deleteFsTree.mock.calls).toEqual([['attic', 'attic']]));
    expect(api.deleteFsEntry).not.toHaveBeenCalled();
  });

  it('closes the editor when the deleted folder held the open file', async () => {
    api.listDir.mockImplementation((path: string) =>
      Promise.resolve(path === '' ? listing('', [dir('docs')]) : listing('docs', [file('docs/a.md')])),
    );
    api.readFsFile.mockImplementation((p: string) => Promise.resolve(text(p, 'body')));
    api.deleteFsTree.mockResolvedValue(undefined);
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('docs')).toBeTruthy());
    fireEvent.click(row('docs'));
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());
    fireEvent.click(row('a.md'));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());

    fireEvent.click(row('docs')); // select the folder again
    await waitFor(() => expect(screen.getByTitle('Delete docs')).toBeTruthy());
    fireEvent.click(del());
    await waitFor(() => expect(screen.getByText(/docs holds 1 entry/)).toBeTruthy());
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'docs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete folder' }));

    await waitFor(() => expect(api.deleteFsTree.mock.calls).toEqual([['docs', 'docs']]));
    // The open file was inside it: leaving the editor on a path that no longer exists would let a
    // Save recreate a file in a folder the user just destroyed.
    await waitFor(() => expect(screen.getByText('Select a file to view or edit it.')).toBeTruthy());
  });

  it('warns that deleting a link leaves its target alone', async () => {
    // The opposite of what most people assume, and the reason this dialog has its own wording.
    // A link to a folder INSIDE the project: it behaves as a directory, so nothing but the symlink
    // flag distinguishes it from the recursive case.
    api.listDir.mockImplementation((path: string) =>
      Promise.resolve(
        path === ''
          ? listing('', [{ path: 'ref', name: 'ref', kind: 'dir', symlink: true, target: '/data/reference' }])
          : listing('ref', [file('ref/inside.md')]),
      ),
    );
    api.deleteFsEntry.mockResolvedValue('ok');
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('ref')).toBeTruthy());
    fireEvent.click(row('ref'));
    await waitFor(() => expect(screen.getByTitle('Delete ref')).toBeTruthy());

    fireEvent.click(del());
    await waitFor(() => expect(screen.getByText('Delete the link ref?')).toBeTruthy());
    expect(screen.getByText('Only the link is removed. /data/reference is left alone.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete link' }));
    await waitFor(() => expect(api.deleteFsEntry.mock.calls).toEqual([['ref']]));
  });

  it('surfaces a refused delete', async () => {
    api.listDir.mockResolvedValue(listing('', [file('a.md')]));
    api.deleteFsEntry.mockRejectedValueOnce(new Error('Path not allowed'));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());
    fireEvent.click(row('a.md'));
    await waitFor(() => expect(screen.getByTitle('Delete a.md')).toBeTruthy());

    fireEvent.click(del());
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    await waitFor(() => expect(screen.getByText('Path not allowed')).toBeTruthy());
  });
});

// jsdom builds no DataTransfer, so drag events carry a stand-in. setData is what Firefox needs to
// start a drag at all, and dropEffect is written during dragover, so both have to exist.
function transfer(): { setData: () => void; effectAllowed: string; dropEffect: string } {
  return { setData: () => {}, effectAllowed: '', dropEffect: '' };
}

const dragTo = (from: HTMLElement, to: HTMLElement): void => {
  const dataTransfer = transfer();
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragOver(to, { dataTransfer });
  fireEvent.drop(to, { dataTransfer });
};

describe('ExplorerView — dragging to move', () => {
  const twoFolders = (path: string): Promise<DirListing> =>
    Promise.resolve(
      path === ''
        ? listing('', [dir('attic'), dir('docs'), file('a.md')])
        : listing(path, path === 'docs' ? [file('docs/inside.md')] : []),
    );

  it('moves a file onto a folder row', async () => {
    api.listDir.mockImplementation(twoFolders);
    api.moveFsNode.mockResolvedValue({ path: 'docs/a.md', name: 'a.md', kind: 'file', size: 10 });
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());

    dragTo(row('a.md'), row('docs'));
    await waitFor(() => expect(api.moveFsNode.mock.calls).toEqual([['a.md', 'docs']]));
  });

  it('moves a file back to the project root by dropping on the header', async () => {
    // There is no row for the root, so without the header as a target a file dragged into a folder
    // could never come back out.
    api.listDir.mockImplementation(twoFolders);
    api.moveFsNode.mockResolvedValue({ path: 'inside.md', name: 'inside.md', kind: 'file', size: 2 });
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('docs')).toBeTruthy());
    fireEvent.click(row('docs'));
    await waitFor(() => expect(screen.getByText('inside.md')).toBeTruthy());

    const header = screen.getByText('Files').parentElement as HTMLElement;
    dragTo(row('inside.md'), header);
    await waitFor(() => expect(api.moveFsNode.mock.calls).toEqual([['docs/inside.md', '']]));
  });

  it('says what the header is for while a drag is in flight', async () => {
    api.listDir.mockImplementation(twoFolders);
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('docs')).toBeTruthy());
    fireEvent.click(row('docs'));
    await waitFor(() => expect(screen.getByText('inside.md')).toBeTruthy());

    expect(screen.getByText('Files')).toBeTruthy();
    fireEvent.dragStart(row('inside.md'), { dataTransfer: transfer() });
    expect(screen.getByText('Drop here for the project root')).toBeTruthy();
    fireEvent.dragEnd(row('inside.md'));
    expect(screen.getByText('Files')).toBeTruthy();
  });

  it('does not offer the root to something already in it', async () => {
    // a.md is at the root: the header must stay a header rather than inviting a no-op move.
    api.listDir.mockImplementation(twoFolders);
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());

    fireEvent.dragStart(row('a.md'), { dataTransfer: transfer() });
    expect(screen.getByText('Files')).toBeTruthy();
    const header = screen.getByText('Files').parentElement as HTMLElement;
    fireEvent.drop(header, { dataTransfer: transfer() });
    expect(api.moveFsNode).not.toHaveBeenCalled();
  });

  it('refuses a drop onto a folder into itself', async () => {
    // `attic` onto `attic`: the drop handler is not even attached, so this fires nothing at all.
    api.listDir.mockImplementation(twoFolders);
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('attic')).toBeTruthy());

    dragTo(row('attic'), row('attic'));
    expect(api.moveFsNode).not.toHaveBeenCalled();
  });

  it('refuses a drop into a folder the entry is already in', async () => {
    api.listDir.mockImplementation(twoFolders);
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('docs')).toBeTruthy());
    fireEvent.click(row('docs'));
    await waitFor(() => expect(screen.getByText('inside.md')).toBeTruthy());

    dragTo(row('inside.md'), row('docs'));
    expect(api.moveFsNode).not.toHaveBeenCalled();
  });

  it('re-lists both ends of the move, and follows the open file to its new path', async () => {
    api.listDir.mockImplementation(twoFolders);
    api.readFsFile.mockImplementation((p: string) => Promise.resolve(text(p, 'body')));
    api.moveFsNode.mockResolvedValue({ path: 'docs/a.md', name: 'a.md', kind: 'file', size: 10 });
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());
    fireEvent.click(row('a.md'));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());

    api.listDir.mockClear();
    dragTo(row('a.md'), row('docs'));
    await waitFor(() => expect(api.moveFsNode).toHaveBeenCalled());
    // Both the folder it left and the folder it arrived in are stale otherwise.
    await waitFor(() =>
      expect(api.listDir.mock.calls.map(([p]) => p).sort()).toEqual(expect.arrayContaining(['', 'docs'])),
    );
    await waitFor(() =>
      expect(screen.getByText('docs/a.md', { selector: '[data-testid="editor-path"]' })).toBeTruthy(),
    );
  });

  it('surfaces a refused move', async () => {
    api.listDir.mockImplementation(twoFolders);
    api.moveFsNode.mockRejectedValueOnce(new Error('Something with that name is already there'));
    render(<ExplorerView snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy());

    dragTo(row('a.md'), row('docs'));
    await waitFor(() => expect(screen.getByText('Something with that name is already there')).toBeTruthy());
  });
});
