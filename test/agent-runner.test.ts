import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunRecord } from '../src/core/runs.js';
import type { Skill } from '../src/core/skills.js';
import type { Card } from '../src/core/types.js';
import { AgentRunner, type DispatchInput, type RunnerOptions } from '../src/server/agent-runner.js';
import { listCardRuns, readRun, reportPath, transcriptTail } from '../src/server/run-store.js';
import { tempDir } from './helpers.js';

const SHIM = join(process.cwd(), 'test', 'fixtures', 'fake-agent.mjs');

const skill: Skill = {
  slug: 'execute',
  path: '.claude/skills/execute/SKILL.md',
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
    filePath: join(root, 'engineering', 'todo', 'E-010.md'),
  }) as Card;

const input = (root: string, over: Partial<DispatchInput> = {}): DispatchInput => ({
  skill,
  card: card(root),
  cardFile: '---\nid: E-010\n---\ndetail',
  linked: [],
  attachments: [],
  links: [],
  backend: 'claude-code',
  model: 'shim',
  effort: 'high',
  mode: 'bypassPermissions',
  ...over,
});

// A runner with a pinned clock and suffix, so run ids are exact rather than approximate.
function runner(root: string, over: Partial<RunnerOptions> = {}) {
  const updates: RunRecord[] = [];
  const instance = new AgentRunner({
    root: () => root,
    now: () => new Date('2026-07-26T14:30:12.000Z'),
    suffix: () => 'a1b2',
    timeoutMs: 5000,
    maxConcurrent: () => 1,
    onUpdate: (r) => updates.push(r),
    ...over,
  });
  return { instance, updates };
}

// Waits for the record to reach a final state on disk. Real time, not fake timers: the run ends in
// a child process exit and a file write, neither of which a faked clock can flush.
async function settled(root: string, run: string): Promise<RunRecord> {
  for (let i = 0; i < 100; i++) {
    const record = await readRun(root, 'engineering', 'E-010', run);
    if (record && record.status !== 'running' && record.status !== 'queued') return record;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('run never settled');
}

beforeEach(() => {
  process.env.VIBEBOARD_CLAUDE_BIN = SHIM;
  process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'success';
});
afterEach(() => {
  delete process.env.VIBEBOARD_CLAUDE_BIN;
  delete process.env.VIBEBOARD_SHIM_BEHAVIOUR;
  vi.restoreAllMocks();
});

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

  it('folds an attention report, options and all', async () => {
    process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'attention';
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root));
    const final = await settled(root, run);

    expect(final.status).toBe('attention');
    expect(final.options).toEqual(['Split it in two', 'Do the store only']);
    expect(final.summary).toBe('bigger than one card');
  });

  it('needs attention when the agent finishes without a report', async () => {
    // The contract's whole point: silence is not success.
    process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'silent';
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root));
    const final = await settled(root, run);

    expect(final.status).toBe('attention');
    expect(final.outcome).toBeUndefined();
    expect(final.note).toBe('The agent finished without writing a report.');
    // The transcript tail stands in for the report, so "it did nothing" is checkable.
    expect(final.report).toContain('working (silent)');
  });

  it('needs attention when the report frontmatter is malformed', async () => {
    process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'garbage';
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root));
    const final = await settled(root, run);

    expect(final.status).toBe('attention');
    expect(final.report).toContain('I tried');
  });

  it('fails, with the exit code, when the agent crashes', async () => {
    process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'crash';
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root));
    const final = await settled(root, run);

    expect(final.status).toBe('failed');
    expect(final.note).toBe('The agent exited with code 2 and wrote no report.');
  });

  it('records a cancelled run as cancelled, not failed', async () => {
    process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'hang';
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root));

    expect(instance.cancel(run)).toBe(true);
    const final = await settled(root, run);
    expect(final.status).toBe('cancelled');
    expect(final.note).toBe('You stopped this run.');
  });

  it('fails a run that outlives its timeout', async () => {
    process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'hang';
    const root = await tempDir();
    const { instance } = runner(root, { timeoutMs: 300 });
    const { run } = await instance.dispatch(input(root));
    const final = await settled(root, run);

    expect(final.status).toBe('failed');
    expect(final.note).toBe('The agent was still running after 0s and was stopped.');
  });

  it('queues a run past the cap instead of refusing it', async () => {
    // A run is minutes of work, so "busy, try again" would be the wrong answer.
    process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'hang';
    const root = await tempDir();
    let n = 0;
    const { instance } = runner(root, { suffix: () => `s${++n}` });
    const first = await instance.dispatch(input(root));
    const second = await instance.dispatch(input(root));

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
    process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'hang';
    const root = await tempDir();
    let n = 0;
    const { instance } = runner(root, { suffix: () => `s${++n}`, maxConcurrent: () => 3 });
    const runs = [
      await instance.dispatch(input(root)),
      await instance.dispatch(input(root)),
      await instance.dispatch(input(root)),
    ];
    expect(runs.map((r) => r.status)).toEqual(['running', 'running', 'running']);
    expect(instance.activeIds).toHaveLength(3);

    for (const r of runs) {
      instance.cancel(r.run);
      await settled(root, r.run);
    }
  });

  it('reads the cap per dispatch, so changing it takes effect without a restart', async () => {
    process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'hang';
    const root = await tempDir();
    let n = 0;
    let cap = 1;
    const { instance } = runner(root, { suffix: () => `s${++n}`, maxConcurrent: () => cap });
    const first = await instance.dispatch(input(root));
    expect((await instance.dispatch(input(root))).status).toBe('queued');

    cap = 5;
    expect((await instance.dispatch(input(root))).status).toBe('running');

    for (const id of [...instance.activeIds, ...instance.queuedIds]) instance.cancel(id);
    await settled(root, first.run);
  });

  it('cancels a run that never started, without spawning anything', async () => {
    process.env.VIBEBOARD_SHIM_BEHAVIOUR = 'hang';
    const root = await tempDir();
    let n = 0;
    const { instance } = runner(root, { suffix: () => `s${++n}` });
    const first = await instance.dispatch(input(root));
    const waiting = await instance.dispatch(input(root));

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
        attachments: ['docs/api.md'],
        model: 'opus',
        effort: 'low',
        mode: 'plan',
      }),
    );
    const final = await settled(root, run);
    expect(final.prompt).toBe('only the token store');
    expect(final.attached).toEqual(['docs/api.md']);
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
    const prompt = JSON.parse((await readFile(argsLog, 'utf8')).trim().split('\n')[0]).at(-1);
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
      now: () => new Date('2026-07-26T15:00:00.000Z'),
      suffix: () => 'c3d4',
      timeoutMs: 5000,
      maxConcurrent: () => 1,
    });
    const next = await second.dispatch(input(root));
    await settled(root, next.run);

    const history = await listCardRuns(root, 'engineering', 'E-010');
    expect(history.map((r) => r.run)).toEqual([first.run, next.run]);
    expect(history.every((r) => r.status === 'success')).toBe(true);
  });

  it('fails the record rather than hanging when the agent cannot start', async () => {
    process.env.VIBEBOARD_CLAUDE_BIN = join(await tempDir(), 'no-such-binary');
    const root = await tempDir();
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root));
    const final = await settled(root, run);
    expect(final.status).toBe('failed');
    expect(final.note).toContain('wrote no report');
  });

  it('does not need the results folder to exist first', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'engineering', 'todo'), { recursive: true });
    await writeFile(join(root, 'engineering', 'todo', 'E-010.md'), '---\nid: E-010\n---\nx\n', 'utf8');
    const { instance } = runner(root);
    const { run } = await instance.dispatch(input(root));
    expect((await settled(root, run)).status).toBe('success');
  });
});
