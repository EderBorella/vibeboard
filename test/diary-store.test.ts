import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIARY_HEADER, type DiaryEntry } from '../src/core/diary.js';
import { PROJECT_LOG_FILE } from '../src/core/layout.js';
import { appendEntry, diaryPath, readDiary } from '../src/server/diary-store.js';
import { tempDir } from './helpers.js';

// Append-only, and that is the property worth defending rather than asserting once. Everything else in
// this project can be re-derived — the board from its folders, a run's cost from its record, what changed
// from git — but the narrative cannot. A write that replaces instead of appending loses it silently.

const entry = (over: Partial<DiaryEntry> = {}): DiaryEntry => ({
  at: '2026-08-05T10:04:00.000Z',
  kind: 'lifecycle',
  text: 'something happened',
  ...over,
});

describe('the diary on disk', () => {
  it('is empty for a project that has never had one', async () => {
    expect(await readDiary(await tempDir())).toEqual([]);
  });

  it('creates the file with its heading on the first append', async () => {
    const root = await tempDir();
    await appendEntry(root, entry({ text: 'first' }));
    const raw = await readFile(diaryPath(root), 'utf8');
    expect(raw.startsWith(DIARY_HEADER)).toBe(true);
    expect((await readDiary(root)).map((e) => e.text)).toEqual(['first']);
  });

  it('appends rather than replacing, and writes the heading exactly once', async () => {
    const root = await tempDir();
    for (const text of ['one', 'two', 'three']) await appendEntry(root, entry({ text }));
    const raw = await readFile(diaryPath(root), 'utf8');
    expect(raw.match(/^# /gm)).toHaveLength(1);
    expect((await readDiary(root)).map((e) => e.text)).toEqual(['one', 'two', 'three']);
  });

  // What this test does NOT constrain, established by planting the defect: the append queue. Removing it
  // leaves this green, because `appendFile` opens with `O_APPEND` and the kernel makes a write this small
  // atomic — so nothing is lost and no line is torn even with fifty in flight. It is still worth having:
  // it pins that the store never drops an event under load, which is the claim a reader would assume.
  //
  // The queue is constrained by the ORDER test below, which is what it actually buys.
  it('loses nothing when fifty appends are started at once', async () => {
    const root = await tempDir();
    const texts = Array.from({ length: 50 }, (_, i) => `entry ${i}`);
    await Promise.all(texts.map((text) => appendEntry(root, entry({ text }))));

    const read = await readDiary(root);
    expect(read).toHaveLength(50);
    expect(new Set(read.map((e) => e.text)).size).toBe(50);
    // Every written line parsed, so none was written into the middle of another. Counted from the raw
    // file rather than from `readDiary`, which would not notice a line it could not read.
    const raw = await readFile(diaryPath(root), 'utf8');
    expect(raw.split('\n').filter((l) => l.startsWith('- ')).length).toBe(50);
  });

  // THE test for the queue, and the reason the queue exists. `O_APPEND` guarantees each write lands
  // whole; it guarantees nothing about which lands first. Without serialising, twenty appends started
  // together arrive interleaved — measured, not assumed: with the queue removed this comes back as
  // `entry 0, entry 3, …`. The diary IS the sequence, so a checkup reading it out of order would see a
  // project circling that was not, or miss one that was.
  it('keeps appends in the order they were made', async () => {
    const root = await tempDir();
    const texts = Array.from({ length: 20 }, (_, i) => `entry ${i}`);
    await Promise.all(texts.map((text) => appendEntry(root, entry({ text }))));
    expect((await readDiary(root)).map((e) => e.text)).toEqual(texts);
  });

  it('survives prose somebody added by hand', async () => {
    const root = await tempDir();
    await appendEntry(root, entry({ text: 'before' }));
    await appendFile(diaryPath(root), '\nSome thoughts I typed here.\n', 'utf8');
    await appendEntry(root, entry({ text: 'after' }));
    expect((await readDiary(root)).map((e) => e.text)).toEqual(['before', 'after']);
    // And the note is still there — this file belongs to the person as much as to the machine.
    expect(await readFile(diaryPath(root), 'utf8')).toContain('Some thoughts I typed here.');
  });

  // A diary written without a trailing newline would make the next append continue the previous line,
  // turning two events into one unparseable one.
  it('ends every line, so the next append starts a new one', async () => {
    const root = await tempDir();
    await appendEntry(root, entry({ text: 'one' }));
    expect((await readFile(diaryPath(root), 'utf8')).endsWith('\n')).toBe(true);
  });

  it('writes inside the project and nowhere else', () => {
    expect(diaryPath('/tmp/p')).toBe(join('/tmp/p', PROJECT_LOG_FILE));
  });
});
