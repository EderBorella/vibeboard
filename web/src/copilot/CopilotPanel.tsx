import { useEffect, useRef, useState } from 'react';
import { getModelStatus, listModels, type ModelOption, type ModelStatus } from '../api';
import { useConfirm } from '../confirm/useConfirm';
import { backendCaps, backendDefaults } from '../shared';
import { Button } from '../ui/Button';
import { useFetched } from '../useFetched';
import { BackendPicker } from './BackendPicker';
import { ChatSwitcher } from './ChatSwitcher';
import { CopilotControls } from './CopilotControls';
import { CopilotReadout } from './CopilotReadout';
import { clampToCaps } from './choice';
import type { CopilotMode, EffortLevel, useCopilot } from './useCopilot';

const NO_MODELS: ModelOption[] = [];

interface Props {
  copilot: ReturnType<typeof useCopilot>;
  backend: string;
  mode: CopilotMode;
  model: string;
  effort: EffortLevel;
  onMode: (m: CopilotMode) => void;
  onModel: (m: string) => void;
  onEffort: (e: EffortLevel) => void;
  onBackend: (b: string) => void;
  // True when any dock control differs from the configured default; clearing goes back to it.
  contextBudget: number;
  overridden: boolean;
  onReset: () => void;
  onClose: () => void;
}

export function CopilotPanel({
  copilot,
  backend,
  mode,
  model,
  effort,
  contextBudget,
  onMode,
  onModel,
  onEffort,
  onBackend,
  overridden,
  onReset,
  onClose,
}: Props) {
  const {
    items,
    running,
    model: activeModel,
    stats,
    chats,
    currentChatId,
    send,
    compact,
    newSession,
    openChat,
    deleteChat,
    cancel,
    authorised,
    setCopilotAuthority,
  } = copilot;
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Modes and efforts are backend-specific, so a selection carried across a backend switch
  // gets clamped to what this backend actually publishes. The model arrives already
  // resolved — App owns precedence.
  const caps = backendCaps(backend);
  const { mode: effMode, effort: effEffort } = clampToCaps({ backend, model, effort }, mode);

  // Model choices depend on the configured backend (claude aliases vs opencode models). Emptied on a
  // failure rather than kept: this is a menu of what can be chosen now, and one backend's aliases are
  // not offerable under the other.
  const { value: models } = useFetched(() => listModels(backend), [backend], NO_MODELS, {
    onFailure: 'clear',
  });

  // Warn when the chosen model can't call tools — the copilot can't touch cards without them.
  const noTools = models.find((m) => m.id === model)?.caps?.toolCall === false;

  // Live status/uptime for the selected model (OpenRouter only; null otherwise).
  useEffect(() => {
    let live = true;
    setStatus(null);
    getModelStatus(model)
      .then((s) => {
        if (live) setStatus(s);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [model]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: items/running are scroll triggers
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [items, running]);

  // Always concrete — the server would fill these in anyway, and sending them keeps what the
  // UI shows and what runs the same thing.
  // The backend goes too: the dock is a session override, so the server can't assume the
  // configured one is in force.
  const turnOpts = () => ({ mode: effMode, backend, model, effort: effEffort });
  const submit = (): void => {
    if (!draft.trim() || running) return;
    send(draft, turnOpts());
    setDraft('');
  };

  return (
    <aside className="copilot">
      <div className="copilot-head">
        <span className="copilot-title">Copilot</span>
        <BackendPicker
          value={backend}
          disabled={running}
          label="Backend"
          titleFor={(b) =>
            running ? 'Finish the current turn first' : `Switch to ${b.label} (starts a new chat)`
          }
          onChange={onBackend}
        />
        {activeModel && <span className="copilot-model">{activeModel}</span>}
        {/* Not in the ratchet — Phase 2's control reset took its font-size away, so no rule gave it
            geometry any more — but the same `✕` as nine others, so it goes with them. */}
        <Button variant="bare" className="copilot-x" onClick={onClose} title="Hide (session keeps running)">
          ✕
        </Button>
      </div>

      <ChatSwitcher
        chats={chats}
        currentChatId={currentChatId}
        backend={backend}
        running={running}
        onOpen={openChat}
        onDelete={(chatId) => {
          const chat = chats.find((c) => c.id === chatId);
          void confirm({
            title: 'Delete this chat?',
            // Named: the switcher lists several, and they are told apart by their first line.
            body: `“${chat?.title ?? chatId}” is removed from disk. This cannot be undone.`,
            action: 'Delete chat',
            danger: true,
          }).then((ok) => {
            if (ok) deleteChat(chatId);
          });
        }}
        onNew={newSession}
      />

      {/*
        WHAT THE COPILOT MAY DO TO THE PROJECT, and it is off until you say otherwise.

        Unauthorised it can read anything and write ordinary project files; the whole of `.vibeboard/`
        is denied to it by the OS, so it cannot touch the board, the config or the foundation documents
        however it is asked to. Authorising mints a credential for THIS conversation, which the server
        revokes when the chat or the project changes.

        The confirm is not ceremony: the grant includes writing the foundation documents, and two of
        those carry commands the server later runs outside the sandbox as you.
      */}
      <div className="copilot-authority">
        {/* The ternary was `btn-primary`/`btn-secondary` — a toggle whose "on" state is the filled one.
            It is also the one site the ratchet could not see, because a class reaching a `<button>`
            through an expression is not a literal in the attribute text; the check names that gap. */}
        <Button
          variant={authorised ? 'primary' : 'default'}
          size="md"
          onClick={() => {
            if (authorised) {
              setCopilotAuthority(false);
              return;
            }
            void confirm({
              title: 'Let the copilot change this project?',
              body: 'It will be able to create, edit, move and archive cards, and to write the five foundation documents — through the API, for this conversation only. Two of those documents hold commands that auto-pilot later runs outside the sandbox, as you; if it changes one, auto-pilot will not start until you have read them.',
              action: 'Authorise',
            }).then((ok) => {
              if (ok) setCopilotAuthority(true);
            });
          }}
          title={
            authorised
              ? 'The copilot holds a credential for this conversation. Click to revoke it.'
              : 'The copilot can read everything and change nothing. Click to let it use the API.'
          }
        >
          {authorised ? 'Authorised' : 'Authorise'}
        </Button>
      </div>

      <CopilotControls
        caps={caps}
        effMode={effMode}
        effEffort={effEffort}
        effModel={model}
        defaultModel={backendDefaults(backend).model}
        models={models}
        running={running}
        onMode={onMode}
        onModel={onModel}
        onEffort={onEffort}
        onCompact={() => compact(turnOpts())}
      />

      {overridden && (
        <div className="copilot-override">
          Just for this session — the project default is unchanged.
          <Button size="sm" className="copilot-reset" onClick={onReset} disabled={running}>
            Use default
          </Button>
        </div>
      )}
      {noTools && (
        <div className="copilot-warn" role="alert">
          ⚠ This model can’t use tools — the copilot can’t create or edit cards. Pick a 🔧 model.
        </div>
      )}
      {status && (
        <div className={`copilot-status ${status.up ? 'ok' : 'down'}`}>
          <span className="status-dot" />
          {status.up ? 'available' : 'unavailable'}
          {status.uptime != null && ` · ${status.uptime.toFixed(1)}% uptime`}
          {` · ${status.endpoints} provider${status.endpoints === 1 ? '' : 's'}`}
        </div>
      )}

      <div className="copilot-body" ref={bodyRef}>
        {items.length === 0 && (
          <div className="copilot-empty">
            Ask the copilot to work on this project. It runs your configured backend ({backend}) in the
            project folder, so card changes appear on the board as it works.
          </div>
        )}
        {items.map((it) => (
          <div key={it.id} className={`msg msg-${it.kind}`}>
            {it.kind === 'tool' ? (
              <span className="msg-tool">⚙ {it.toolName}</span>
            ) : it.kind === 'thinking' ? (
              <span className="msg-thinking">{it.text}</span>
            ) : (
              it.text
            )}
          </div>
        ))}
        {running && <div className="msg msg-running">…working</div>}
      </div>

      <CopilotReadout stats={stats} budget={contextBudget} />

      <div className="copilot-input">
        <textarea
          value={draft}
          placeholder={running ? 'Running…' : 'Message the copilot (Enter to send)'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={3}
        />
        {running ? (
          <Button size="md" onClick={cancel}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" size="md" onClick={submit} disabled={!draft.trim()}>
            Send
          </Button>
        )}
      </div>

      {dialog}
    </aside>
  );
}
