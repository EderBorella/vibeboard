import { describe, expect, it } from 'vitest';
import { parseCardContent, serializeCard } from '../src/core/card.js';
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
