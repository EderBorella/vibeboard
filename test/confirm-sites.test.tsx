// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCS_DIR } from '../src/core/layout.js';

const NOTES = `${DOCS_DIR}/notes.md`;

// The two irreversible actions that live outside the card pane: deleting a chat, and deleting a file
// from Project Control. Each is asserted the same way — the question appears, NOTHING happens while
// it is open, and the deletion only follows a yes.
const api = vi.hoisted(() => ({
  listControlFiles: vi.fn(async () => [
    {
      key: 'docs',
      label: 'Docs',
      files: [{ path: NOTES, name: 'notes.md', category: 'docs', managed: false, deletable: true }],
    },
  ]),
  getControlFile: vi.fn(async () => ({
    path: NOTES,
    name: 'notes.md',
    category: 'docs',
    managed: false,
    deletable: true,
    content: 'some notes',
  })),
  deleteControlFile: vi.fn(async () => undefined),
  putControlFile: vi.fn(async () => undefined),
  createControlFile: vi.fn(async () => undefined),
  renameControlFile: vi.fn(async () => undefined),
  putSkill: vi.fn(async () => ({ skills: [], invalid: [] })),
  listSkills: vi.fn(async () => ({ skills: [], invalid: [] })),
  getResources: vi.fn(async () => ({ links: [] })),
  putResources: vi.fn(async () => undefined),
  listModels: vi.fn(async () => []),
  getModelStatus: vi.fn(async () => ({ up: true })),
}));
vi.mock('../web/src/api.js', () => api);
vi.mock('../web/src/api', () => api);

const { ProjectControl } = await import('../web/src/control/ProjectControl.js');
const { CopilotPanel } = await import('../web/src/copilot/CopilotPanel.js');

import type { ProjectConfig, ProjectSnapshot } from '../web/src/shared.js';

afterEach(cleanup);

// jsdom implements no scrolling at all, and the copilot transcript scrolls itself to the bottom on
// mount. Nothing about scrolling is under test here.
Element.prototype.scrollTo = Element.prototype.scrollTo ?? ((): void => {});

const config: ProjectConfig = {
  name: 'T',
  boards: {
    features: { columns: ['Backlog', 'Done'] },
    product: { columns: ['Backlog', 'Done'] },
    engineering: { columns: ['Todo', 'Done'] },
  },
  miniatureChars: 40,
  idPadding: 3,
  keepChats: 20,
  contextBudget: 200_000,
  maxConcurrentRuns: 3,
  copilot: { backend: 'claude-code', backends: {} },
};

const snapshot = {
  root: '/tmp/p',
  name: 'Demo',
  config,
  boards: { features: [], product: [], engineering: [] },
  archivedCounts: { features: 0, product: 0, engineering: 0 },
} as ProjectSnapshot;

describe('Project Control — deleting a file', () => {
  const openTheFile = async (): Promise<void> => {
    api.deleteControlFile.mockClear();
    render(<ProjectControl snapshot={snapshot} />);
    await waitFor(() => expect(screen.getByText('notes.md')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText('notes.md'));
    });
    await waitFor(() => expect(screen.getByText('Delete')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText('Delete'));
    });
  };

  it('asks, naming the path it would remove, and deletes nothing yet', async () => {
    await openTheFile();
    expect(screen.getByText('Delete notes.md?')).toBeTruthy();
    // The path, not just the name: two files can share a name in different groups.
    expect(screen.getByText(/docs\/notes\.md is removed from disk/)).toBeTruthy();
    expect(api.deleteControlFile).not.toHaveBeenCalled();
  });

  it('deletes nothing when the answer is no', async () => {
    await openTheFile();
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });
    expect(api.deleteControlFile).not.toHaveBeenCalled();
  });

  it('deletes the file once the answer is yes', async () => {
    await openTheFile();
    await act(async () => {
      fireEvent.click(screen.getByText('Delete file'));
    });
    expect(api.deleteControlFile).toHaveBeenCalledWith(NOTES);
  });
});

describe('the copilot — deleting a chat', () => {
  const deleteChat = vi.fn();
  const copilot = {
    items: [],
    running: false,
    model: 'opus',
    stats: { costUsd: 0, turns: 0, lastDurationMs: 0, contextTokens: 0 },
    chats: [
      {
        id: 'chat-1',
        title: 'the one about tokens',
        backend: 'claude-code',
        updatedAt: '2026-07-26T14:30:00.000Z',
        messageCount: 4,
      },
    ],
    currentChatId: 'chat-1',
    send: vi.fn(),
    compact: vi.fn(),
    newSession: vi.fn(),
    openChat: vi.fn(),
    deleteChat,
    cancel: vi.fn(),
  } as unknown as Parameters<typeof CopilotPanel>[0]['copilot'];

  const props = {
    copilot,
    backend: 'claude-code',
    mode: 'bypassPermissions',
    model: 'opus',
    effort: 'high',
    onMode: vi.fn(),
    onModel: vi.fn(),
    onEffort: vi.fn(),
    onBackend: vi.fn(),
    onReset: vi.fn(),
    onClose: vi.fn(),
    overridden: false,
    contextBudget: 200_000,
  } as unknown as Parameters<typeof CopilotPanel>[0];

  const openTheMenu = async (): Promise<void> => {
    deleteChat.mockClear();
    render(<CopilotPanel {...props} />);
    await act(async () => {
      fireEvent.click(screen.getByTitle('Chat history'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle('Delete chat'));
    });
  };

  it('asks, naming the chat, and deletes nothing yet', async () => {
    await openTheMenu();
    expect(screen.getByText('Delete this chat?')).toBeTruthy();
    // Scoped to the dialog: the title is also in the list behind it, so an unscoped match would pass
    // for a dialog that named nothing.
    expect(within(screen.getByRole('dialog')).getByText(/the one about tokens/)).toBeTruthy();
    expect(deleteChat).not.toHaveBeenCalled();
  });

  it('deletes nothing when the answer is no', async () => {
    await openTheMenu();
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });
    expect(deleteChat).not.toHaveBeenCalled();
  });

  it('deletes the chat once the answer is yes', async () => {
    await openTheMenu();
    await act(async () => {
      fireEvent.click(screen.getByText('Delete chat'));
    });
    expect(deleteChat).toHaveBeenCalledWith('chat-1');
  });
});
