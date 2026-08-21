import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';

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
  // For the small class of actions that destroy more than the one thing named: the user must type
  // this exactly before the button becomes usable. Deleting a folder with contents is the case it
  // exists for — the board project is usually not a git repo, so there is nothing to recover from.
  // Compared after trimming: this guards against answering on autopilot, not against an attacker.
  requireText?: string;
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
  // What the user has typed into a requireText dialog. Reset on every new question, or the previous
  // answer would unlock the next one.
  const [typed, setTyped] = useState('');
  // The resolver lives in a ref, not in state: settling from inside a state updater would be a side
  // effect in a function React is allowed to call twice.
  const pending = useRef<Pending | null>(null);
  const cancelButton = useRef<HTMLButtonElement | null>(null);

  const settle = useCallback((confirmed: boolean): void => {
    pending.current?.settle(confirmed);
    pending.current = null;
    setRequest(null);
    setTyped('');
  }, []);

  const confirm = useCallback(
    (next: ConfirmRequest): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        // A second question while one is open answers the first with "no" rather than abandoning its
        // promise unsettled — an awaited call that never returns would strand the caller forever.
        pending.current?.settle(false);
        pending.current = { request: next, settle: resolve };
        setRequest(next);
        setTyped('');
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
  // the dialog opens must not be what confirms it. A requireText dialog focuses its input instead —
  // there is nothing to type into otherwise, and its button is disabled until the text matches, so a
  // stray keypress still cannot confirm it.
  useEffect(() => {
    if (request && !request.requireText) cancelButton.current?.focus();
  }, [request]);

  // Whether the confirming button is usable at all. A dialog with no requireText is always unlocked.
  const unlocked = !request?.requireText || typed.trim() === request.requireText;

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
          {request.requireText && (
            <label className="confirm-require">
              Type <strong>{request.requireText}</strong> to confirm
              <input
                className="confirm-input"
                value={typed}
                autoFocus
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && unlocked) settle(true);
                }}
              />
            </label>
          )}
          <div className="confirm-actions">
            <Button ref={cancelButton} onClick={() => settle(false)}>
              Cancel
            </Button>
            {/* BOTH buttons had to move together. `.confirm-cancel` was in the ratchet and `.confirm-go`
                was not — only because its class arrives through a ternary, which the check cannot read
                and says so. Migrating the visible one alone would have left the pair at two different
                sizes in the same dialog. `.confirm-go` keeps its class for the danger colour only. */}
            <Button
              className={request.danger ? 'confirm-go danger' : 'confirm-go'}
              disabled={!unlocked}
              onClick={() => settle(true)}
            >
              {request.action}
            </Button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
