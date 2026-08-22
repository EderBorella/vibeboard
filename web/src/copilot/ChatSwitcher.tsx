import { useState } from 'react';
import type { ChatMeta } from '../shared';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Panel } from '../ui/Panel';
import { Readout } from '../ui/Readout';
import { backendLabel, relTime } from './format';

interface Props {
  chats: ChatMeta[];
  currentChatId?: string;
  // The backend in force (override included) — rides along on open so the server can decide
  // whether the stored CLI session is resumable.
  backend: string;
  running: boolean;
  onOpen: (id: string, backend?: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

// The chat bar: which chat is open, the history menu, and "+ New". The menu's open/closed
// state is local because nothing outside this bar reads it.
export function ChatSwitcher({ chats, currentChatId, backend, running, onOpen, onDelete, onNew }: Props) {
  const [chatMenu, setChatMenu] = useState(false);
  const currentTitle = chats.find((c) => c.id === currentChatId)?.title ?? 'New chat';

  return (
    <div className="copilot-chatbar">
      <div className="chat-switcher">
        <button
          className="vb-trigger"
          disabled={running}
          onClick={() => setChatMenu((v) => !v)}
          title="Chat history"
        >
          <span className="vb-trigger-label">{currentTitle}</span>
          <span className="vb-caret vb-twist">▾</span>
        </button>
        {chatMenu && (
          <>
            <div className="chat-menu-backdrop" onClick={() => setChatMenu(false)} />
            <Panel className="chat-menu" role="menu">
              {chats.length === 0 && <div className="vb-empty vb-empty-small">No saved chats yet</div>}
              {chats.map((c) => (
                <div key={c.id} className={`chat-menu-item${c.id === currentChatId ? ' active' : ''}`}>
                  <Panel
                    as="button"
                    variant="flat"
                    className="chat-menu-open"
                    data-testid="chat-menu-open"
                    onClick={() => {
                      onOpen(c.id, backend);
                      setChatMenu(false);
                    }}
                    title={c.title}
                  >
                    <span className="chat-menu-title">
                      {/* `tone` AND NOT `state`, because a backend name is not a state of anything —
                          see the ruling at `.chat-backend` in organisms/copilot/copilot.css. It was
                          `state={c.backend}`
                          against two rules that spent the palette's primary and secondary on which of
                          two agents this chat ran on. */}
                      <Chip pill tone="neutral" className="chat-backend">
                        {backendLabel(c.backend)}
                      </Chip>
                      {c.title}
                    </span>
                    <Readout>
                      {relTime(c.updatedAt)} · {c.messageCount} msg
                    </Readout>
                  </Panel>
                  <Button
                    variant="bare"
                    size="sm"
                    className="chat-del"
                    title="Delete chat"
                    onClick={() => onDelete(c.id)}
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </Panel>
          </>
        )}
      </div>
      <Button size="sm" className="chat-new" disabled={running} onClick={onNew} title="Start a fresh chat">
        + New
      </Button>
    </div>
  );
}
