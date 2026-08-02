import chokidar, { type FSWatcher } from 'chokidar';
import {
  ensureBoards,
  ensureContextBudget,
  ensureCopilotDefaults,
  ensureMaxRuns,
  readConfig,
  writeConfig,
} from '../core/config.js';
import { ensureControlFiles } from '../core/control.js';
import { CHAT_DIR, PROJECT_LOG_FILE, RUNS_DIR } from '../core/layout.js';
import type { ProjectConfig } from '../core/types.js';
import type { Log } from './logging.js';
import { markInterrupted } from './run-store.js';
import { buildSnapshot, type ProjectSnapshot } from './snapshot.js';

type SnapshotListener = (snapshot: ProjectSnapshot) => void;

const DEBOUNCE_MS = 80;

// chokidar v4 removed glob support in `ignored`; use a path predicate. Ignore the chat store and
// the run scratch area — both are written constantly while a turn streams, and neither changes the
// board. Everything else inside the config folder IS watched: the cards live there, so ignoring the
// folder wholesale would stop the board updating live, and `config.yaml` edits still push a fresh
// snapshot. A run's *record* lives in a board folder and is deliberately NOT ignored: writing one
// should refresh the card's reports.
// Exported for its own test: driving it through a real watcher is slow and racy, and the
// path list is exactly the kind of thing that rots silently.
export function isIgnored(p: string): boolean {
  return (
    p.includes('/node_modules/') ||
    p.includes('/.git/') ||
    p.includes(`/${CHAT_DIR}`) ||
    p.includes(`/${RUNS_DIR}`) ||
    // The diary changes nothing on the board, and it is appended through an endpoint — which can
    // broadcast the new line itself. Watching it would rebuild the whole snapshot once per line.
    p.endsWith(`/${PROJECT_LOG_FILE}`)
  );
}

export class ProjectSession {
  #root: string | undefined;
  #config: ProjectConfig | undefined;
  #watcher: FSWatcher | undefined;
  #listeners = new Set<SnapshotListener>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #log: Log | undefined;

  get isOpen(): boolean {
    return this.#root !== undefined;
  }
  get root(): string | undefined {
    return this.#root;
  }
  get config(): ProjectConfig | undefined {
    return this.#config;
  }

  // `liveRuns` is what the runner still has in flight. Passed in rather than reached for: the
  // session is constructed before the runner and knows nothing about it.
  async open(projectRoot: string, liveRuns: string[] = []): Promise<ProjectSnapshot> {
    const config = await readConfig(projectRoot); // throws if not a VibeBoard project
    // Upgrade older projects: backfill missing boards, and a real copilot model/effort for
    // configs written when those could be blank.
    const upgraded = [
      ensureBoards(config),
      ensureCopilotDefaults(config),
      ensureContextBudget(config),
      ensureMaxRuns(config),
    ].some(Boolean);
    if (upgraded) await writeConfig(projectRoot, config);
    // Backfill the instructions document + CLI pointer imports for projects created before
    // Project Control.
    await ensureControlFiles(projectRoot);
    this.#config = config;
    this.#root = projectRoot;
    // Any run still claiming to be in flight belongs to a previous process — its child died with the
    // server that spawned it — UNLESS this process is still running it. Reopening the project you
    // already have open is an ordinary thing to do from the picker, and it must not rewrite a live
    // run to `interrupted`. Done here rather than at each caller so both paths — opening a project
    // and reopening the last one on boot — are covered by one call.
    await markInterrupted(projectRoot, new Date().toISOString(), liveRuns);
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

  // Set by buildApp: a session is constructed before the app that logs for it, and everything below
  // runs from a watcher event rather than a request, so there is no other way in.
  attachLogger(log: Log): void {
    this.#log = log;
  }

  #scheduleBroadcast(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      void this.snapshot()
        .then((s) => {
          for (const fn of this.#listeners) fn(s);
        })
        // A transient FS race and a real problem look identical from here, and a later event will
        // refresh either way — so this stays non-fatal, but it stops being invisible. When the
        // boards have quietly stopped updating, this is the line that says why.
        .catch((err) => this.#log?.warn({ err }, 'snapshot broadcast failed'));
    }, DEBOUNCE_MS);
  }
}
