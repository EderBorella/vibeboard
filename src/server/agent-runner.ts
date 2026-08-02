import {
  type RunRecord,
  type RunUsage,
  runId,
  withoutReport,
  withSuggestions,
  withUsage,
} from '../core/runs.js';
import type { Skill } from '../core/skills.js';
import type { BoardName, Card } from '../core/types.js';
import { type Backend, type RunningTurn, runAgentTurn } from './agent-turn.js';
import type { ResultStats } from './copilot-events.js';
import type { Credential, CredentialStore } from './credentials.js';
import type { Log } from './logging.js';
import { type BoardColumns, buildRunPrompt } from './run-prompt.js';
import { appendTranscript, foldReport, reportContract, transcriptTail, writeRun } from './run-store.js';
import type { SandboxStatus } from './sandbox.js';
import { countRunSuggestions } from './suggestion-store.js';

// Runs skills as agents.
//
// Deliberately NOT the chat copilot: no session is resumed, no chat is written, and several runs
// can be in flight. What a run produces is a file (the report), so this class's whole job is to
// start a turn, keep the record honest while it runs, and decide what the ending means.
//
// Past the cap a dispatch QUEUES rather than being refused: a run is minutes of work, so "busy, try
// again" would be the wrong answer. The queue lives in memory only — a restart kills the processes
// anyway, and markInterrupted ends the records that were waiting.

export interface DispatchInput {
  skill: Skill;
  card: Card;
  // Carried, not derived: the runner reads no config, and the columns must be the ones the project
  // had when the dispatch was resolved — a queued run may start after they were renamed.
  boardColumns: BoardColumns[];
  cardFile: string;
  linked: Card[];
  attachments: string[];
  links: { title: string; url: string }[];
  previous?: RunRecord;
  userPrompt?: string;
  // Read at dispatch, like boardColumns and for the same reason: a queued run must be bound by the
  // documents the project had when it was resolved, not by whatever they say when it finally starts.
  foundation?: { paths: string[]; codeQuality?: string };
  backend: Backend;
  model: string;
  effort: string;
  mode: string;
}

export interface RunnerOptions {
  // A function, not a string: the open project can change, and a run must finish inside the project
  // it started in. Resolved once per dispatch and carried through, never re-read at completion.
  root: () => string;
  // Injected so a test can pin both. Nothing here reads the clock or the RNG directly.
  now: () => Date;
  suffix: () => string;
  timeoutMs: number;
  // How many may run at once. A function, because it comes from the open project's config and the
  // open project changes.
  maxConcurrent: () => number;
  // Overrides the executable a run spawns. Tests pass their shim here rather than through the
  // environment, which is shared with every other test file in the process.
  bin?: string;
  // Confines every run this runner dispatches. Absent means unconfined, which is what a test about
  // something else wants; the composition root passes the probe's answer.
  sandbox?: SandboxStatus;
  // Mints each run a credential when it starts and revokes it when it settles. Optional: a runner
  // without one spawns agents that are told nothing about the API, which is what every test that is
  // about something else wants — and `work` is the only scope a run ever gets, so there is nothing
  // to configure here.
  credentials?: CredentialStore;
  // Where the agent should send that credential. A function because the port is known to whoever
  // started the server, not to whoever built the runner.
  apiBase?: () => string;
  // Called whenever a record changes on disk, so the WS layer can push it without polling.
  onUpdate?: (record: RunRecord) => void;
  // A run outlives the request that dispatched it, so there is no request logger to reach for when
  // one of its background writes fails. Optional: a runner without one behaves exactly as before.
  log?: Log;
}

interface Active {
  turn: RunningTurn;
  cancelled: boolean;
}

// A dispatch that arrived while every slot was taken. Held in memory only: a queued record is on
// disk too, but a restart kills the processes anyway, so a queue that survived would promise work
// nothing is going to do — markInterrupted ends those records instead.
interface Queued {
  record: RunRecord;
  root: string;
  input: DispatchInput;
}

// The turn's stats as the record keeps them: `ok` and `text` belong to the turn, not to the ledger,
// and the numbers are copied verbatim — a zero cost is what a free model really cost, not a gap.
function usageFromStats(stats: ResultStats | undefined): RunUsage | undefined {
  if (!stats) return undefined;
  return {
    costUsd: stats.costUsd,
    durationMs: stats.durationMs,
    // Left out of the record entirely when the backend reported none — RunUsage treats absence and
    // zero as different facts, and a `turns:` key with nothing behind it is neither.
    ...(stats.turns !== undefined ? { turns: stats.turns } : {}),
    contextTokens: stats.contextTokens,
    outputTokens: stats.outputTokens,
  };
}

// Transcripts live under `.vibeboard/` where every agent can read them, and a run's credential is
// only its own while it stays out of them. An agent that echoes the token — quoting the prompt back,
// pasting a failed curl — would otherwise hand a concurrent run a working key.
const redact = (line: string, token?: string): string =>
  token ? line.replaceAll(token, '[credential redacted]') : line;

export class AgentRunner {
  #opts: RunnerOptions;
  #active = new Map<string, Active>();
  #queue: Queued[] = [];
  // One append chain per run, so its transcript lines are written in order and can be waited for.
  #transcripts = new Map<string, Promise<void>>();

  constructor(opts: RunnerOptions) {
    this.#opts = opts;
  }

  get activeIds(): string[] {
    return [...this.#active.keys()];
  }

  get queuedIds(): string[] {
    return this.#queue.map((q) => q.record.run);
  }

  isBusy(): boolean {
    return this.#active.size >= this.#opts.maxConcurrent();
  }

  // Stop a run, whether it is running or still waiting. A running one becomes `cancelled` on the
  // turn's own completion path, not here — the child has to actually die before the run is over, and
  // pretending otherwise would leave a finished record with a live process behind it. A queued one
  // has no process, so it ends immediately.
  // Every run, for shutdown. A spawned agent does NOT die with the server that started it — it is an
  // ordinary child process, and on the way out we are the only thing that will stop it. Left
  // running it keeps working, and keeps spending, against a board nobody is watching.
  //
  // Synchronous on purpose: this is called from a signal handler and from `process.once('exit')`,
  // where nothing asynchronous gets a turn. Killing the child is the part that must happen; the
  // record it settles into is a bonus we may not live long enough to write.
  cancelAll(): number {
    const ids = [...this.#active.keys(), ...this.#queue.map((q) => q.record.run)];
    for (const id of ids) this.cancel(id);
    return ids.length;
  }

  cancel(run: string): boolean {
    const active = this.#active.get(run);
    if (active) {
      active.cancelled = true;
      active.turn.cancel();
      return true;
    }
    const waiting = this.#queue.find((q) => q.record.run === run);
    if (!waiting) return false;
    this.#queue = this.#queue.filter((q) => q.record.run !== run);
    void this.#endQueued(waiting);
    return true;
  }

  async #endQueued(waiting: Queued): Promise<void> {
    const final = withoutReport(
      waiting.record,
      'cancelled',
      'You stopped this run before it started.',
      this.#opts.now().toISOString(),
    );
    await writeRun(waiting.root, final);
    this.#opts.onUpdate?.(final);
  }

  // Start a run, or queue it when every slot is taken. Returns the record as written at dispatch, so
  // the caller can answer immediately; the outcome lands later through onUpdate.
  async dispatch(input: DispatchInput): Promise<RunRecord> {
    const { now, suffix } = this.#opts;
    const root = this.#opts.root();
    const startedAt = now();
    const run = runId(startedAt, suffix());

    const record: RunRecord = {
      run,
      card: input.card.id,
      board: input.card.board as BoardName,
      skill: input.skill.slug,
      status: this.isBusy() ? 'queued' : 'running',
      started: startedAt.toISOString(),
      backend: input.backend,
      model: input.model,
      effort: input.effort,
      mode: input.mode,
      ...(input.previous ? { previous: input.previous.run } : {}),
      ...(input.userPrompt?.trim() ? { prompt: input.userPrompt.trim() } : {}),
      ...(input.attachments.length > 0 ? { attached: input.attachments } : {}),
      report: '',
    };
    await writeRun(root, record);
    this.#opts.onUpdate?.(record);

    if (record.status === 'queued') {
      this.#queue.push({ record, root, input });
      return record;
    }
    this.#start(root, record, input);
    return record;
  }

  // Spawn the turn for a record already on disk. Separate from dispatch because a queued run reaches
  // this later, with the same record it was written with.
  #start(root: string, record: RunRecord, input: DispatchInput): void {
    const run = record.run;
    // Minted here rather than in dispatch, so a queued run's credential begins its life when the
    // run actually starts. `work`, confined to its own card: a run that could move cards could put
    // its own into done and declare itself finished.
    const minted = this.#opts.credentials?.mintRun('work', run, root, record.card);
    // Everything from here to the handover to #settle is inside the try: once a credential exists,
    // the only thing that revokes it is #settle's `finally`, so a throw on the way there would
    // leave a working key alive for the life of the process with no run behind it.
    try {
      this.#spawn(root, record, input, minted);
    } catch (err) {
      this.#opts.credentials?.expireRun(run);
      throw err;
    }
  }

  #spawn(root: string, record: RunRecord, input: DispatchInput, minted: Credential | undefined): void {
    const run = record.run;
    const credential = minted ? { token: minted.token, apiBase: this.#opts.apiBase?.() ?? '' } : undefined;
    const prompt = buildRunPrompt({
      skill: input.skill,
      card: input.card,
      boardColumns: input.boardColumns,
      cardFile: input.cardFile,
      linked: input.linked,
      attachments: input.attachments,
      links: input.links,
      previousReport: input.previous?.report,
      userPrompt: input.userPrompt,
      foundation: input.foundation,
      reportPath: reportContract(run),
      projectRoot: root,
      credential,
    });

    const turn = runAgentTurn({
      cwd: root,
      text: prompt,
      mode: input.mode,
      backend: input.backend,
      model: input.model,
      effort: input.effort,
      timeoutMs: this.#opts.timeoutMs,
      bin: this.#opts.bin,
      sandbox: this.#opts.sandbox,
      onEvent: (event) => {
        // Chained, not fired and forgotten. Two reasons, both real: concurrent appends of one line
        // each can interleave mid-line, and #settle reads the tail as soon as the process closes —
        // so an unawaited write lands AFTER the read and the line is missing from the report. That
        // matters most in the case the tail exists for, an agent that finished having said nothing.
        this.#transcripts.set(
          run,
          (this.#transcripts.get(run) ?? Promise.resolve())
            .then(() => appendTranscript(root, run, redact(JSON.stringify(event), minted?.token)))
            // A lost transcript line must never fail the run — but the transcript is the fallback
            // the report is built from when the agent writes none, so a gap in it explains an
            // otherwise inexplicable empty report.
            .catch((err) => this.#opts.log?.warn({ err, run }, 'transcript append failed')),
        );
      },
    });
    this.#active.set(run, { turn, cancelled: false });

    // Not awaited: the caller was answered when the record was written, and the ending arrives
    // through onUpdate. Errors are folded into the record rather than thrown into nowhere.
    void this.#settle(root, run, record, turn, minted?.token);
  }

  // A slot freed. Take the oldest waiting run, mark it running on disk, and spawn it.
  #drain(): void {
    while (!this.isBusy()) {
      const next = this.#queue.shift();
      if (!next) return;
      const running: RunRecord = { ...next.record, status: 'running' };
      void writeRun(next.root, running)
        .then(() => this.#opts.onUpdate?.(running))
        // The record is already on disk as queued and the run still starts, so this is survivable —
        // but it leaves a running run displayed as queued, which looks like a stuck queue.
        .catch((err) => this.#opts.log?.warn({ err, run: running.run }, 'queued run write failed'));
      this.#start(next.root, running, next.input);
    }
  }

  // How many suggestions this run filed, from the STORE. The agent's report is not asked: a run
  // that finds seventeen things and reports three is exactly the case the count exists to surface.
  //
  // A failure here must not fail the run — the number is a diagnostic, the report is the outcome —
  // but it returns `undefined` rather than 0, so the record says "not counted" instead of claiming
  // the run found nothing.
  async #filed(root: string, run: string): Promise<number | undefined> {
    try {
      return await countRunSuggestions(root, run);
    } catch (err) {
      this.#opts.log?.warn({ err, run }, 'could not count the suggestions this run filed');
      return undefined;
    }
  }

  async #settle(
    root: string,
    run: string,
    record: RunRecord,
    turn: RunningTurn,
    secret?: string,
  ): Promise<void> {
    let final: RunRecord;
    try {
      const result = await turn.done;
      const cancelled = this.#active.get(run)?.cancelled === true;
      const finishedAt = this.#opts.now().toISOString();
      // Every transcript line on disk before anything reads the tail.
      await this.#transcripts.get(run);
      // Attached here, once, so BOTH endings carry it: a run that failed or was cancelled still
      // spent tokens, and that is exactly when you want to know how many.
      const spent = withSuggestions(
        withUsage(record, usageFromStats(result.stats)),
        await this.#filed(root, run),
      );
      const folded = await foldReport(root, spent, finishedAt, secret);
      final = folded ?? (await this.#endWithoutReport(root, spent, result, cancelled, finishedAt));
    } catch (err) {
      final = withoutReport(
        record,
        'failed',
        `The run could not be completed: ${err instanceof Error ? err.message : String(err)}`,
        this.#opts.now().toISOString(),
      );
      await writeRun(root, final);
    } finally {
      this.#active.delete(run);
      this.#transcripts.delete(run);
      // In the `finally`, so every ending revokes it — success, failure, cancellation and timeout
      // alike. A credential that outlived one of them would be a live key to the board held by a
      // process nothing is watching any more.
      this.#opts.credentials?.expireRun(run);
    }
    this.#opts.onUpdate?.(final);
    // A slot just freed, so whatever was waiting starts now. After the update, so the dashboard sees
    // this run end before the next one begins.
    this.#drain();
  }

  // No report file. Which of the four endings it was decides the status, and the note is what the
  // UI shows in place of a report — with the transcript tail, so "it did nothing" is checkable.
  async #endWithoutReport(
    root: string,
    record: RunRecord,
    result: { exitCode: number | null; timedOut: boolean },
    cancelled: boolean,
    finishedAt: string,
  ): Promise<RunRecord> {
    const { timeoutMs } = this.#opts;
    const tail = await transcriptTail(root, record.run);
    let status: RunRecord['status'] = 'attention';
    let note = 'The agent finished without writing a report.';
    if (cancelled) {
      status = 'cancelled';
      note = 'You stopped this run.';
    } else if (result.timedOut) {
      status = 'failed';
      note = `The agent was still running after ${Math.round(timeoutMs / 1000)}s and was stopped.`;
    } else if (result.exitCode !== 0) {
      status = 'failed';
      note = `The agent exited with code ${result.exitCode ?? 'unknown'} and wrote no report.`;
    }
    const final = withoutReport(record, status, note, finishedAt, tail);
    await writeRun(root, final);
    return final;
  }
}
