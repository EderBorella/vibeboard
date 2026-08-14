// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCS_DIR, POINTER_FILES } from '../src/core/layout.js';
import { ControlFileEditor, type OpenFile } from '../web/src/components/ControlFileEditor.js';

const [CLAUDE_MD] = POINTER_FILES;

afterEach(cleanup);

// Characterisation tests, written against the component BEFORE its chrome was extracted into
// EditorShell so the Explorer could share it. The point is that the extraction is provably a
// no-op: these passed against the old shape and must pass unchanged against the new one.

const file = (over: Partial<OpenFile> = {}): OpenFile => ({
  path: `${DOCS_DIR}/design.md`,
  name: 'design.md',
  category: 'docs',
  managed: false,
  deletable: true,
  renameable: true,
  content: '# Design\n',
  ...over,
});

// The callbacks are returned separately from the props: spreading an override over `vi.fn()` widens
// its type to a plain function, and `.mock` is then gone.
function mount(over: Partial<Parameters<typeof ControlFileEditor>[0]> = {}) {
  const calls = { onView: vi.fn(), onDraft: vi.fn(), onSave: vi.fn(), onDelete: vi.fn() };
  render(
    <ControlFileEditor
      file={file()}
      draft="# Design\n"
      dirty={false}
      view="edit"
      busy={false}
      {...calls}
      {...over}
    />,
  );
  return calls;
}

describe('ControlFileEditor', () => {
  it('shows the path, and marks it when the buffer is dirty', () => {
    mount();
    expect(screen.getByText(`${DOCS_DIR}/design.md`)).toBeTruthy();
    cleanup();
    mount({ dirty: true });
    expect(screen.getByText(`${DOCS_DIR}/design.md •`)).toBeTruthy();
  });

  it('offers Edit and Preview, and Fields only where fields mean something', () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Fields' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();

    cleanup();
    mount({ fieldsAvailable: true, fields: <p>the fields</p>, view: 'fields' });
    expect(screen.getByRole('button', { name: 'Fields' })).toBeTruthy();
    expect(screen.getByText('the fields')).toBeTruthy();
  });

  it('marks the active view and reports a switch', () => {
    const calls = mount({ view: 'preview' });
    expect(screen.getByRole('button', { name: 'Preview' }).className).toBe('active');
    expect(screen.getByRole('button', { name: 'Edit' }).className).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(calls.onView.mock.calls).toEqual([['edit']]);
  });

  it('edits through a textarea carrying the draft', () => {
    const calls = mount({ draft: 'hello' });
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(area.value).toBe('hello');
    fireEvent.change(area, { target: { value: 'hello there' } });
    expect(calls.onDraft.mock.calls).toEqual([['hello there']]);
  });

  it('renders the draft as markdown in Preview, not the file on disk', () => {
    // The distinction matters: Preview is what Save would write, so it must follow the buffer.
    mount({ view: 'preview', draft: '# Unsaved heading\n' });
    expect(screen.getByRole('heading', { name: 'Unsaved heading' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('enables Save only when there is something to save', () => {
    mount({ dirty: false });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const calls = mount({ dirty: true });
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(calls.onSave).toHaveBeenCalledOnce();
  });

  it('disables Save while a write is in flight', () => {
    mount({ dirty: true, busy: true });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides Save in the fields view, which saves itself', () => {
    mount({ view: 'fields', fieldsAvailable: true, fields: <p>f</p>, dirty: true });
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('offers Delete only for a file that may be deleted', () => {
    const calls = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(calls.onDelete).toHaveBeenCalledOnce();

    cleanup();
    mount({ file: file({ deletable: false, category: 'instructions', name: CLAUDE_MD }) });
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('warns on a VibeBoard-managed file, and only on one', () => {
    mount({ file: file({ managed: true, name: CLAUDE_MD, path: CLAUDE_MD }) });
    const notice = screen.getByRole('alert');
    expect(notice.textContent).toContain('managed by VibeBoard');
    expect(notice.textContent).toContain('INSTRUCTIONS.md');

    cleanup();
    mount();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
