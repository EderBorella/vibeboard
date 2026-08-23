import type { ReactNode } from 'react';
import { Control } from '../../atoms/Control';
import { Readout } from '../../atoms/Readout';
import { Stack } from '../../atoms/Stack';
import { renderMarkdown } from '../../lib/markdown';
import { Tabs } from '../../molecules/Tabs';

// IT WAS `ui/EditorShell` AND IT WAS THE WRONG LAYER, which is the whole subject of the atomic revamp's
// template layer (docs/design-system.md, *The atomic revamp: the layer tree*): a shared primitive
// living in `ui/` that wrote FIVE of Project Control's own class names — `control-editor-head`,
// `control-tabs`, `control-editor-actions`, `control-textarea`, `control-preview`. A shared thing
// reaching into one feature's stylesheet is the exact inversion `npm run check:layers` exists to refuse,
// and the gate is blocking as of this phase. The classes are this template's now and say so.
//
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

export function EditorLayout({ path, dirty, views, view, onView, actions, notice, children }: ShellProps) {
  return (
    <>
      <Stack gap={4} pad={[4, 6]} edge="bottom" className="vb-editor-head">
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
        {/* A CLUSTER OF ACTIONS, NOT A ROW, and it was `<div className="vb-row push">` — which broke twice
            over. `.vb-row` declares `width: 100%`, so it demanded the whole head, squeezed the three-tab
            strip beside it from its natural width down to 96px and left `margin-left: auto` no free space
            to push into: Delete rendered ON TOP of Preview. And the composition change took `display: flex`
            off `.vb-row` — it is the atom's now — so it was not even a row any more. A `Stack` is what it
            always meant: a flex line with a gap, no width of its own, pushed right. */}
        <Stack gap={3} className="push">
          {actions}
        </Stack>
      </Stack>
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
        className="vb-editor-body"
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        spellCheck={false}
      />
    );
  }
  if (view === 'preview') return <div className="vb-editor-body markdown">{renderMarkdown(draft)}</div>;
  return null;
}
