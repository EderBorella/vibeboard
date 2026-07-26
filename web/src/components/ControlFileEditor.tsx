import type { ReactNode } from 'react';
import type { ControlFile } from '../api';
import { renderMarkdown } from '../markdown';

// A control file as opened for editing: its listing metadata plus the content on disk.
export type OpenFile = ControlFile & { content: string };

export type ControlView = 'fields' | 'edit' | 'preview';

interface Props {
  file: OpenFile;
  // The editor buffer and its dirty flag live in the parent: it is what save() writes, and a
  // live snapshot must not clobber unsaved edits.
  draft: string;
  dirty: boolean;
  view: ControlView;
  busy: boolean;
  onView: (v: ControlView) => void;
  // A skill can be authored as fields; every other control file is text. The tab appears only where
  // it means something.
  fieldsAvailable?: boolean;
  // What the fields view renders. Passed in rather than built here so this component stays the
  // chrome around a buffer.
  fields?: ReactNode;
  onDraft: (v: string) => void;
  onSave: () => void;
  onDelete: () => void;
}

// The open file's pane: path + view tabs + actions, the managed-file warning, and the buffer
// itself as either a textarea or rendered markdown. A fragment, not a wrapper element — these
// are direct children of .control-editor and the layout depends on that.
export function ControlFileEditor({
  file,
  draft,
  dirty,
  view,
  busy,
  onView,
  onDraft,
  onSave,
  onDelete,
  fieldsAvailable,
  fields,
}: Props) {
  return (
    <>
      <div className="control-editor-head">
        <span className="control-editor-path">
          {file.path}
          {dirty ? ' •' : ''}
        </span>
        <div className="control-tabs" role="group" aria-label="View">
          {fieldsAvailable && (
            <button className={view === 'fields' ? 'active' : ''} onClick={() => onView('fields')}>
              Fields
            </button>
          )}
          <button className={view === 'edit' ? 'active' : ''} onClick={() => onView('edit')}>
            Edit
          </button>
          <button className={view === 'preview' ? 'active' : ''} onClick={() => onView('preview')}>
            Preview
          </button>
        </div>
        <div className="control-editor-actions">
          {file.deletable && (
            <button className="btn-danger" disabled={busy} onClick={onDelete}>
              Delete
            </button>
          )}
          {view !== 'fields' && (
            <button className="btn-primary" disabled={busy || !dirty} onClick={onSave}>
              Save
            </button>
          )}
        </div>
      </div>
      {file.managed && (
        <div className="control-disclaimer" role="alert">
          ⚠ <strong>{file.name}</strong> is managed by VibeBoard — the copilot won’t edit it, and it steers
          how the boards work. Edit only if you know what you’re doing. For your own standing instructions,
          use <strong>INSTRUCTIONS.md</strong> instead.
        </div>
      )}
      {view === 'fields' && fields}
      {view === 'edit' && (
        <textarea
          className="control-textarea"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          spellCheck={false}
        />
      )}
      {view === 'preview' && <div className="control-preview markdown">{renderMarkdown(draft)}</div>}
    </>
  );
}
