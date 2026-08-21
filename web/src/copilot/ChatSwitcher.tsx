import { useState } from 'react';
import type { ChatMeta } from '../shared';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
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
          className="chat-current"
          disabled={running}
          onClick={() => setChatMenu((v) => !v)}
          title="Chat history"
        >
          <span className="chat-current-title">{currentTitle}</span>
          <span className="chat-caret">▾</span>
        </button>
        {chatMenu && (
          <>
            <div className="chat-menu-backdrop" onClick={() => setChatMenu(false)} />
            <div className="chat-menu" role="menu">
              {chats.length === 0 && <div className="chat-menu-empty">No saved chats yet</div>}
              {chats.map((c) => (
                <div key={c.id} className={`chat-menu-item${c.id === currentChatId ? ' active' : ''}`}>
                  <button
                    className="chat-menu-open"
                    onClick={() => {
                      onOpen(c.id, backend);
                      setChatMenu(false);
                    }}
                    title={c.title}
                  >
                    <span className="chat-menu-title">
                      <Chip pill state={c.backend} className="chat-backend">
                        {backendLabel(c.backend)}
                      </Chip>
                      {c.title}
                    </span>
                    <span className="chat-menu-meta">
                      {relTime(c.updatedAt)} · {c.messageCount} msg
                    </span>
                  </button>
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
            </div>
          </>
        )}
      </div>
      <Button size="sm" className="chat-new" disabled={running} onClick={onNew} title="Start a fresh chat">
        + New
      </Button>
    </div>
  );
}
