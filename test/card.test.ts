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
    const { data, body } = parseCardContent(content);
    expect(data.id).toBe('E-010');
    expect(data.tags).toEqual(['backend']);
    expect(data.links).toEqual(['P-001']);
    expect(body).toBe('Body text here.');
  });

  it('applies safe defaults for missing optional fields', () => {
    const { data } = parseCardContent('---\nid: P-001\ntitle: x\ncreated: 2026-07-23\n---\n');
    expect(data.order).toBe(0);
    expect(data.tags).toEqual([]);
    expect(data.links).toEqual([]);
    expect(data.description).toBeUndefined();
  });

  // A hand-written or truncated file. These three are strings everywhere downstream, so the
  // reader must not let undefined reach the board.
  it('falls back to empty strings when the identity fields are missing', () => {
    const { data } = parseCardContent('---\norder: 20\n---\n\nbody\n');
    expect(data.id).toBe('');
    expect(data.title).toBe('');
    expect(data.created).toBe('');
  });

  it('round-trips a full card through serialize then parse', () => {
    const out = serializeCard(fm, 'The body.');
    const { data, body } = parseCardContent(out);
    expect(data).toEqual(fm);
    expect(body).toBe('The body.');
  });
});
