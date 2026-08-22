import { useCallback, useEffect, useState } from 'react';
import { type FileRead, putFsFile, readFsFile } from '../api';
import { errorText } from '../errors';
import type { EditorView } from '../templates/EditorLayout';
import { useAction } from '../useAction';

// The one file the Explorer has open: what it is, the editor buffer, and the two calls that move
// bytes. Split from ExplorerView so the buffer's rules — never clobber unsaved typing, never save a
// file that was not opened as text — are testable without a tree beside them.

export interface OpenFile {
  file: FileRead | null;
  draft: string;
  dirty: boolean;
  view: EditorView;
  busy: boolean;
  error: string | null;
  setView: (v: EditorView) => void;
  edit: (value: string) => void;
  open: (path: string) => Promise<void>;
  close: () => void;
  // True when the write landed, so the caller can re-list the folder — the size shown in the tree is
  // stale the moment the file is written.
  save: () => Promise<boolean>;
}

export function useOpenFile(trigger: unknown): OpenFile {
  const [file, setFile] = useState<FileRead | null>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<EditorView>('edit');
  const { busy, error, run, setError } = useAction();

  const open = useCallback(
    async (path: string): Promise<void> => {
      setError(null);
      try {
        const read = await readFsFile(path);
        setFile(read);
        setDraft(read.kind === 'text' ? read.content : '');
        setDirty(false);
      } catch (e) {
        setFile(null);
        setError(errorText(e));
      }
    },
    [setError],
  );

  const close = useCallback((): void => {
    setFile(null);
    setDraft('');
    setDirty(false);
    setError(null);
  }, [setError]);

  const save = useCallback(async (): Promise<boolean> => {
    if (file?.kind !== 'text') return false;
    // On a refusal the buffer stays dirty on purpose: the edit is still unsaved, and clearing the
    // flag would disable Save and strand the text. `run` reports whether it landed.
    return run(async () => {
      await putFsFile(file.path, draft);
      setDirty(false);
      await open(file.path);
    });
  }, [file, draft, open, run]);

  // Follow the file on disk while the buffer is clean, so an agent's edit appears — and never while
  // it is dirty. `trigger` is a signal, not an input; the effect reads the current file from the
  // render in which the trigger changed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate trigger
  useEffect(() => {
    if (file && !dirty) void open(file.path);
  }, [trigger]);

  const edit = useCallback((value: string): void => {
    setDraft(value);
    setDirty(true);
  }, []);

  return { file, draft, dirty, view, busy: busy !== null, error, setView, edit, open, close, save };
}
