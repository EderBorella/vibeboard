import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CopilotEvent } from './copilot-events.js';
import type { ProjectConfig } from '../core/types.js';
import { type StoredChat, type ChatMeta, type ChatStats, type TranscriptItem, ZERO_STATS } from '../core/chat.js';
import { DEFAULT_BACKEND } from '../core/backends.js';
import { resolveCopilotSelection } from '../core/copilot-choice.js';

// Persists copilot conversations per project as JSON files under
// <project>/.vibeboard/chat/<id>.json. The server is the source of truth: it tees the
// copilot's event stream through recordEvent(), coalescing events into the same
// TranscriptItem shape the client renders, so a reload/reconnect can replay the chat.
//
// Bound to the open project via a lightweight session ref (root + config); it self-heals
// when the open project changes (drops the in-memory current chat).

const CHAT_SUBDIR = ['.vibeboard', 'chat'];
const TITLE_MAX = 60;
const WRITE_DEBOUNCE_MS = 150;

interface SessionRef {
  root: string | undefined;
  config: ProjectConfig | undefined;
}

interface HistoryPayload {
  chats: ChatMeta[];
  currentChatId: string | undefined;
  items: TranscriptItem[];
  stats: ChatStats;
  note?: string;
}

function descByUpdated(a: { updatedAt: string }, b: { updatedAt: string }): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

function toMeta(c: StoredChat): ChatMeta {
  return {
    id: c.id,
    title: c.title || 'New chat',
    backend: c.backend,
    model: c.model,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messageCount: c.items.length,
  };
}

export class ChatStore {
  #session: SessionRef;
  #boundRoot: string | undefined;
  #current: StoredChat | undefined;
  #currentPromise: Promise<StoredChat> | undefined;
  #note: string | undefined; // one-shot mismatch note for the next history payload
  #writeTimer: ReturnType<typeof setTimeout> | undefined;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(session: SessionRef) {
    this.#session = session;
  }

  #dir(root: string): string { return join(root, ...CHAT_SUBDIR); }
  #keep(): number { return Math.max(1, this.#session.config?.keepChats ?? 20); }
  #backend(): string { return this.#session.config?.copilot.backend ?? DEFAULT_BACKEND; }
  // Via the resolver, not `copilot.model`: model/effort live in a per-backend slot now, and
  // the legacy top-level field is dropped on migration.
  #model(): string | undefined {
    return this.#session.config
      ? resolveCopilotSelection(this.#session.config.copilot, {}).model
      : undefined;
  }

  // Drop in-memory state when the open project changes, so the next access loads the new
  // project's chats.
  #rebindIfNeeded(): void {
    const root = this.#session.root;
    if (root !== this.#boundRoot) {
      this.#boundRoot = root;
      this.#current = undefined;
      this.#currentPromise = undefined;
      this.#note = undefined;
    }
  }

  #blank(): StoredChat {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      title: '',
      backend: this.#backend(),
      model: this.#model(),
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      cliSessionId: undefined,
      items: [],
      stats: { ...ZERO_STATS },
    };
  }

  #touch(c: StoredChat): void {
    c.updatedAt = new Date().toISOString();
    c.messageCount = c.items.length;
  }

  async #load(root: string, id: string): Promise<StoredChat | undefined> {
    try {
      const raw = await readFile(join(this.#dir(root), `${id}.json`), 'utf8');
      const chat = JSON.parse(raw) as StoredChat;
      return chat && chat.id ? chat : undefined;
    } catch {
      return undefined;
    }
  }

  // All persisted chats for the open project (corrupt files skipped), newest first, with the
  // in-memory current merged over its on-disk version.
  async #readAll(root: string): Promise<StoredChat[]> {
    let names: string[];
    try { names = await readdir(this.#dir(root)); } catch { return []; }
    const out: StoredChat[] = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const chat = await this.#load(root, n.slice(0, -'.json'.length));
      if (chat) out.push(chat);
    }
    out.sort(descByUpdated);
    return out;
  }

  async #allChats(): Promise<StoredChat[]> {
    const root = this.#session.root;
    const disk = root ? await this.#readAll(root) : [];
    if (this.#current) {
      const idx = disk.findIndex((c) => c.id === this.#current!.id);
      if (idx >= 0) disk[idx] = this.#current; else disk.push(this.#current);
      disk.sort(descByUpdated);
    }
    return disk;
  }

  async #ensureCurrent(): Promise<StoredChat> {
    this.#rebindIfNeeded();
    if (this.#current) return this.#current;
    if (!this.#currentPromise) {
      this.#currentPromise = this.#loadCurrent().then((c) => {
        this.#current = c;
        this.#currentPromise = undefined;
        return c;
      });
    }
    return this.#currentPromise;
  }

  async #loadCurrent(): Promise<StoredChat> {
    const root = this.#session.root;
    if (!root) return this.#blank();
    const all = await this.#readAll(root);
    return all.length ? all[0] : this.#blank();
  }

  #scheduleWrite(): void {
    if (this.#writeTimer) clearTimeout(this.#writeTimer);
    this.#writeTimer = setTimeout(() => { this.#writeTimer = undefined; void this.#persistNow(); }, WRITE_DEBOUNCE_MS);
  }

  async #persistNow(): Promise<void> {
    const root = this.#session.root;
    const c = this.#current;
    if (!root || !c || c.items.length === 0) return; // never write empty (blank) chats
    const dir = this.#dir(root);
    const file = join(dir, `${c.id}.json`);
    const data = JSON.stringify(c, null, 2);
    this.#writeChain = this.#writeChain.then(async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(file, data, 'utf8');
      await this.#prune();
    }).catch(() => { /* transient disk error; a later write retries */ });
    await this.#writeChain;
  }

  async #prune(): Promise<void> {
    const root = this.#session.root;
    if (!root) return;
    const keep = this.#keep();
    const all = await this.#readAll(root);
    if (all.length <= keep) return;
    const currentId = this.#current?.id;
    const doomed = all.slice(keep).filter((c) => c.id !== currentId);
    for (const c of doomed) {
      try { await rm(join(this.#dir(root), `${c.id}.json`)); } catch { /* already gone */ }
    }
  }

  // ---- public API ----

  async recordUser(text: string): Promise<void> {
    const c = await this.#ensureCurrent();
    if (!c.title) c.title = text.trim().slice(0, TITLE_MAX);
    c.items.push({ kind: 'user', text });
    this.#touch(c);
    this.#scheduleWrite();
  }

  recordError(message: string): void {
    const c = this.#current;
    if (!c) return;
    c.items.push({ kind: 'error', text: message });
    this.#touch(c);
    this.#scheduleWrite();
  }

  async recordEvent(event: CopilotEvent): Promise<void> {
    const c = await this.#ensureCurrent();
    switch (event.kind) {
      case 'init':
        if (event.sessionId) c.cliSessionId = event.sessionId;
        if (event.model) c.model = event.model;
        break;
      case 'text':
        if (event.text) { c.items.push({ kind: 'assistant', text: event.text }); this.#touch(c); }
        break;
      case 'tool_use':
        c.items.push({ kind: 'tool', text: '', toolName: event.name });
        this.#touch(c);
        break;
      case 'usage':
        if (typeof event.contextTokens === 'number') c.stats.contextTokens = event.contextTokens;
        break;
      case 'result':
        if (event.sessionId) c.cliSessionId = event.sessionId;
        if (event.stats) {
          c.stats.costUsd += event.stats.costUsd;
          c.stats.turns += event.stats.turns;
          c.stats.lastDurationMs = event.stats.durationMs;
        }
        break;
      // block_start / text_delta / thinking_delta / block_stop / thinking / tool_result:
      // intentionally ignored — the finalized 'text' event carries the full message.
    }
    this.#scheduleWrite();
  }

  // Start a fresh conversation. The previous chat is flushed to disk first (retained).
  async newChat(): Promise<void> {
    this.#rebindIfNeeded();
    await this.flush();
    this.#current = this.#blank();
    this.#currentPromise = undefined;
  }

  // Load a past chat as current. Returns its resume info so the caller can decide whether to
  // resume the underlying CLI session (only valid when the backend matches). Sets a one-shot
  // note when the backend differs. Returns undefined if the chat can't be loaded.
  async open(id: string): Promise<{ cliSessionId?: string; backend: string; model?: string } | undefined> {
    this.#rebindIfNeeded();
    const root = this.#session.root;
    if (!root) return undefined;
    await this.flush();
    const chat = await this.#load(root, id);
    if (!chat) return undefined;
    this.#current = chat;
    this.#currentPromise = undefined;
    const backend = this.#backend();
    if (chat.backend !== backend) {
      this.#note = `Reopened under ${backend} — this chat ran on ${chat.backend}, so its earlier context isn't carried over. New messages start fresh.`;
    }
    return { cliSessionId: chat.cliSessionId, backend: chat.backend, model: chat.model };
  }

  async delete(id: string): Promise<{ wasCurrent: boolean }> {
    this.#rebindIfNeeded();
    const root = this.#session.root;
    const wasCurrent = this.#current?.id === id;
    if (root) { try { await rm(join(this.#dir(root), `${id}.json`)); } catch { /* already gone */ } }
    if (wasCurrent) { this.#current = this.#blank(); this.#currentPromise = undefined; }
    return { wasCurrent };
  }

  async historyPayload(): Promise<HistoryPayload> {
    const c = await this.#ensureCurrent();
    const chats = (await this.#allChats()).map(toMeta);
    const items = [...c.items];
    const note = this.#note;
    this.#note = undefined;
    if (note) items.push({ kind: 'error', text: note });
    return { chats, currentChatId: c.id, items, stats: c.stats, note };
  }

  async chatList(): Promise<{ chats: ChatMeta[]; currentChatId: string | undefined }> {
    const c = await this.#ensureCurrent();
    const chats = (await this.#allChats()).map(toMeta);
    return { chats, currentChatId: c.id };
  }

  async flush(): Promise<void> {
    if (this.#writeTimer) { clearTimeout(this.#writeTimer); this.#writeTimer = undefined; }
    await this.#persistNow();
    await this.#writeChain;
  }
}
