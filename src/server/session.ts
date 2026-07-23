import chokidar, { type FSWatcher } from 'chokidar';
import { readConfig, writeConfig, ensureBoards } from '../core/config.js';
import { buildSnapshot, type ProjectSnapshot } from './snapshot.js';
import type { ProjectConfig } from '../core/types.js';

export type SnapshotListener = (snapshot: ProjectSnapshot) => void;

const DEBOUNCE_MS = 80;

// chokidar v4 removed glob support in `ignored`; use a path predicate.
function isIgnored(p: string): boolean {
  return p.includes('/node_modules/') || p.includes('/.git/');
}

export class ProjectSession {
  #root: string | undefined;
  #config: ProjectConfig | undefined;
  #watcher: FSWatcher | undefined;
  #listeners = new Set<SnapshotListener>();
  #timer: ReturnType<typeof setTimeout> | undefined;

  get isOpen(): boolean { return this.#root !== undefined; }
  get root(): string | undefined { return this.#root; }
  get config(): ProjectConfig | undefined { return this.#config; }

  async open(projectRoot: string): Promise<ProjectSnapshot> {
    const config = await readConfig(projectRoot); // throws if not a VibeBoard project
    // Upgrade older projects created before a board existed: backfill missing boards.
    if (ensureBoards(config)) await writeConfig(projectRoot, config);
    this.#config = config;
    this.#root = projectRoot;
    await this.close(true);

    const watcher = chokidar.watch(projectRoot, {
      ignoreInitial: true,
      ignored: (p: string) => isIgnored(p),
    });
    watcher.on('all', () => this.#scheduleBroadcast());
    await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
    this.#watcher = watcher;
    return this.snapshot();
  }

  async close(keepState = false): Promise<void> {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = undefined; }
    if (this.#watcher) { await this.#watcher.close(); this.#watcher = undefined; }
    if (!keepState) { this.#root = undefined; this.#config = undefined; }
  }

  async snapshot(): Promise<ProjectSnapshot> {
    if (!this.#root) throw new Error('No project open');
    return buildSnapshot(this.#root);
  }

  subscribe(fn: SnapshotListener): () => void {
    this.#listeners.add(fn);
    return () => { this.#listeners.delete(fn); };
  }

  #scheduleBroadcast(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      void this.snapshot()
        .then((s) => { for (const fn of this.#listeners) fn(s); })
        .catch(() => { /* transient FS race; a later event will refresh */ });
    }, DEBOUNCE_MS);
  }
}
