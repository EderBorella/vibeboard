import { HALTED_DISPATCH } from '../core/dispatch-gate.js';
import {
  parseAgentReport,
  type RunRecord,
  type RunUsage,
  runId,
  withFilesChanged,
  withoutReport,
  withSuggestions,
  withUsage,
} from '../core/runs.js';
import type { Skill } from '../core/skills.js';
import type { BoardName, Card } from '../core/types.js';
import { type Backend, type RunningTurn, runAgentTurn } from './agent-turn.js';
import type { BoxService } from './box-service.js';
import type { ResultStats } from './copilot-events.js';
import type { Credential, CredentialStore } from './credentials.js';
import { errorText } from './errors.js';
import type { GitMeasure, GitPoint } from './git-measure.js';
import type { Log } from './logging.js';
import { redact } from './redaction.js';
import { type BoardColumns, buildRunPrompt, type PromptInputs } from './run-prompt.js';
import {
  appendTranscript,
  foldReport,
  reportContract,
  takeAgentReport,
  transcriptTail,
  writeRun,
} from './run-store.js';
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
  // The card this run is about, and its file. ABSENT for a PROJECT run: the bootstrap derives the board from
  // the README and so has no card, which is the whole reason it exists (the `bootstrap` row of core/phases.ts).
  // Both or neither, like the record's own `card`/`board` pair and for the same reason.
  card?: Card;
  // Carried, not derived: the runner reads no config, and the columns must be the ones the project
  // had when the dispatch was resolved — a queued run may start after they were renamed.
  boardColumns: BoardColumns[];
  cardFile?: string;
  linked: Card[];
  attachments: string[];
  links: { title: string; url: string }[];
  previous?: RunRecord;
  userPrompt?: string;
  // Read at dispatch, like boardColumns and for the same reason: a queued run must be bound by the
  // documents the project had when it was resolved, not by whatever they say when it finally starts.
  foundation?: { paths: string[]; codeQuality?: string };
  // Present when this run is a REVIEW: what the loop already established before dispatching it. Carried like
  // `foundation`, and for the same reason — a queued review must be told about the gate run that preceded it,
  // not about whatever the tree looks like when it finally starts.
  review?: { gatesPassed: boolean; setupSubtree: boolean };
  // Present when this run is a CHECKUP: everything the loop gathered about what is under its card (ruling 60).
  // Carried like `foundation` and for the same reason — a queued checkup must be told about the board and the
  // smoke run that preceded its dispatch, not about whatever they look like when it finally starts.
  checkup?: PromptInputs['checkup'];
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
  // A function, like maxConcurrent and for the same reason: it comes from the open project's
  // config (autopilot.runTimeoutMs), and changing it in Settings must take effect on the next
  // dispatch rather than at the next restart. Decision 8 — the enforceable per-run bound is
  // wall-clock, because usage is only known after a run has finished spending it.
  timeoutMs: () => number;
  // How many may run at once. A function, because it comes from the open project's config and the
  // open project changes.
  maxConcurrent: () => number;
  // Overrides the executable a run spawns. Tests pass their shim here rather than through the
  // environment, which is shared with every other test file in the process.
  bin?: string;
  // Confines every run this runner dispatches. Absent means unconfined, which is what a test about
  // something else wants; the composition root passes the probe's answer.
  sandbox?: SandboxStatus;
  // Where a run actually executes. Resolved per dispatch rather than held, because the box belongs to
  // the PROJECT and the open project changes — and because a box can be removed underneath us by a
  // prune or an image rebuild, so the answer has to be asked for again each time.
  boxes?: BoxService;
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
  // How files-changed is measured (S11). Injected so a test about something else neither needs git nor
  // pays for it: without one the field is simply absent, which is exactly what it means when there is
  // no repository to ask.
  git?: GitMeasure;
  // Whether the open project is halted. Checked HERE, on the far side of every await the route layer
  // does, because the route's own check cannot close the window: `resolveDispatch` reads a card, the
  // skills, the board three times and two foundation documents between the lock and the dispatch, and
  // a kill landing in that gap left the run to start 3ms after the project was recorded halted and run
  // to `success` — reproduced 4 times out of 4. One synchronous check at the moment of spawning is the
  // only place that gap does not exist.
  halted?: () => boolean;
  // A run outlives the request that dispatched it, so there is no request logger to reach for when
  // one of its background writes fails. Optional: a runner without one behaves exactly as before.
  log?: Log;
}

interface Active {
  turn: RunningTurn;
  cancelled: boolean;
  // Resolved once, when the turn was spawned. Re-reading it at settle would let the sentence
  // "still running after Ns" quote a limit this run was never held to, because Settings may have
  // changed while it ran.
  timeoutMs: number;
  // The working tree as it was when this run started. A PROMISE rather than a value: the point is
  // taken when the turn is spawned, which is a synchronous path, and a run can finish before git has
  // answered. Awaited at settle, so there is no race to lose.
  gitAt: Promise<GitPoint | undefined>;
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

// The previous run as the prompt needs it: the whole record narrowed, not just its report. A run that FAILED
// has no report, and that is exactly the run a judge must be able to see (see run-prompt.ts) — so how it ended
// and what VibeBoard noted about it travel with it.
function narrowPrevious(previous: RunRecord): NonNullable<Parameters<typeof buildRunPrompt>[0]['previous']> {
  return {
    run: previous.run,
    skill: previous.skill,
    status: previous.status,
    ...(previous.report ? { report: previous.report } : {}),
    ...(previous.note ? { note: previous.note } : {}),
    ...(previous.filesChanged === undefined ? {} : { filesChanged: previous.filesChanged }),
    // WHAT WAS DECIDED ABOUT IT. Already on the record, written by the verdict path — and it is the whole
    // input to a `fix` run, which is otherwise told its card came back and not why.
    ...(previous.verification ? { verification: previous.verification } : {}),
  };
}

export class AgentRunner {
  #opts: RunnerOptions;
  #active = new Map<string, Active>();
  // Runs whose start is in flight — see `isBusy`.
  #starting = new Set<string>();
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

  // A slot is held from the moment a start BEGINS, not from when the turn is finally registered.
  //
  // `#starting` exists because `#start` became async: it now awaits a docker round trip before
  // reaching `#active.set`, so every call returns a pending promise while `#active` is still empty.
  // `#drain`'s `while (!isBusy())` therefore never saw the count rise and emptied the whole queue in
  // one burst, spawning every waiting run at once against a cap of one. Found in review 2026-08-09;
  // this was a regression from the containment change, not a pre-existing bug.
  isBusy(): boolean {
    return this.#active.size + this.#starting.size >= this.#opts.maxConcurrent();
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
    // Before the record exists, so a refused dispatch leaves nothing behind on disk to explain.
    if (this.#opts.halted?.()) throw new Error(HALTED_DISPATCH);
    const { now, suffix } = this.#opts;
    const root = this.#opts.root();
    const startedAt = now();
    const run = runId(startedAt, suffix());

    const record: RunRecord = {
      run,
      // BOTH OR NEITHER (see RunRecord.card): `card` alone cannot say which board's results folder holds the
      // record, and `board` alone names a folder with no card in it. A project run has neither, and that is
      // what routes it to the project store rather than beside a card.
      ...(input.card ? { card: input.card.id, board: input.card.board as BoardName } : {}),
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
    // The record already says `running` on disk and has been broadcast, so a throw here must not
    // simply propagate: it would leave a run the board shows as in progress with no process behind
    // it, for ever, since `#active` was never populated and nothing will settle it. The queued path
    // got `#failToStart` when it was written; this one needs it for the same reason.
    try {
      await this.#start(root, record, input);
    } catch (err) {
      await this.#failToStart(root, record, err);
      throw err;
    }
    return record;
  }

  // Spawn the turn for a record already on disk. Separate from dispatch because a queued run reaches
  // this later, with the same record it was written with.
  // `announce` marks a run arriving from the QUEUE: its record is still `queued` on disk, so the write
  // in #spawn is what makes it `running`, and that write is the one the dashboard needs to hear about.
  async #start(root: string, record: RunRecord, input: DispatchInput, announce = false): Promise<void> {
    const run = record.run;
    // Added SYNCHRONOUSLY, before the first await, or the reservation is worthless — that is the
    // whole point of it. Released in the `finally` below, by which time either `#active` holds the
    // run or it failed and never will.
    this.#starting.add(run);
    // Minted here rather than in dispatch, so a queued run's credential begins its life when the
    // run actually starts. `work`, confined to its own card: a run that could move cards could put
    // its own into done and declare itself finished.
    // The board and skill go on the credential so the card endpoint can refuse a run creating work for
    // itself — see `wrongColumnForRun` in routes/cards.ts.
    //
    // THE SKILL IS ALWAYS CARRIED; the board only when there is one. A PROJECT run has no card and no board,
    // and a credential claiming one would be a fact invented here — but it does have a skill, and that is
    // what the refusal compares: the bootstrap derives features, so a feature it created in the column that
    // dispatches `derive-features` would be sent straight back through the phase that made it. That loop is
    // the reason the rule exists, and a card-less run is the one caller most able to walk into it.
    const minted = this.#opts.credentials?.mintRun('work', run, root, record.card, {
      ...(record.board ? { board: record.board } : {}),
      skill: record.skill,
    });
    // Everything from here to the handover to #settle is inside the try: once a credential exists,
    // the only thing that revokes it is #settle's `finally`, so a throw on the way there would
    // leave a working key alive for the life of the process with no run behind it.
    try {
      await this.#spawn(root, record, input, minted, announce);
    } catch (err) {
      this.#opts.credentials?.expireRun(run);
      throw err;
    } finally {
      this.#starting.delete(run);
    }
  }

  async #spawn(
    root: string,
    record: RunRecord,
    input: DispatchInput,
    minted: Credential | undefined,
    announce = false,
  ): Promise<void> {
    const run = record.run;
    const credential = minted
      ? { token: minted.token, apiBase: this.#opts.apiBase?.() ?? '', scope: minted.scope }
      : undefined;
    const prompt = buildRunPrompt({
      skill: input.skill,
      // Both or neither, spread rather than passed: `exactOptionalPropertyTypes` refuses an explicit
      // `undefined` here, and the prompt decides which subject section to render on the card's presence.
      ...(input.card ? { card: input.card, cardFile: input.cardFile ?? '' } : {}),
      boardColumns: input.boardColumns,
      linked: input.linked,
      attachments: input.attachments,
      links: input.links,
      ...(input.previous ? { previous: narrowPrevious(input.previous) } : {}),
      userPrompt: input.userPrompt,
      foundation: input.foundation,
      review: input.review,
      checkup: input.checkup,
      reportPath: reportContract(run),
      projectRoot: root,
      credential,
    });

    const timeoutMs = this.#opts.timeoutMs();
    const box = await this.#boxFor(root, input.backend);
    const turn = runAgentTurn({
      cwd: root,
      text: prompt,
      mode: input.mode,
      backend: input.backend,
      model: input.model,
      effort: input.effort,
      timeoutMs,
      bin: this.#opts.bin,
      sandbox: this.#opts.sandbox,
      ...(box ? { box } : {}),
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
    const gitAt = this.#opts.git?.point(root) ?? Promise.resolve(undefined);
    this.#active.set(run, { turn, cancelled: false, timeoutMs, gitAt });

    // ONE write, carrying the group and — for a run off the queue — the `running` transition with it.
    // The pgid exists only once the process does, which is why this cannot be part of the dispatch
    // record; but it must not be a SECOND write racing another, which is what it was.
    //
    // Its purpose is entirely for a LATER server: this one holds the handle, while a run still marked
    // in flight at the next startup is one whose group may have outlived the process that spawned it.
    const withGroup: RunRecord = {
      ...record,
      ...(turn.pgid === undefined ? {} : { pgid: turn.pgid }),
      ...(turn.pgstart === undefined ? {} : { pgstart: turn.pgstart }),
    };
    // Skipped only when there is nothing new to say: a dispatch already wrote this record, and an
    // OpenCode turn has no group. `onUpdate` fires only for the queue transition — nothing in the UI
    // shows a pgid, so broadcasting a record that differs by one invisible field would be noise on
    // every client for every dispatch.
    if (turn.pgid !== undefined || announce) {
      void writeRun(root, withGroup)
        .then(() => {
          if (announce) this.#opts.onUpdate?.(withGroup);
        })
        // Survivable in the dispatch case: the run is on disk and still running, and what is lost is a
        // future server's ability to reap this group. For a queued run it also leaves the record saying
        // `queued` while the agent works, which reads as a stuck queue — so it is recorded, never
        // swallowed.
        .catch((err) => this.#opts.log?.warn({ err, run }, 'could not record this run’s process group'));
    }

    // Not awaited: the caller was answered when the record was written, and the ending arrives
    // through onUpdate. Errors are folded into the record rather than thrown into nowhere.
    void this.#settle(root, run, record, turn, minted?.token);
  }

  // A slot freed. Take the oldest waiting run, mark it running on disk, and spawn it.
  // A slot freed. Take the oldest waiting run and spawn it.
  //
  // It does NOT write the record here. It used to — `void writeRun(running)` immediately followed by
  // `#start`, whose spawn fires a second write of the same path with the pgid attached — and nothing
  // ordered the two. Measured in review: the pgid was lost in 8 of 300 queued runs, and a record with
  // no pgid can never be reaped, which is the orphan leak the field exists to close, failing silently
  // on about one queued run in forty. The unique temp name fixed the truncation, not the ordering.
  //
  // So there is one write per transition, and `#spawn` makes it: by the time the record says `running`
  // on disk it already carries the group. Until then it still says `queued`, which is true.
  #drain(): void {
    // A halt between a run being queued and a slot freeing. `cancelAll` clears the queue on the way
    // into `halted`, so this is the second line: whatever is still waiting stays waiting rather than
    // being spawned into a project that is supposed to have nothing running in it.
    if (this.#opts.halted?.()) return;
    while (!this.isBusy()) {
      const next = this.#queue.shift();
      if (!next) return;
      // Not awaited — #drain is called from #settle's synchronous tail — but a rejection must not
      // become an unhandled one. A queued run whose box cannot be created has to be reported as a
      // failed run, or it simply disappears: taken off the queue, never spawned, never settled.
      void this.#start(next.root, { ...next.record, status: 'running' }, next.input, true).catch((err) =>
        this.#failToStart(next.root, next.record, err),
      );
    }
  }

  // Which box this run executes in.
  //
  // Resolved BEFORE the turn, never inferred from its failure: `docker exec` into a missing box exits
  // non-zero exactly as a genuinely failing agent does, so a containment problem would be reported as
  // the agent's own. A throw here surfaces as a failed dispatch carrying docker's own reason.
  async #boxFor(root: string, backend: Backend): Promise<string | undefined> {
    if (!this.#opts.boxes) return undefined;
    return (await this.#opts.boxes.ensure(root, backend)).name;
  }

  // A run that never started, because the thing it needed to run INSIDE could not be made.
  //
  // It gets a real, settled record rather than disappearing. A queued run is taken off the queue the
  // moment it is picked, so a throw with no handler here loses it silently: the board shows nothing
  // running, nothing queued, and no failure — the worst of the three possible wrong answers.
  async #failToStart(root: string, record: RunRecord, err: unknown): Promise<void> {
    const reason = errorText(err);
    this.#opts.log?.error({ err, run: record.run }, 'a run could not be started');
    const failed = withoutReport(
      record,
      'failed',
      `This run never started: ${reason}`,
      this.#opts.now().toISOString(),
    );
    try {
      await writeRun(root, failed);
      this.#opts.onUpdate?.(failed);
    } catch (writeErr) {
      this.#opts.log?.error(
        { err: writeErr, run: record.run },
        'could not record a run that failed to start',
      );
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

  // How many files this run changed. Like the suggestion count, a failure here must not fail the run —
  // it is a diagnostic, not the outcome — and it returns `undefined` rather than 0, so the record says
  // "no answer" instead of claiming the run touched nothing.
  async #measured(root: string, at: Promise<GitPoint | undefined> | undefined): Promise<number | undefined> {
    if (!at || !this.#opts.git) return undefined;
    try {
      return await this.#opts.git.changedSince(root, await at);
    } catch (err) {
      this.#opts.log?.warn({ err }, 'could not measure how many files this run changed');
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
      const active = this.#active.get(run);
      const cancelled = active?.cancelled === true;
      const finishedAt = this.#opts.now().toISOString();
      // Every transcript line on disk before anything reads the tail.
      await this.#transcripts.get(run);
      // Attached here, once, so BOTH endings carry it: a run that failed or was cancelled still
      // spent tokens, and that is exactly when you want to know how many.
      const spent = withFilesChanged(
        withSuggestions(withUsage(record, usageFromStats(result.stats)), await this.#filed(root, run)),
        await this.#measured(root, active?.gitAt),
      );
      // S1: a run the USER stopped, or one the clock killed, does not get to decide its own verdict.
      // `foldReport` takes `status` from the agent's own `outcome`, so a runaway that wrote
      // "outcome: success" and then hung was recorded as a SUCCESS — which also broke the
      // timeout→failed mapping the attempt table calls load-bearing, in exactly the case the timeout
      // exists for.
      //
      // The report is still consumed, and still kept as EVIDENCE (decision 18): the verdict is ours,
      // the reasoning is worth reading, and a file left behind would sit in runs/ unread for ever.
      const stopped = cancelled || result.timedOut;
      const evidence = stopped ? await this.#takeEvidence(root, run, secret) : undefined;
      const folded = stopped ? null : await foldReport(root, spent, finishedAt, secret);
      final =
        folded ??
        (await this.#endWithoutReport(
          root,
          spent,
          result,
          cancelled,
          finishedAt,
          active?.timeoutMs,
          evidence,
        ));
    } catch (err) {
      final = withoutReport(
        record,
        'failed',
        `The run could not be completed: ${errorText(err)}`,
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

  // What a stopped run wrote, if anything, with its own verdict discarded. Consumed either way so it
  // cannot outlive the run that wrote it.
  async #takeEvidence(root: string, run: string, secret?: string): Promise<string | undefined> {
    const raw = await takeAgentReport(root, run);
    if (raw === null) return undefined;
    const text = redact(raw, secret);
    // The prose only. `outcome` is deliberately ignored — that is the whole point — and its
    // frontmatter would be noise in a pane showing why a run was stopped.
    return parseAgentReport(text).body;
  }

  // No verdict of the agent's to use. Which of the four endings it was decides the status, and the
  // note is what the UI shows in place of a report — with the report's own prose if it wrote one, and
  // the transcript tail otherwise, so "it did nothing" is checkable.
  async #endWithoutReport(
    root: string,
    record: RunRecord,
    result: { exitCode: number | null; timedOut: boolean },
    cancelled: boolean,
    finishedAt: string,
    // Absent only if the run never got as far as being spawned, in which case it did not time out
    // either and the sentence below is not reached.
    carriedTimeoutMs = 0,
    // What a stopped run had already written. Falls back to the transcript when it wrote nothing
    // usable, which is the case the tail exists for.
    evidence?: string,
  ): Promise<RunRecord> {
    const timeoutMs = carriedTimeoutMs;
    const tail = evidence?.trim() ? evidence : await transcriptTail(root, record.run);
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
