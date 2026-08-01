import type { ReactNode } from 'react';
import type { ControlFile } from '../api';
import { EditorBody, EditorShell, type EditorView } from './EditorShell';

// A control file as opened for editing: its listing metadata plus the content on disk.
export type OpenFile = ControlFile & { content: string };

// Re-exported so Project Control's own modules keep importing their view type from here — the shell
// owns the type because the Explorer needs it too.
export type ControlView = EditorView;

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

// The open control file's pane. The chrome is EditorShell, shared with the Explorer; what is left
// here is what only Project Control has — the managed-file disclaimer, and a skill's fields.
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
  const views: EditorView[] = fieldsAvailable ? ['fields', 'edit', 'preview'] : ['edit', 'preview'];
  return (
    <EditorShell
      path={file.path}
      dirty={dirty}
      views={views}
      view={view}
      onView={onView}
      actions={
        <>
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
        </>
      }
      notice={
        file.managed && (
          <div className="control-disclaimer" role="alert">
            ⚠ <strong>{file.name}</strong> is managed by VibeBoard — the copilot won’t edit it, and it steers
            how the boards work. Edit only if you know what you’re doing. For your own standing instructions,
            use <strong>INSTRUCTIONS.md</strong> instead.
          </div>
        )
      }
    >
      {view === 'fields' ? fields : <EditorBody view={view} draft={draft} onDraft={onDraft} />}
    </EditorShell>
  );
}
