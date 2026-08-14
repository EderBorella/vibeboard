import chokidar, { type FSWatcher } from 'chokidar';
import { AUTOPILOT_STATE_FILE, CHAT_DIR, PROJECT_LOG_FILE, RUNS_DIR } from '../../core/layout.js';
import type { ProjectConfig } from '../../core/types.js';
import {
  ensureAutopilotKeys,
  ensureBoards,
  ensureContextBudget,
  ensureCopilotDefaults,
  ensureMaxRuns,
  readConfig,
  writeConfig,
} from '../../store/project/config.js';
import { ensureControlFiles } from '../../store/project/control.js';
import { markInterrupted } from '../../store/run-store.js';
import type { Log } from '../logging.js';
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
    p.endsWith(`/${PROJECT_LOG_FILE}`) ||
    // Auto-pilot's counters change on every tick and nothing on the board depends on them. Watched,
    // this would rebuild the whole snapshot once per dispatch; state changes are pushed over the
    // websocket by whoever wrote them instead.
    p.endsWith(`/${AUTOPILOT_STATE_FILE}`)
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
      // Any autopilot key the project predates. Without it, adding a required key to that block stops
      // an existing project saving ANY setting, because the cover check runs on every patch that
      // touches `boards` and the modal always sends them.
      ensureAutopilotKeys(config),
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
    // A FILE THE SERVER CANNOT WATCH IS NOT A REASON TO EXIT, and without this listener it was one.
    // chokidar emits `error`, and an EventEmitter `error` with nothing listening throws — which
    // arrived as an unhandled rejection and took the whole process down, the auto-pilot loop with it.
    //
    // Found in a live run: an agent building the "error handling" feature wrote a fixture named
    // `temp-unreadable.txt` with mode 000, which is exactly the right way to test unreadable-file
    // handling. Watching it failed with EACCES and the server died mid-project. So ANY project
    // containing a file its own agents legitimately created could kill the server that dispatched
    // them, and nothing in the board or the config was wrong.
    //
    // Logged rather than swallowed: losing watch coverage of one path means the board may stop
    // updating live for it, which is worth a line. Everything else stays watched, and every read
    // path still goes to disk — the watcher only decides when to PUSH a snapshot, so the cost of
    // dropping one is a stale tab, not a wrong answer.
    watcher.on('error', (err) => {
      this.#log?.warn({ err }, 'a path could not be watched; the rest of the project still is');
    });
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
