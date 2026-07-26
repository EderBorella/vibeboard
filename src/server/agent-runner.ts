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
// The cap is a constructor argument rather than config: this phase runs one at a time, and the
// queue that makes a larger cap useful belongs with the dashboard that shows it.

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
  root: string;
  // Injected so a test can pin both. Nothing here reads the clock or the RNG directly.
  now: () => Date;
  suffix: () => string;
  timeoutMs: number;
  maxConcurrent?: number;
  // Called whenever a record changes on disk, so the WS layer can push it without polling.
  onUpdate?: (record: RunRecord) => void;
}

interface Active {
  turn: RunningTurn;
  cancelled: boolean;
}

export class AgentRunner {
  #opts: RunnerOptions;
  #active = new Map<string, Active>();

  constructor(opts: RunnerOptions) {
    this.#opts = opts;
  }

  get activeIds(): string[] {
    return [...this.#active.keys()];
  }

  isBusy(): boolean {
    return this.#active.size >= (this.#opts.maxConcurrent ?? 1);
  }

  // Stop a run. The record becomes `cancelled` on the turn's own completion path, not here — the
  // child has to actually die before the run is over, and pretending otherwise would leave a
  // finished record with a live process behind it.
  cancel(run: string): boolean {
    const active = this.#active.get(run);
    if (!active) return false;
    active.cancelled = true;
    active.turn.cancel();
    return true;
  }

  // Start a run. Returns the record as written at dispatch (status `running`), so the caller can
  // answer immediately; the outcome lands later through onUpdate.
  async dispatch(input: DispatchInput): Promise<RunRecord> {
    if (this.isBusy()) throw new Error('A run is already in flight');
    const { root, now, suffix } = this.#opts;
    const startedAt = now();
    const run = runId(startedAt, suffix());

    const record: RunRecord = {
      run,
      card: input.card.id,
      board: input.card.board as BoardName,
      skill: input.skill.slug,
      status: 'running',
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
      onEvent: (event) => {
        void appendTranscript(root, run, JSON.stringify(event)).catch(() => {
          /* a lost transcript line must never fail the run */
        });
      },
    });
    this.#active.set(run, { turn, cancelled: false });

    // Not awaited: dispatch answers as soon as the record exists, and the ending arrives through
    // onUpdate. Errors are folded into the record rather than thrown into nowhere.
    void this.#settle(run, record, turn);
    return record;
  }

  async #settle(run: string, record: RunRecord, turn: RunningTurn): Promise<void> {
    const { root } = this.#opts;
    let final: RunRecord;
    try {
      const result = await turn.done;
      const cancelled = this.#active.get(run)?.cancelled === true;
      const finishedAt = this.#opts.now().toISOString();
      const folded = await foldReport(root, record, finishedAt);
      final = folded ?? (await this.#endWithoutReport(record, result, cancelled, finishedAt));
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
  }

  // No report file. Which of the four endings it was decides the status, and the note is what the
  // UI shows in place of a report — with the transcript tail, so "it did nothing" is checkable.
  async #endWithoutReport(
    record: RunRecord,
    result: { exitCode: number | null; timedOut: boolean },
    cancelled: boolean,
    finishedAt: string,
  ): Promise<RunRecord> {
    const { root, timeoutMs } = this.#opts;
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
