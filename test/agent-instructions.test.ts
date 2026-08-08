import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VIBEBOARD_DOC } from '../src/core/scaffold.js';

// The two documents every agent turn sees: VIBEBOARD.md, written into the project and reached
// through the CLAUDE.md/AGENTS.md imports, and the shared mechanics prompt that agent-turn.ts
// appends to the system prompt for both backends.
//
// These must land before the filesystem sandbox does. Enforcement without the instructions means
// every existing skill tries a file write, is denied, and fails with no idea why.
const SHARED_PROMPT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/server/copilot-system-prompt.md'),
  'utf8',
);

describe.each([
  ['VIBEBOARD.md', VIBEBOARD_DOC],
  ['the shared system prompt', SHARED_PROMPT],
])('%s', (_name, doc) => {
  // INVERTED, and deliberately. This document used to list the endpoints itself — a third copy of a
  // fact whose home is the RULES table in auth.ts, alongside two in run-prompt.ts. They disagreed:
  // granting a scope a new row told no agent anything, and the move route's payload key was wrong in
  // one copy for as long as it existed. The catalogue is now generated per scope into the credential
  // section, and this file must not grow a copy back.
  it('names no endpoints of its own, so there is one home for that fact', () => {
    for (const route of ['POST /api/cards', 'PATCH /api/cards', 'PUT /api/cards']) {
      expect(doc, route).not.toContain(route);
    }
  });

  it('points at the credential section instead', () => {
    // Substrings chosen to sit on one line: the source wraps at 100 columns, and an assertion that
    // spans a wrap silently never matches.
    expect(doc).toMatch(/list the exact endpoints/);
  });

  it('tells the agent how to present its credential', () => {
    expect(doc).toContain('Authorization: Bearer');
  });

  // A 403 read as a malfunction is the failure mode that undoes the whole boundary: the agent
  // shrugs and writes the file instead, which is exactly what it was denied permission to do.
  it('says a 403 is a limit, not a malfunction', () => {
    expect(doc).toContain('403');
  });

  it('forbids inventing a column, and says where the real ones are', () => {
    expect(doc.toLowerCase()).toContain('config.yaml');
    expect(doc).toMatch(/not configured|never name a column|never invent a column/i);
  });
});
