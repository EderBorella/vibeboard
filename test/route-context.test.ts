import type { FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectSession } from '../src/server/boards/session.js';
import { ensureOpen, nowIso, today } from '../src/server/route-context.js';

// ensureOpen is exercised through every route's 409 test, but only ever with BOTH root and config
// absent. Its own contract is narrower than that: it is a type predicate that must refuse when
// EITHER is missing, and must report false to its caller after replying.
const reply = (): FastifyReply & { sent: unknown[]; codes: number[] } => {
  const codes: number[] = [];
  const sent: unknown[] = [];
  const r = {
    codes,
    sent,
    code(c: number) {
      codes.push(c);
      return r;
    },
    send(body: unknown) {
      sent.push(body);
      return r;
    },
  };
  return r as unknown as FastifyReply & { sent: unknown[]; codes: number[] };
};

const session = (over: Partial<ProjectSession>): ProjectSession => over as ProjectSession;

describe('ensureOpen', () => {
  it('accepts a session with both a root and a config', () => {
    const r = reply();
    expect(ensureOpen(session({ root: '/p', config: { name: 'T' } as never }), r)).toBe(true);
    expect(r.codes).toEqual([]);
  });

  it.each([
    ['neither', {}],
    ['a root but no config', { root: '/p' }],
    ['a config but no root', { config: { name: 'T' } as never }],
    ['an empty root', { root: '', config: { name: 'T' } as never }],
  ])('refuses a session with %s', (_label, over) => {
    const r = reply();
    expect(ensureOpen(session(over), r)).toBe(false);
    expect(r.codes).toEqual([409]);
    expect(r.sent).toEqual([{ error: 'No project open' }]);
  });
});

describe('timestamps', () => {
  it('today is date-only', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('nowIso keeps full precision, so archived cards order within a day', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('today is the date half of nowIso', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T13:45:12.345Z'));
    expect(today()).toBe('2026-07-25');
    expect(nowIso()).toBe('2026-07-25T13:45:12.345Z');
    vi.useRealTimers();
  });
});
