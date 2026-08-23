import { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Chip } from '../../atoms/Chip';
import { Readout } from '../../atoms/Readout';
import { Text } from '../../atoms/Text';
import type { ChatMeta } from '../../lib/shared';
import { Menu } from '../../molecules/Menu';
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
          <span className="vb-clip">{currentTitle}</span>
          <span className="vb-caret vb-twist">▾</span>
        </button>
        {/* `Menu list`: picking a session takes you somewhere else, and it dismisses — which is the half
            of the definition a `Tabs` never has. Five classes went: the floating box, the row, the
            two-line button, the ellipsised title and the backdrop are all the molecule's, and what was
            left of `.chat-menu-item` — a wrapper whose only job was to keep a row's delete glyph beside
            it — is a grid column instead. */}
        {chatMenu && (
          <Menu
            orientation="list"
            label="Chat history"
            onDismiss={() => setChatMenu(false)}
            value={currentChatId ?? null}
            onChange={(id) => {
              onOpen(id, backend);
              setChatMenu(false);
            }}
            items={chats.map((c) => ({
              value: c.id,
              title: c.title,
              label: (
                <>
                  {/* `tone` AND NOT `state`, because a backend name is not a state of anything —
                      see the ruling at `.chat-backend` in organisms/copilot/copilot.css. It was
                      `state={c.backend}` against two rules that spent the palette's primary and
                      secondary on which of two agents this chat ran on. */}
                  <Chip pill tone="neutral" className="chat-backend">
                    {backendLabel(c.backend)}
                  </Chip>
                  {c.title}
                </>
              ),
              meta: (
                <Readout>
                  {relTime(c.updatedAt)} · {c.messageCount} msg
                </Readout>
              ),
              trailing: (
                <Button
                  variant="bare"
                  size="sm"
                  className="chat-del"
                  title="Delete chat"
                  onClick={() => onDelete(c.id)}
                >
                  ✕
                </Button>
              ),
            }))}
          >
            {chats.length === 0 && <Text role="hint">No saved chats yet</Text>}
          </Menu>
        )}
      </div>
      <Button size="sm" className="chat-new" disabled={running} onClick={onNew} title="Start a fresh chat">
        + New
      </Button>
    </div>
  );
}
