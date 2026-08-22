// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCS_DIR, POINTER_FILES } from '../src/core/layout.js';
import { ControlFileEditor, type OpenFile } from '../web/src/control/ControlFileEditor.js';

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

  // ON `role="tab"`, WHICH IS WHAT THESE THREE ARE NOW. The views were `.control-tabs button` — a bare
  // `<button>` with no role at all — and they are `Tabs` cells, so the role the row asserts is the one
  // `getByRole` has to ask for. It is the stronger claim as well as the true one: it says the strip is a
  // tablist and not three buttons that happen to sit together.
  it('offers Edit and Preview, and Fields only where fields mean something', () => {
    mount();
    expect(screen.queryByRole('tab', { name: 'Fields' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Preview' })).toBeTruthy();

    cleanup();
    mount({ fieldsAvailable: true, fields: <p>the fields</p>, view: 'fields' });
    expect(screen.getByRole('tab', { name: 'Fields' })).toBeTruthy();
    expect(screen.getByText('the fields')).toBeTruthy();
  });

  // ON `aria-selected` AND NOT ON A CLASS LIST. `.className` was `'active'` against `''`, which is a claim
  // about how `Tabs` spells its state; `selected` is the contract a tablist makes, and `getByRole` reads it
  // through the accessibility tree rather than through the DOM. Both directions asserted, because a row
  // that marked EVERY cell selected would satisfy the positive alone.
  it('marks the active view and reports a switch', () => {
    const calls = mount({ view: 'preview' });
    expect(screen.getByRole('tab', { name: 'Preview', selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Edit', selected: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
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
