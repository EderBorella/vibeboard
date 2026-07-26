import { type RunRecord, runId, withoutReport } from '../core/runs.js';
import type { Skill } from '../core/skills.js';
import type { BoardName, Card } from '../core/types.js';
import { type Backend, type RunningTurn, runAgentTurn } from './agent-turn.js';
import { buildRunPrompt } from './run-prompt.js';
import { appendTranscript, foldReport, reportContract, transcriptTail, writeRun } from './run-store.js';

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
  cardFile: string;
  linked: Card[];
  attachments: string[];
  links: { title: string; url: string }[];
  previous?: RunRecord;
  userPrompt?: string;
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
  // Called whenever a record changes on disk, so the WS layer can push it without polling.
  onUpdate?: (record: RunRecord) => void;
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

export class AgentRunner {
  #opts: RunnerOptions;
  #active = new Map<string, Active>();
  #queue: Queued[] = [];

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
    const prompt = buildRunPrompt({
      skill: input.skill,
      card: input.card,
      cardFile: input.cardFile,
      linked: input.linked,
      attachments: input.attachments,
      links: input.links,
      previousReport: input.previous?.report,
      userPrompt: input.userPrompt,
      reportPath: reportContract(run),
      projectRoot: root,
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
      onEvent: (event) => {
        void appendTranscript(root, run, JSON.stringify(event)).catch(() => {
          /* a lost transcript line must never fail the run */
        });
      },
    });
    this.#active.set(run, { turn, cancelled: false });

    // Not awaited: the caller was answered when the record was written, and the ending arrives
    // through onUpdate. Errors are folded into the record rather than thrown into nowhere.
    void this.#settle(root, run, record, turn);
  }

  // A slot freed. Take the oldest waiting run, mark it running on disk, and spawn it.
  #drain(): void {
    while (!this.isBusy()) {
      const next = this.#queue.shift();
      if (!next) return;
      const running: RunRecord = { ...next.record, status: 'running' };
      void writeRun(next.root, running)
        .then(() => this.#opts.onUpdate?.(running))
        .catch(() => {
          /* the record is already on disk as queued; the run still starts */
        });
      this.#start(next.root, running, next.input);
    }
  }

  async #settle(root: string, run: string, record: RunRecord, turn: RunningTurn): Promise<void> {
    let final: RunRecord;
    try {
      const result = await turn.done;
      const cancelled = this.#active.get(run)?.cancelled === true;
      const finishedAt = this.#opts.now().toISOString();
      const folded = await foldReport(root, record, finishedAt);
      final = folded ?? (await this.#endWithoutReport(root, record, result, cancelled, finishedAt));
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
