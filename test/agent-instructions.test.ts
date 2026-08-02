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
  it('names the endpoints a credentialled agent must use', () => {
    expect(doc).toContain('POST /api/cards');
    expect(doc).toContain('PATCH /api/cards/:board/:id');
    expect(doc).toContain('PUT /api/cards/:board/:id/links');
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
