import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

// Ask before doing something that cannot be taken back.
//
// A hook rather than a context provider: this codebase wires everything explicitly and has no React
// context anywhere, and an owner that forgets to render `dialog` is caught by its own test — where a
// forgotten provider would be caught by nothing. The owner renders {dialog} beside its own markup;
// it is null while nothing is being asked.
//
//   const { confirm, dialog } = useConfirm();
//   if (!(await confirm({ title: 'Delete this chat?', action: 'Delete chat', danger: true }))) return;

export interface ConfirmRequest {
  title: string;
  // What is actually lost, in one sentence. The whole reason this is not window.confirm: a reversible
  // action gets to say so, instead of every dialog sounding equally final.
  body?: string;
  // The confirming button's label. "Delete chat" beats "OK": the button says what it does, so a
  // dialog answered on autopilot is still answered correctly.
  action: string;
  // Irreversible. Colours the button as destructive — the difference between "gone from disk" and
  // "restorable from the archive".
  danger?: boolean;
}

interface Pending {
  request: ConfirmRequest;
  settle: (confirmed: boolean) => void;
}

export interface Confirmer {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  dialog: ReactNode;
}

export function useConfirm(): Confirmer {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  // The resolver lives in a ref, not in state: settling from inside a state updater would be a side
  // effect in a function React is allowed to call twice.
  const pending = useRef<Pending | null>(null);
  const cancelButton = useRef<HTMLButtonElement | null>(null);

  const settle = useCallback((confirmed: boolean): void => {
    pending.current?.settle(confirmed);
    pending.current = null;
    setRequest(null);
  }, []);

  const confirm = useCallback(
    (next: ConfirmRequest): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        // A second question while one is open answers the first with "no" rather than abandoning its
        // promise unsettled — an awaited call that never returns would strand the caller forever.
        pending.current?.settle(false);
        pending.current = { request: next, settle: resolve };
        setRequest(next);
      }),
    [],
  );

  // Unmounting mid-question means the answer is no. Without this the caller's await never returns.
  useEffect(() => () => pending.current?.settle(false), []);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') settle(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, settle]);

  // Focus lands on Cancel, not on the destructive button: a stray Enter or Space arriving right after
  // the dialog opens must not be what confirms it.
  useEffect(() => {
    if (request) cancelButton.current?.focus();
  }, [request]);

  const dialog = request ? (
    <div
      className="modal-backdrop confirm-backdrop"
      // A click outside is a cancel, like Escape. Guarded on the target so a click that started
      // inside the dialog and ended on the backdrop does not count.
      onClick={(e) => {
        if (e.target === e.currentTarget) settle(false);
      }}
    >
      <div className="modal confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal-head">
          <span className="modal-title" id="confirm-title">
            {request.title}
          </span>
        </div>
        <div className="modal-body">
          {request.body && <p className="confirm-body">{request.body}</p>}
          <div className="confirm-actions">
            <button type="button" className="confirm-cancel" ref={cancelButton} onClick={() => settle(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={request.danger ? 'confirm-go danger' : 'confirm-go'}
              onClick={() => settle(true)}
            >
              {request.action}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
