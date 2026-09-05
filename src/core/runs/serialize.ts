import matter from 'gray-matter';
import type { RunRecord } from './types.js';

// The order a run file is written in: identity, then state, then what was asked, then what came back.
// A run file is something a human reads in a diff.
//
// Named rather than inline because these lists ARE the set of fields that persist: a field on the
// interface and absent from here is one `serializeRun` silently never writes, so it would round-trip as
// gone. The exhaustiveness check below turns that into a typecheck failure, and `RUN_RECORD_KEYS` lets
// test/mirror.test.ts hold the web mirror to the same set.
// `fault` and `forgiven` sit beside `status` deliberately: all three answer "how did this end, and does
// it count", and a reader scanning a diff for why a card is blocked should find them together.
const IDENTITY_KEYS = [
  'run',
  'card',
  'board',
  'skill',
  'status',
  'fault',
  'forgiven',
  'outcome',
  'resolved',
] as const;
const DETAIL_KEYS = [
  'started',
  'finished',
  'previous',
  'backend',
  'model',
  'effort',
  'mode',
  'prompt',
  'attached',
  'summary',
  'options',
  'created',
  'covered',
  'note',
  'usage',
  'suggestions',
  'pgid',
  'pgstart',
  'filesChanged',
  // Last, and in this order: what the run answered, then what was decided about it. A run file is
  // read in a diff, and the verdict is the thing you look for at the bottom.
  'verdict',
  'verification',
] as const;

export const RUN_RECORD_KEYS = [...IDENTITY_KEYS, ...DETAIL_KEYS, 'report'] as const;

// A field on `RunRecord` that no list above names. `never` when every one is covered; otherwise this
// line fails to compile and names the field that would not persist.
type Unwritten = Exclude<keyof RunRecord, (typeof RUN_RECORD_KEYS)[number]>;
const _everyFieldIsWritten: Unwritten extends never ? true : Unwritten = true;
void _everyFieldIsWritten;

export function serializeRun(record: RunRecord): string {
  const { report, ...front } = record;
  const data: Record<string, unknown> = {};
  for (const key of IDENTITY_KEYS) {
    if (front[key] !== undefined) data[key] = front[key];
  }
  for (const key of DETAIL_KEYS) {
    if (front[key] !== undefined) data[key] = front[key];
  }
  return matter.stringify(`${report}\n`, data);
}
