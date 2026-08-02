import { describe, expect, it } from 'vitest';
import { parseCardContent, pickCardPatch, serializeCard } from '../src/core/card.js';
import type { CardFrontmatter } from '../src/core/types.js';

const fm: CardFrontmatter = {
  id: 'E-010',
  title: 'Implement the file watcher',
  description: 'Chokidar-based watcher',
  order: 20,
  tags: ['backend', 'sync'],
  links: ['P-001'],
  group: 'sync-epic',
  created: '2026-07-23',
};

// These fixtures all parse; null means the fixture is broken, so fail loudly rather than
// asserting through a non-null cast at every use site.
function parse(content: string): { data: CardFrontmatter; body: string } {
  const parsed = parseCardContent(content);
  if (!parsed) throw new Error('fixture did not parse');
  return parsed;
}

describe('card parse/serialize', () => {
  it('parses frontmatter and trims the body', () => {
    const content = [
      '---',
      'id: E-010',
      'title: Implement the file watcher',
      'order: 20',
      'tags: [backend]',
      'links: [P-001]',
      'created: 2026-07-23',
      '---',
      '',
      'Body text here.',
      '',
    ].join('\n');
    const { data, body } = parse(content);
    expect(data.id).toBe('E-010');
    expect(data.tags).toEqual(['backend']);
    expect(data.links).toEqual(['P-001']);
    expect(body).toBe('Body text here.');
  });

  it('applies safe defaults for missing optional fields', () => {
    const { data } = parse('---\nid: P-001\ntitle: x\ncreated: 2026-07-23\n---\n');
    expect(data.order).toBe(0);
    expect(data.tags).toEqual([]);
    expect(data.links).toEqual([]);
    expect(data.description).toBeUndefined();
  });

  // A hand-written or truncated file. These three are strings everywhere downstream, so the
  // reader must not let undefined reach the board.
  it('falls back to empty strings when the identity fields are missing', () => {
    const { data } = parse('---\norder: 20\n---\n\nbody\n');
    expect(data.id).toBe('');
    expect(data.title).toBe('');
    expect(data.created).toBe('');
  });

  it('returns null for frontmatter that will not parse', () => {
    expect(parseCardContent('---\ntitle: "oops\n---\nbody\n')).toBeNull();
    expect(parseCardContent('---\nfoo: *undefined-alias\n---\n')).toBeNull();
  });

  // Called with one argument, gray-matter caches by input string — and after a throw it caches an
  // EMPTY result. So the second card with the same broken content parsed "successfully" as `{}`
  // and reached the board as a card with no id. Two copies of one bad template is all it takes.
  it('returns null every time for the same unparseable content, not just the first', () => {
    const broken = '---\ntitle: "oops\n---\nbody\n';
    expect(parseCardContent(broken)).toBeNull();
    expect(parseCardContent(broken)).toBeNull();
    expect(parseCardContent(broken)).toBeNull();
  });

  it('round-trips a full card through serialize then parse', () => {
    const out = serializeCard(fm, 'The body.');
    const { data, body } = parse(out);
    expect(data).toEqual(fm);
    expect(body).toBe('The body.');
  });
});

// The flag that marks the project-level barrier. A frontmatter key rather than a reserved id,
// because ids are derived and a recreated card would silently take the barrier with it.
describe('the setup flag', () => {
  it('round-trips when true, and is written only then', () => {
    expect(parse('---\nid: F-001\ntitle: Setup\nsetup: true\n---\nbody\n').data.setup).toBe(true);
    expect(parse('---\nid: F-002\ntitle: Other\n---\nbody\n').data.setup).toBeUndefined();
    // `setup: false` on every card in the project would be noise on every file in git.
    expect(serializeCard(fm, 'b')).not.toContain('setup');
    expect(serializeCard({ ...fm, setup: true }, 'b')).toContain('setup: true');
    expect(serializeCard({ ...fm, setup: undefined }, 'b')).not.toContain('setup');
  });

  // Anything but a real `true` is not the barrier. A card whose author wrote "no" must not become
  // the one thing the whole project waits on.
  it.each(['setup: false', 'setup: "true"', 'setup: no', 'setup: 1', 'setup:'])('ignores %s', (line) => {
    expect(parse(`---\nid: F-001\ntitle: Setup\n${line}\n---\nbody\n`).data.setup).toBeUndefined();
  });

  it('survives a parse and re-serialise, so an edit elsewhere does not drop it', () => {
    const first = serializeCard({ ...fm, id: 'F-001', setup: true }, 'The body.');
    const parsed = parse(first);
    expect(serializeCard({ ...parsed.data, title: 'Renamed' }, parsed.body)).toContain('setup: true');
  });
});

// PATCH takes only the five fields it is for, and a field with the right name and the wrong type is
// REFUSED rather than dropped — a 200 over an unchanged card tells the caller it worked.
describe('pickCardPatch', () => {
  it('takes the five fields it is for', () => {
    expect(pickCardPatch({ title: 'T', description: 'D', group: 'G', body: 'B', tags: ['a', 'b'] })).toEqual({
      patch: { title: 'T', description: 'D', group: 'G', body: 'B', tags: ['a', 'b'] },
      rejected: [],
    });
  });

  it('ignores the fields governed by something else, without calling them rejected', () => {
    // Not an error: these are legitimate frontmatter keys, just not this endpoint's business. `order`
    // is a drag, `links` are symmetric, `archived` has its own scope, `id` is identity, `setup` is
    // authority. Nothing to report — they simply are not part of a patch.
    const { patch, rejected } = pickCardPatch({
      title: 'T',
      id: 'E-999',
      order: 9999,
      links: ['P-404'],
      archived: '2026-08-02T00:00:00Z',
      setup: true,
    });
    expect(patch).toEqual({ title: 'T' });
    expect(rejected).toEqual([]);
  });

  it('rejects a field with the right name and the wrong type', () => {
    const { patch, rejected } = pickCardPatch({ title: 123, description: null, group: 7, body: { a: 1 } });
    expect(patch).toEqual({});
    expect(rejected).toEqual(['title', 'description', 'group', 'body']);
  });

  it('rejects tags that are not a list of strings, instead of coercing them', () => {
    // `String(t)` put "[object Object]" and "null" into card frontmatter and onto the board.
    expect(pickCardPatch({ tags: 'urgent' })).toEqual({ patch: {}, rejected: ['tags'] });
    const mixed = pickCardPatch({ tags: [1, { x: 2 }, null, 'real'] });
    expect(mixed.patch.tags).toEqual(['real']);
    expect(mixed.rejected).toEqual(['tags']);
  });

  it('treats an absent field as absent rather than as wrong', () => {
    expect(pickCardPatch({})).toEqual({ patch: {}, rejected: [] });
    expect(pickCardPatch(null)).toEqual({ patch: {}, rejected: [] });
    expect(pickCardPatch({ title: undefined })).toEqual({ patch: {}, rejected: [] });
  });

  it('allows clearing a field with an empty string', () => {
    expect(pickCardPatch({ description: '', tags: [] })).toEqual({
      patch: { description: '', tags: [] },
      rejected: [],
    });
  });
});
