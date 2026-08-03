import { chmodSync, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boardRel, DOCS_DIR, skillRel } from '../src/core/layout.js';
import { type RunRecord, withSuggestions } from '../src/core/runs.js';
import type { Skill } from '../src/core/skills.js';
import type { Card } from '../src/core/types.js';
import { AgentRunner, type DispatchInput, type RunnerOptions } from '../src/server/agent-runner.js';
import { type Credential, CredentialStore, type Scope } from '../src/server/credentials.js';
import { listCardRuns, readRun, reportPath, transcriptTail } from '../src/server/run-store.js';
import { countRunSuggestions, writeSuggestion } from '../src/server/suggestion-store.js';
import { tempDir } from './helpers.js';

const SHIM = join(process.cwd(), 'test', 'fixtures', 'fake-agent.mjs');
// Stryker runs the suite from a sandbox COPY of the repo, and the copy does not carry the executable
// bit — so the shim could not be spawned there and every run was recorded as failed, which failed
// the dry run before any mutant existed. Restoring it here costs nothing and works either way.
chmodSync(SHIM, 0o755);

const skill: Skill = {
  slug: 'execute',
  path: skillRel('execute', 'SKILL.md'),
  name: 'Execute',
  description: 'Implement the card',
  boards: [],
  columns: [],
  prompt: 'Implement the card below.',
};

const card = (root: string): Card =>
  ({
    id: 'E-010',
    title: 'Token store',
    board: 'engineering',
    columnSlug: 'todo',
    order: 10,
    tags: [],
    links: [],
    created: '2026-07-26',
    body: 'detail',
    filePath: join(root, boardRel('engineering', 'todo', 'E-010.md')),
  }) as Card;

const input = (root: string, over: Partial<DispatchInput> = {}): DispatchInput => ({
  skill,
  card: card(root),
  // Columns are per-project config, so these are this fixture's own — not the defaults — and they
  // include the column the card above sits in. The runner only carries them to the prompt.
  boardColumns: [
    {
      board: 'engineering',
      columns: [
        { name: 'Todo', slug: 'todo' },
        { name: 'Doing', slug: 'doing' },
      ],
    },
  ],
  cardFile: '---\nid: E-010\n---\ndetail',
  linked: [],
  attachments: [],
  links: [],
  backend: 'claude-code',
  model: 'shim',
  effort: 'high',
  mode: 'bypassPermissions',
  // Defaults to a shim that succeeds; a test wanting another ending passes behaving('…').
  userPrompt: '[[behaviour:success]]',
  ...over,
});

// A runner with a pinned clock and suffix, so run ids are exact rather than approximate.
function runner(root: string, over: Partial<RunnerOptions> = {}) {
  const updates: RunRecord[] = [];
  const instance = new AgentRunner({
    root: () => root,
    bin: SHIM,
    now: () => new Date('2026-07-26T14:30:12.000Z'),
    suffix: () => 'a1b2',
    // Generous on purpose: these tests spawn a real child process, and Stryker runs 19 vitest
    // workers at once. At 5s the spawn itself lost the race under that load and the run was recorded
    // as timed out — which failed Stryker's DRY RUN and so blocked mutation testing for the whole
    // project. The one test that wants a timeout sets its own.
    timeoutMs: () => 20_000,
    maxConcurrent: () => 1,
    onUpdate: (r) => updates.push(r),
    ...over,
  });
  return { instance, updates };
}

// Waits for the record to reach a final state on disk. Real time, not fake timers: the run ends in
// a child process exit and a file write, neither of which a faked clock can flush.
async function settled(root: string, run: string): Promise<RunRecord> {
  // Up to 30s, for the same reason the runner timeout is generous: under Stryker's concurrency a
  // child process can take seconds just to start.
  for (let i = 0; i < 300; i++) {
    const record = await readRun(root, 'engineering', 'E-010', run);
    if (record && record.status !== 'running' && record.status !== 'queued') return record;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('run never settled');
}

afterEach(() => vi.restoreAllMocks());

// How the shim is told what to do: a marker in the prompt, not an environment variable. Env is
// shared with every other test file in the process, and a sibling's beforeEach rewriting it mid-run
// is what made Stryker's dry run fail where `npm test` passed.
const behaving = (behaviour: string) => ({ userPrompt: `[[behaviour:${behaviour}]]` });

// Signal 0 asks "may I signal this?" and kills nothing.
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('AgentRunner.dispatch', () => {
  it('writes a running record straight away and answers with it', async () => {
    const root = await tempDir();
    const { instance, updates } = runner(root);
    const record = await instance.dispatch(input(root));

    expect(record.run).toBe('20260726-143012-a1b2');
    expect(record.status).toBe('running');
    expect(record.skill).toBe('execute');
    expect(record.card).toBe('E-010');
    // On disk before the agent has finished, so a restart can see it was in flight.
    expect((await readRun(root, 'engineering', 'E-010', record.run))?.status).toBe('running');
    expect(updates[0]?.status).toBe('running');
    await settled(root, record.run);
  });

  it('folds a success report into the record', async () => {
    const root = await tempDir();
    const { instance, updates } = runner(root);
    const { run } = await instance.dispatch(input(root));
    const final = await settled(root, run);

    expect(final.status).toBe('success');
    expect(final.outcome).toBe('success');
    expect(final.summary).toBe('did the thing');
    expect(final.created).toEqual(['E-041']);
    expect(final.report).toBe('## What I did\n\nAll of it.');
    expect(final.finished).toBe('2026-07-26T14:30:12.000Z');
    expect(updates.at(-1)?.status).toBe('success');
  });

  it('records what the run cost, read back from the file on disk', async () => {
    // Through serialize and parse, not just in memory: the dashboard reads these files.
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root));
    const final = await settled(root, run);

    expect(final.usage).toEqual({
      costUsd: 0.0125,
      durationMs: 1250,
      turns: 3,
      // input + cache read: window occupancy, not the sum of every call in the turn.
      contextTokens: 100,
      outputTokens: 7,
    });
  });

  it('records a zero cost as zero, not as unknown', async () => {
    // Free models are the common case on OpenCode. A run that cost nothing and a run that never
    // said what it cost are different facts, and only one of them is worth showing as blank.
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root, behaving('free')));
    const final = await settled(root, run);

    expect(final.status).toBe('success');
    expect(final.usage?.costUsd).toBe(0);
  });

  it('records what a crashed run spent, since it spent it anyway', async () => {
    // The reason usage is attached BEFORE the ending is decided: the failing runs are the ones you
    // most want the bill for.
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root, behaving('crash')));
    const final = await settled(root, run);

    expect(final.status).toBe('failed');
    expect(final.usage?.costUsd).toBe(0.0125);
    expect(final.usage?.turns).toBe(3);
  });

  it('leaves usage absent when the agent never reported any', async () => {
    // `chatty` exits without a result line. Zeros here would read as "this run was free".
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root, behaving('chatty')));
    const final = await settled(root, run);

    expect(final.usage).toBeUndefined();
  });

  it('folds an attention report, options and all', async () => {
    const shim = behaving('attention');
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root, shim));
    const final = await settled(root, run);

    expect(final.status).toBe('attention');
    expect(final.options).toEqual(['Split it in two', 'Do the store only']);
    expect(final.summary).toBe('bigger than one card');
  });

  it('needs attention when the agent finishes without a report', async () => {
    // The contract's whole point: silence is not success.
    const shim = behaving('silent');
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root, shim));
    const final = await settled(root, run);

    expect(final.status).toBe('attention');
    expect(final.outcome).toBeUndefined();
    expect(final.note).toBe('The agent finished without writing a report.');
    // The transcript tail stands in for the report, so "it did nothing" is checkable.
    expect(final.report).toContain('working (silent)');
  });

  it('keeps every transcript line, in order, when the agent exits the moment it stops talking', async () => {
    // A REGRESSION test for a real race, not a hypothetical one: the appends used to be fired and
    // forgotten, so #settle read the tail while writes were still in flight and lines went missing —
    // from the one thing that stands in for a report when the agent wrote none. Twenty events and an
    // immediate exit is what makes it near-certain rather than occasional.
    const shim = behaving('chatty');
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root, shim));
    const final = await settled(root, run);

    const steps = [...final.report.matchAll(/step (\d+)/g)].map((m) => Number(m[1]));
    expect(steps).toEqual([...Array(20).keys()]);
  });

  it('needs attention when the report frontmatter is malformed', async () => {
    const shim = behaving('garbage');
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root, shim));
    const final = await settled(root, run);

    expect(final.status).toBe('attention');
    expect(final.report).toContain('I tried');
  });

  it('fails, with the exit code, when the agent crashes', async () => {
    const shim = behaving('crash');
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root, shim));
    const final = await settled(root, run);

    expect(final.status).toBe('failed');
    expect(final.note).toBe('The agent exited with code 2 and wrote no report.');
  });

  // Decision 13, and the reason process groups exist at all. A CLI agent starts compilers, test
  // runners and servers; `child.kill()` reached the agent and left those running, reparented to init,
  // still working and still spending. 16 such processes were measured on the development machine.
  //
  // This test fails against `child.kill('SIGTERM')`, which is what the code did before.
  it('kills what the agent started, not just the agent', async () => {
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root, behaving('spawner')));

    // The pid arrives through the transcript, which the runner writes as events stream in.
    let grandchild = 0;
    for (let i = 0; i < 100 && grandchild === 0; i++) {
      const seen = (await transcriptTail(root, run)).match(/child (\d+)/);
      if (seen) grandchild = Number(seen[1]);
      else await new Promise((r) => setTimeout(r, 50));
    }
    expect(grandchild).toBeGreaterThan(0);
    expect(alive(grandchild)).toBe(true);
    // Recorded on the run, so a LATER server could reap this group even without the handle.
    const during = await readRun(root, 'engineering', 'E-010', run);
    expect(during?.pgid).toBeGreaterThan(1);
    expect(during?.pgstart).toBeGreaterThan(0);

    expect(instance.cancel(run)).toBe(true);
    expect((await settled(root, run)).status).toBe('cancelled');
    // The group gets SIGTERM and then SIGKILL after the grace period; `sleep` dies on the first.
    for (let i = 0; i < 60 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 50));
    expect(alive(grandchild)).toBe(false);
  }, 20_000);

  // S11. The measurement itself is tested in git-measure.test.ts; what this pins is the WIRING — that
  // the point is taken before the agent runs and the count reaches the record on both endings, since a
  // failed run's wreckage is exactly when you want to know what it touched.
  describe('how many files a run changed', () => {
    const fakeGit = (count: number | undefined) => ({
      point: async () => ({ dirty: {} }),
      changedSince: async () => count,
    });

    it('is recorded on a run that succeeded', async () => {
      const root = await tempDir();
      const { instance } = runner(root, { git: fakeGit(7) });
      const { run } = await instance.dispatch(input(root));
      expect((await settled(root, run)).filesChanged).toBe(7);
    });

    it('is recorded on a run that failed', async () => {
      const root = await tempDir();
      const { instance } = runner(root, { git: fakeGit(2) });
      const { run } = await instance.dispatch(input(root, behaving('crash')));
      const final = await settled(root, run);
      expect(final.status).toBe('failed');
      expect(final.filesChanged).toBe(2);
    });

    // Zero is a real answer: the run changed nothing.
    it('records a genuine zero', async () => {
      const root = await tempDir();
      const { instance } = runner(root, { git: fakeGit(0) });
      const { run } = await instance.dispatch(input(root));
      expect((await settled(root, run)).filesChanged).toBe(0);
    });

    // No repository to ask, or no git. The record must not claim the run touched nothing.
    it('is absent when there was no answer', async () => {
      const root = await tempDir();
      const { instance } = runner(root, { git: fakeGit(undefined) });
      const { run } = await instance.dispatch(input(root));
      expect((await settled(root, run)).filesChanged).toBeUndefined();
    });

    it('is absent when nothing measures it at all', async () => {
      const root = await tempDir();
      const { instance } = runner(root);
      const { run } = await instance.dispatch(input(root));
      expect((await settled(root, run)).filesChanged).toBeUndefined();
    });

    // A diagnostic must never fail the run it describes.
    it('survives a measurement that throws', async () => {
      const root = await tempDir();
      const { instance } = runner(root, {
        git: {
          point: async () => ({ dirty: {} }),
          changedSince: async () => {
            throw new Error('git exploded');
          },
        },
      });
      const { run } = await instance.dispatch(input(root));
      const final = await settled(root, run);
      expect(final.status).toBe('success');
      expect(final.filesChanged).toBeUndefined();
    });
  });

  // S1, and Principle 3: absence and zero are different facts, and so are "the agent says it worked"
  // and "the agent got to finish". foldReport took `status` from the report's own `outcome`, so a
  // runaway that declared success and then hung was recorded as a SUCCESS — breaking the
  // timeout→failed mapping in exactly the case the timeout exists for.
  describe('a run stopped after it had already claimed success', () => {
    it('is cancelled when the user stopped it, and keeps the report as evidence', async () => {
      const root = await tempDir();
      const { instance } = runner(root);
      const { run } = await instance.dispatch(input(root, behaving('reporthang')));
      // Wait for the report to be on disk: the race is the whole point, so the test must lose it.
      for (let i = 0; i < 100 && !existsSync(reportPath(root, run)); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(existsSync(reportPath(root, run))).toBe(true);

      instance.cancel(run);
      const final = await settled(root, run);
      expect(final.status).toBe('cancelled');
      expect(final.outcome).toBeUndefined();
      expect(final.note).toBe('You stopped this run.');
      // Decision 18: the verdict is ours, the reasoning is still worth reading.
      expect(final.report).toContain('All of it.');
      // Consumed, so it cannot outlive the run that wrote it.
      expect(existsSync(reportPath(root, run))).toBe(false);
    }, 20_000);

    it('is failed when the clock stopped it', async () => {
      const root = await tempDir();
      const { instance } = runner(root, { timeoutMs: () => 1_000 });
      const { run } = await instance.dispatch(input(root, behaving('reporthang')));
      const final = await settled(root, run);
      expect(final.status).toBe('failed');
      expect(final.outcome).toBeUndefined();
      expect(final.note).toContain('still running after 1s');
      expect(final.report).toContain('All of it.');
    }, 20_000);
  });

  it('records a cancelled run as cancelled, not failed', async () => {
    const shim = behaving('hang');
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root, shim));

    expect(instance.cancel(run)).toBe(true);
    const final = await settled(root, run);
    expect(final.status).toBe('cancelled');
    expect(final.note).toBe('You stopped this run.');
  });

  it('fails a run that outlives its timeout', async () => {
    const shim = behaving('hang');
    const root = await tempDir();
    const { instance } = runner(root, { timeoutMs: () => 300 });
    const { run } = await instance.dispatch(input(root, shim));
    const final = await settled(root, run);

    expect(final.status).toBe('failed');
    expect(final.note).toBe('The agent was still running after 0s and was stopped.');
  });

  // Decision 8: the enforceable per-run bound is wall-clock, and it has to be the number the user can
  // see. Two properties, and they pull in opposite directions: it is read PER DISPATCH so a change in
  // Settings needs no restart, and it is CARRIED for the life of that run so the sentence a timed-out
  // run leaves behind quotes the limit that run was actually held to.
  it('takes its patience from the project on every dispatch, and holds each run to its own', async () => {
    const shim = behaving('hang');
    const root = await tempDir();
    let limit = 1_000;
    let n = 0;
    // Two dispatches from one runner, so they need distinct ids — the pinned clock alone would give
    // both the same one and the second would overwrite the first's record.
    const { instance } = runner(root, { timeoutMs: () => limit, suffix: () => `t${++n}` });

    const first = await instance.dispatch(input(root, shim));
    // Changed while that run is still in flight. Re-read at settle, this would say 9s.
    limit = 9_000;
    expect((await settled(root, first.run)).note).toBe(
      'The agent was still running after 1s and was stopped.',
    );

    limit = 2_000;
    const second = await instance.dispatch(input(root, shim));
    expect((await settled(root, second.run)).note).toBe(
      'The agent was still running after 2s and was stopped.',
    );
  });

  it('queues a run past the cap instead of refusing it', async () => {
    // A run is minutes of work, so "busy, try again" would be the wrong answer.
    const shim = behaving('hang');
    const root = await tempDir();
    let n = 0;
    const { instance } = runner(root, { suffix: () => `s${++n}` });
    const first = await instance.dispatch(input(root, shim));
    const second = await instance.dispatch(input(root, shim));

    expect(first.status).toBe('running');
    expect(second.status).toBe('queued');
    expect(instance.activeIds).toEqual([first.run]);
    expect(instance.queuedIds).toEqual([second.run]);
    // On disk as queued, so a restart can see it was waiting rather than lose it silently.
    expect((await readRun(root, 'engineering', 'E-010', second.run))?.status).toBe('queued');

    instance.cancel(first.run);
    instance.cancel(second.run);
    await settled(root, first.run);
    await settled(root, second.run);
  });

  it('starts the waiting run as soon as a slot frees, oldest first', async () => {
    const root = await tempDir();
    let n = 0;
    const { instance, updates } = runner(root, { suffix: () => `s${++n}` });
    const first = await instance.dispatch(input(root));
    const second = await instance.dispatch(input(root));
    const third = await instance.dispatch(input(root));
    expect([second.status, third.status]).toEqual(['queued', 'queued']);

    // The shim succeeds immediately, so the first run ends and the queue drains itself.
    for (const r of [first, second, third]) expect((await settled(root, r.run)).status).toBe('success');
    expect(instance.queuedIds).toEqual([]);
    expect(instance.activeIds).toEqual([]);
    // Oldest first: the second run reached 'running' before the third did.
    const running = updates.filter((u) => u.status === 'running').map((u) => u.run);
    expect(running).toEqual([first.run, second.run, third.run]);
  });

  it('runs several at once when the cap allows it', async () => {
    const shim = behaving('hang');
    const root = await tempDir();
    let n = 0;
    const { instance } = runner(root, { suffix: () => `s${++n}`, maxConcurrent: () => 3 });
    const runs = [
      await instance.dispatch(input(root, shim)),
      await instance.dispatch(input(root, shim)),
      await instance.dispatch(input(root, shim)),
    ];
    expect(runs.map((r) => r.status)).toEqual(['running', 'running', 'running']);
    expect(instance.activeIds).toHaveLength(3);

    for (const r of runs) {
      instance.cancel(r.run);
      await settled(root, r.run);
    }
  });

  it('reads the cap per dispatch, so changing it takes effect without a restart', async () => {
    const shim = behaving('hang');
    const root = await tempDir();
    let n = 0;
    let cap = 1;
    const { instance } = runner(root, { suffix: () => `s${++n}`, maxConcurrent: () => cap });
    const first = await instance.dispatch(input(root, shim));
    expect((await instance.dispatch(input(root, shim))).status).toBe('queued');

    cap = 5;
    expect((await instance.dispatch(input(root, shim))).status).toBe('running');

    for (const id of [...instance.activeIds, ...instance.queuedIds]) instance.cancel(id);
    await settled(root, first.run);
  });

  // A spawned agent is an ordinary child process: it does NOT die with the server that started it.
  // Left running on shutdown it keeps working, and keeps spending, against a board nobody is
  // watching — and the same shape left fourteen test shims alive for a week.
  it('cancels every run, running and queued, in one call', async () => {
    const root = await tempDir();
    const shim = behaving('hang');
    // Distinct suffixes: the fixture pins the clock AND the suffix for deterministic ids, so two
    // dispatches would otherwise collide on one id.
    let n = 0;
    const { instance } = runner(root, { suffix: () => `s${++n}`, maxConcurrent: () => 1 });
    const running = await instance.dispatch(input(root, shim));
    const queued = await instance.dispatch(input(root, shim));
    expect([running.status, queued.status]).toEqual(['running', 'queued']);

    // One of each, and only one spawned process: with nothing queued, "cancel the active ones" and
    // "cancel everything" are the same call and neither would be tested.
    expect(instance.cancelAll()).toBe(2);

    expect((await settled(root, running.run)).status).toBe('cancelled');
    expect((await settled(root, queued.run)).status).toBe('cancelled');
    expect(instance.activeIds).toHaveLength(0);
  });

  it('reports nothing to cancel when nothing is in flight', async () => {
    expect(runner(await tempDir()).instance.cancelAll()).toBe(0);
  });

  it('cancels a run that never started, without spawning anything', async () => {
    const shim = behaving('hang');
    const root = await tempDir();
    let n = 0;
    const { instance } = runner(root, { suffix: () => `s${++n}` });
    const first = await instance.dispatch(input(root, shim));
    const waiting = await instance.dispatch(input(root, shim));

    expect(instance.cancel(waiting.run)).toBe(true);
    const ended = await settled(root, waiting.run);
    expect(ended.status).toBe('cancelled');
    expect(ended.note).toBe('You stopped this run before it started.');
    expect(instance.queuedIds).toEqual([]);
    // The running one is untouched by cancelling a queued sibling.
    expect(instance.activeIds).toEqual([first.run]);

    instance.cancel(first.run);
    await settled(root, first.run);
  });

  it('frees the slot however the run ended', async () => {
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root));
    await settled(root, run);
    expect(instance.activeIds).toEqual([]);
  });

  it('cancelling an unknown run says so rather than pretending', async () => {
    expect(runner(await tempDir()).instance.cancel('nope')).toBe(false);
  });

  it('records the dispatch choices, so a report can be read against what produced it', async () => {
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(
      input(root, {
        userPrompt: '  only the token store  ',
        attachments: [`${DOCS_DIR}/api.md`],
        model: 'opus',
        effort: 'low',
        mode: 'plan',
      }),
    );
    const final = await settled(root, run);
    expect(final.prompt).toBe('only the token store');
    expect(final.attached).toEqual([`${DOCS_DIR}/api.md`]);
    expect(final.model).toBe('opus');
    expect(final.effort).toBe('low');
    expect(final.mode).toBe('plan');
  });

  it('links an iteration to the run it continues, and carries that report into the prompt', async () => {
    const root = await tempDir();
    const previous: RunRecord = {
      run: '20260726-141000-9f3e',
      card: 'E-010',
      board: 'engineering',
      skill: 'execute',
      status: 'attention',
      started: '2026-07-26T14:10:00.000Z',
      backend: 'claude-code',
      model: 'opus',
      effort: 'high',
      mode: 'bypassPermissions',
      report: '## What I found\n\nNeeds splitting.',
    };
    const argsLog = join(await tempDir(), 'args.log');
    process.env.VIBEBOARD_SHIM_ARGS = argsLog;
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root, { previous }));
    const final = await settled(root, run);
    delete process.env.VIBEBOARD_SHIM_ARGS;

    expect(final.previous).toBe('20260726-141000-9f3e');
    const { readFile } = await import('node:fs/promises');
    const prompt: string = JSON.parse((await readFile(argsLog, 'utf8')).trim().split('\n')[0]).prompt;
    expect(prompt).toContain('## The previous run on this card');
    expect(prompt).toContain('Needs splitting.');
  });

  it('writes a transcript of the run', async () => {
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root));
    await settled(root, run);
    expect(await transcriptTail(root, run)).toContain('shim-model');
  });

  it('consumes the report file, so the next run cannot inherit it', async () => {
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root));
    await settled(root, run);
    const { readFile } = await import('node:fs/promises');
    await expect(readFile(reportPath(root, run), 'utf8')).rejects.toThrow();
  });

  it('leaves one record per run in the card history', async () => {
    const root = await tempDir();
    const { instance } = runner(root);
    const first = await instance.dispatch(input(root));
    await settled(root, first.run);
    // A second dispatch needs a different id, so the clock moves on.
    const second = new AgentRunner({
      root: () => root,
      bin: SHIM,
      now: () => new Date('2026-07-26T15:00:00.000Z'),
      suffix: () => 'c3d4',
      timeoutMs: () => 20_000,
      maxConcurrent: () => 1,
    });
    const next = await second.dispatch(input(root));
    await settled(root, next.run);

    const history = await listCardRuns(root, 'engineering', 'E-010');
    expect(history.map((r) => r.run)).toEqual([first.run, next.run]);
    expect(history.every((r) => r.status === 'success')).toBe(true);
  });

  it('fails the record rather than hanging when the agent cannot start', async () => {
    const root = await tempDir();
    // A bin that does not exist, passed explicitly rather than through the environment.
    const { instance } = runner(root, { bin: join(root, 'no-such-binary') });
    const { run } = await instance.dispatch(input(root));
    const final = await settled(root, run);
    expect(final.status).toBe('failed');
    expect(final.note).toContain('wrote no report');
  });

  it('does not need the results folder to exist first', async () => {
    const root = await tempDir();
    await mkdir(join(root, boardRel('engineering', 'todo')), { recursive: true });
    await writeFile(
      join(root, boardRel('engineering', 'todo', 'E-010.md')),
      '---\nid: E-010\n---\nx\n',
      'utf8',
    );
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root));
    expect((await settled(root, run)).status).toBe('success');
  });
});

// A run's credential is the only way it can change the board once the sandbox lands, and it cannot
// arrive by environment variable: the OpenCode backend is one long-lived `opencode serve` spawned
// before any run exists. So it travels in the prompt, and its lifetime is the run's.
describe('the run credential', () => {
  // Recorded at mint time rather than verified afterwards: the shim finishes in milliseconds, so by
  // the time the prompt can be read off disk the run has settled and the credential is already
  // revoked — correctly. What this pins is what was minted, and that the prompt carried it.
  class RecordingStore extends CredentialStore {
    minted: Credential[] = [];
    override mintRun(
      scope: Exclude<Scope, 'admin'>,
      run: string,
      project?: string,
      card?: string,
    ): Credential {
      const cred = super.mintRun(scope, run, project, card);
      this.minted.push(cred);
      return cred;
    }
  }

  it('mints a work credential confined to the run and its card, and puts it in the prompt', async () => {
    const root = await tempDir();
    const store = new RecordingStore('admin');
    const argsLog = join(await tempDir(), 'args.log');
    process.env.VIBEBOARD_SHIM_ARGS = argsLog;
    const { instance } = runner(root, { credentials: store, apiBase: () => 'http://127.0.0.1:4610' });

    const { run } = await instance.dispatch(input(root));
    await settled(root, run);
    delete process.env.VIBEBOARD_SHIM_ARGS;

    expect(store.minted).toHaveLength(1);
    expect(store.minted[0]).toMatchObject({ scope: 'work', run, project: root, card: 'E-010' });

    const { readFile } = await import('node:fs/promises');
    const text: string = JSON.parse((await readFile(argsLog, 'utf8')).trim().split('\n')[0]).prompt;
    expect(text).toContain(store.minted[0].token);
    expect(text).toContain('http://127.0.0.1:4610');
  });

  it('revokes the credential however the run ends', async () => {
    // Every ending, not just success: a credential outliving a cancelled or failed run is a live key
    // to the board held by a process nobody is watching. The token asserted on is the one the RUNNER
    // minted — an earlier version of this test minted its own and expired it by hand, so it passed
    // with the runner's revoke deleted.
    for (const behaviour of ['success', 'attention', 'crash'] as const) {
      const root = await tempDir();
      const store = new RecordingStore('admin');
      const { instance } = runner(root, { credentials: store });
      const { run } = await instance.dispatch(input(root, behaving(behaviour)));
      await settled(root, run);
      expect(store.minted[0].run, behaviour).toBe(run);
      expect(store.verify(store.minted[0].token), behaviour).toBeNull();
    }
  });

  // The three behaviours above all resolve turn.done normally and take the same path out, so they
  // never reach the `finally` at all — moving expireRun onto the try-block's normal completion line
  // left the suite green. The only ending the `finally` uniquely covers is a throw mid-settle, and
  // that is what this forces.
  it('revokes the credential when settling itself throws', async () => {
    const root = await tempDir();
    const store = new RecordingStore('admin');
    const runStore = await import('../src/server/run-store.js');
    vi.spyOn(runStore, 'foldReport').mockRejectedValue(new Error('disk went away mid-settle'));

    const { instance } = runner(root, { credentials: store });
    const { run } = await instance.dispatch(input(root));
    // The record still settles — the catch writes a `failed` one — so the usual wait applies.
    expect((await settled(root, run)).status).toBe('failed');
    expect(store.verify(store.minted[0].token)).toBeNull();
  });

  // /proc/<pid>/cmdline is world readable — this machine's /proc has no hidepid — so a prompt passed
  // as an argument let any process on the box, including a concurrent run or the chat copilot, read
  // another run's credential with `ps` for as long as it lasted. The sandbox does not close that:
  // it restricts the filesystem, and a command line is not a file.
  it('keeps the token out of the command line', async () => {
    const root = await tempDir();
    const store = new RecordingStore('admin');
    const argsLog = join(await tempDir(), 'args.log');
    process.env.VIBEBOARD_SHIM_ARGS = argsLog;
    const { instance } = runner(root, { credentials: store, apiBase: () => 'http://127.0.0.1:4610' });
    const { run } = await instance.dispatch(input(root));
    await settled(root, run);
    delete process.env.VIBEBOARD_SHIM_ARGS;

    const { argv, prompt } = JSON.parse((await readFile(argsLog, 'utf8')).trim().split('\n')[0]) as {
      argv: string[];
      prompt: string;
    };
    // Both halves: the token must be in the prompt the agent received AND absent from argv. The
    // absence alone would pass on a prompt that was never delivered.
    expect(prompt).toContain(store.minted[0].token);
    expect(argv.join(' ')).not.toContain(store.minted[0].token);
  });

  it('keeps the token out of the transcript even when the agent echoes it', async () => {
    // Transcripts live under .vibeboard/ where every agent can read them, so a run that quotes its
    // own credential would hand a concurrent run a working key.
    const root = await tempDir();
    const store = new RecordingStore('admin');
    const { instance } = runner(root, { credentials: store, apiBase: () => 'http://127.0.0.1:4610' });
    const { run } = await instance.dispatch(input(root, behaving('echo')));
    await settled(root, run);

    const tail = await transcriptTail(root, run);
    expect(tail).toContain('Authorization: Bearer'); // the shim really did echo
    expect(tail).not.toContain(store.minted[0].token);
    expect(tail).toContain('[credential redacted]');
  });

  it('keeps the token out of the report, which is persisted and broadcast', async () => {
    // The transcript was covered; the report was not. It is folded into the run record, written to
    // disk and pushed over the websocket — and the credential is still live at the moment it is
    // written, because expireRun fires afterwards.
    const root = await tempDir();
    const store = new RecordingStore('admin');
    const { instance } = runner(root, { credentials: store, apiBase: () => 'http://127.0.0.1:4610' });
    const { run } = await instance.dispatch(input(root, behaving('leaky')));
    const final = await settled(root, run);

    expect(final.report).toContain('Authorization: Bearer'); // the shim really did quote it
    expect(final.report).not.toContain(store.minted[0].token);
    expect(final.report).toContain('[credential redacted]');
  });

  it('revokes the credential when the spawn itself throws', async () => {
    // The mint happens before the prompt is built and the process spawned, and #settle — which owns
    // the only revoke — never runs if either throws. Nothing reproduced that in normal operation,
    // but a mint outside a try is the wrong shape whether or not today's inputs can reach it.
    const root = await tempDir();
    const store = new RecordingStore('admin');
    const runPrompt = await import('../src/server/run-prompt.js');
    vi.spyOn(runPrompt, 'buildRunPrompt').mockImplementation(() => {
      throw new Error('prompt could not be built');
    });

    const { instance } = runner(root, { credentials: store });
    await expect(instance.dispatch(input(root))).rejects.toThrow('prompt could not be built');
    expect(store.minted).toHaveLength(1);
    expect(store.verify(store.minted[0].token)).toBeNull();
  });

  it('says nothing about a credential when the runner has no store', async () => {
    const root = await tempDir();
    const argsLog = join(await tempDir(), 'args.log');
    process.env.VIBEBOARD_SHIM_ARGS = argsLog;
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root));
    await settled(root, run);
    delete process.env.VIBEBOARD_SHIM_ARGS;

    const { readFile } = await import('node:fs/promises');
    const text: string = JSON.parse((await readFile(argsLog, 'utf8')).trim().split('\n')[0]).prompt;
    expect(text).not.toContain('Your credential');
  });
});

describe('the suggestion count', () => {
  it('records how many the run filed, and nothing when it filed none', async () => {
    const root = await tempDir();
    // Two, so the assertion can tell "counted them" from "noticed there was one".
    await writeSuggestion(root, {
      id: 's1',
      state: 'active',
      created: 'now',
      title: 'one',
      body: '',
      run: 'run-x',
    });
    await writeSuggestion(root, {
      id: 's2',
      state: 'active',
      created: 'now',
      title: 'two',
      body: '',
      run: 'run-x',
    });
    // A third from a different run, which must not be counted.
    await writeSuggestion(root, {
      id: 's3',
      state: 'active',
      created: 'now',
      title: 'three',
      body: '',
      run: 'run-y',
    });
    expect(await countRunSuggestions(root, 'run-x')).toBe(2);
  });

  it('is recorded on the run itself, from the store — the whole point of the field', async () => {
    // The gap this closes: everything else here tests countRunSuggestions and withSuggestions in
    // isolation, so removing the `withSuggestions(...)` call in #settle left the suite green while
    // the field silently stopped being written and slice C's checkup would read nothing.
    const root = await tempDir();
    const { instance } = runner(root);
    // `hang`, so the run is still in flight while the suggestions are filed against its real id —
    // which is only knowable after dispatch returns.
    const started = await instance.dispatch(input(root, behaving('hang')));
    for (const id of ['s1', 's2']) {
      await writeSuggestion(root, {
        id,
        state: 'active',
        created: 'now',
        title: id,
        body: '',
        run: started.run,
      });
    }
    // A third from another run, so the assertion distinguishes "counted this run's" from "counted".
    await writeSuggestion(root, {
      id: 's3',
      state: 'active',
      created: 'now',
      title: 's3',
      body: '',
      run: 'other',
    });

    instance.cancel(started.run);
    const final = await settled(root, started.run);
    expect(final.suggestions).toBe(2);
  });

  it('distinguishes "filed none" from "could not count"', () => {
    // Three facts, not two. An earlier version omitted zero to keep records tidy, which made a
    // clean run and an unreadable store look identical — and the checkup reads this to decide
    // whether a card was scoped wrongly, where "no findings" and "we did not look" differ.
    const record = { run: 'r' } as RunRecord;
    expect(withSuggestions(record, 3).suggestions).toBe(3);
    expect(withSuggestions(record, 0).suggestions).toBe(0);
    expect(withSuggestions(record, undefined)).not.toHaveProperty('suggestions');
  });
});
