import type { ReactNode } from 'react';
import { Control } from '../atoms/Control';
import { Readout } from '../atoms/Readout';
import { renderMarkdown } from '../markdown';
import { Tabs } from '../molecules/Tabs';

// The chrome around an editable file: which path is open, which view of it you are looking at, and
// what you can do to it. Shared by Project Control (a control document, sometimes as fields) and the
// Explorer (any file in the project, sometimes not editable at all), because they are the same three
// rows and the difference is entirely in what goes inside them.
//
// A fragment, not a wrapper element — these are direct children of the editor column and the layout
// depends on that.

export type EditorView = 'fields' | 'edit' | 'preview';

const VIEW_LABELS: Record<EditorView, string> = {
  fields: 'Fields',
  edit: 'Edit',
  preview: 'Preview',
};

interface ShellProps {
  // What is open, shown verbatim: the project-relative path, not just the name, because two files
  // can share a name and only the path says which one you are about to save.
  path: string;
  dirty?: boolean;
  // The views on offer, in order. A view the caller cannot render simply is not listed, which is how
  // Fields appears for a skill and nowhere else, and how a binary file gets no tabs at all.
  views: EditorView[];
  view: EditorView;
  onView: (v: EditorView) => void;
  actions?: ReactNode;
  // A warning above the body: managed-file disclaimer, escaped symlink, whatever the caller needs
  // to say before the user edits.
  notice?: ReactNode;
  children?: ReactNode;
}

export function EditorShell({ path, dirty, views, view, onView, actions, notice, children }: ShellProps) {
  return (
    <>
      <div className="control-editor-head">
        <Readout testId="editor-path">
          {path}
          {dirty ? ' •' : ''}
        </Readout>
        {/* `Tabs`: one file, three views, and the editor stays. `.control-tabs button` was the fourth
            hand-rolled tab family and the only one with no class of its own on the cell at all. */}
        {views.length > 0 && (
          <Tabs
            label="View"
            items={views.map((v) => ({ value: v, label: VIEW_LABELS[v] }))}
            value={view}
            onChange={(v) => onView(v as EditorView)}
          />
        )}
        <div className="control-editor-actions">{actions}</div>
      </div>
      {notice}
      {children}
    </>
  );
}

interface BodyProps {
  view: EditorView;
  // The buffer, not the file: Preview renders what Save would write, so an unsaved heading shows up.
  draft: string;
  onDraft: (v: string) => void;
}

// The buffer itself, as either a textarea or rendered markdown. Returns nothing for 'fields' — that
// view's content is the caller's, and there is no generic form for it.
export function EditorBody({ view, draft, onDraft }: BodyProps) {
  if (view === 'edit') {
    return (
      // NOT a `Field`: this IS the editor body, and the file path above it is its label.
      <Control
        as="textarea"
        mono
        className="control-textarea"
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        spellCheck={false}
      />
    );
  }
  if (view === 'preview') return <div className="control-preview markdown">{renderMarkdown(draft)}</div>;
  return null;
}
