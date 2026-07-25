import chokidar, { type FSWatcher } from 'chokidar';
import {
  readConfig,
  writeConfig,
  ensureBoards,
  ensureCopilotDefaults,
  ensureContextBudget,
} from '../core/config.js';
import { ensureControlFiles } from '../core/control.js';
import { buildSnapshot, type ProjectSnapshot } from './snapshot.js';
import type { ProjectConfig } from '../core/types.js';

type SnapshotListener = (snapshot: ProjectSnapshot) => void;

const DEBOUNCE_MS = 80;

// chokidar v4 removed glob support in `ignored`; use a path predicate. Ignore only the chat
// store (`.vibeboard/chat/`) — its frequent writes must not churn the board. `config.yaml`
// (also under .vibeboard) IS watched, so config edits still push a fresh snapshot.
function isIgnored(p: string): boolean {
  return p.includes('/node_modules/') || p.includes('/.git/') || p.includes('/.vibeboard/chat');
}

export class ProjectSession {
  #root: string | undefined;
  #config: ProjectConfig | undefined;
  #watcher: FSWatcher | undefined;
  #listeners = new Set<SnapshotListener>();
  #timer: ReturnType<typeof setTimeout> | undefined;

  get isOpen(): boolean {
    return this.#root !== undefined;
  }
  get root(): string | undefined {
    return this.#root;
  }
  get config(): ProjectConfig | undefined {
    return this.#config;
  }

  async open(projectRoot: string): Promise<ProjectSnapshot> {
    const config = await readConfig(projectRoot); // throws if not a VibeBoard project
    // Upgrade older projects: backfill missing boards, and a real copilot model/effort for
    // configs written when those could be blank.
    const upgraded = [ensureBoards(config), ensureCopilotDefaults(config), ensureContextBudget(config)].some(
      Boolean,
    );
    if (upgraded) await writeConfig(projectRoot, config);
    // Backfill INSTRUCTIONS.md + CLI pointer imports for projects created before Project Control.
    await ensureControlFiles(projectRoot);
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
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    if (this.#watcher) {
      await this.#watcher.close();
      this.#watcher = undefined;
    }
    if (!keepState) {
      this.#root = undefined;
      this.#config = undefined;
    }
  }

  async snapshot(): Promise<ProjectSnapshot> {
    if (!this.#root) throw new Error('No project open');
    return buildSnapshot(this.#root);
  }

  // Re-read config from disk into the live session (after a config write via the API).
  async reloadConfig(): Promise<void> {
    if (this.#root) this.#config = await readConfig(this.#root);
  }

  subscribe(fn: SnapshotListener): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  #scheduleBroadcast(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      void this.snapshot()
        .then((s) => {
          for (const fn of this.#listeners) fn(s);
        })
        .catch(() => {
          /* transient FS race; a later event will refresh */
        });
    }, DEBOUNCE_MS);
  }
}
