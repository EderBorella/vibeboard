// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { renderMarkdown } from '../web/src/markdown.js';

// The same contract the string-based renderer was characterised against, now asserted on the DOM
// React produces. renderMarkdown returns nodes, so there is no HTML string to inspect.

afterEach(cleanup);

// Render into a wrapper and hand back the element whose children are the rendered markdown.
function md(src: string): HTMLElement {
  const { container } = render(<div data-testid="out">{renderMarkdown(src)}</div>);
  return container.querySelector('[data-testid="out"]') as HTMLElement;
}

describe('renderMarkdown blocks', () => {
  it('renders headings at every level', () => {
    expect(md('# One').querySelector('h1')?.textContent).toBe('One');
    expect(md('### Three').querySelector('h3')?.textContent).toBe('Three');
    expect(md('###### Six').querySelector('h6')?.textContent).toBe('Six');
  });

  it('does not treat seven hashes as a heading', () => {
    const out = md('####### Seven');
    expect(out.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    expect(out.querySelector('p')?.textContent).toBe('####### Seven');
  });

  it('joins consecutive lines into one paragraph, separated by a blank line', () => {
    expect([...md('one\ntwo').querySelectorAll('p')].map((p) => p.textContent)).toEqual(['one two']);
    expect([...md('one\n\ntwo').querySelectorAll('p')].map((p) => p.textContent)).toEqual(['one', 'two']);
  });

  it('renders a horizontal rule for each marker form', () => {
    for (const rule of ['---', '***', '___']) expect(md(rule).querySelector('hr')).not.toBeNull();
  });

  it('renders blockquotes, stripping the marker', () => {
    expect(md('> quoted').querySelector('blockquote')?.textContent).toBe('quoted');
  });

  it('renders fenced code without processing its contents', () => {
    const pre = md('```\nconst a = **1**;\n```').querySelector('pre > code');
    expect(pre?.textContent).toBe('const a = **1**;');
    expect(pre?.querySelector('strong')).toBeNull();
  });

  it('closes an unterminated fence at end of input', () => {
    expect(md('```\nunclosed').querySelector('pre > code')?.textContent).toBe('unclosed');
  });

  it('renders unordered and ordered lists', () => {
    const ul = md('- a\n- b');
    expect([...ul.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual(['a', 'b']);
    const ol = md('1. a\n2. b');
    expect([...ol.querySelectorAll('ol > li')].map((li) => li.textContent)).toEqual(['a', 'b']);
  });

  it('starts a new list when the marker type changes', () => {
    const out = md('- a\n1. b');
    expect([...out.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual(['a']);
    expect([...out.querySelectorAll('ol > li')].map((li) => li.textContent)).toEqual(['b']);
  });

  it('accepts -, * and + as bullets', () => {
    for (const bullet of ['-', '*', '+']) {
      expect(md(`${bullet} item`).querySelector('li')?.textContent).toBe('item');
    }
  });
});

describe('renderMarkdown inline spans', () => {
  it('renders bold, italic and inline code', () => {
    expect(md('a **b** c').querySelector('strong')?.textContent).toBe('b');
    expect(md('a *b* c').querySelector('em')?.textContent).toBe('b');
    expect(md('a `b` c').querySelector('code')?.textContent).toBe('b');
  });

  it('leaves inline code contents unformatted', () => {
    const code = md('`**not bold**`').querySelector('code');
    expect(code?.textContent).toBe('**not bold**');
    expect(code?.querySelector('strong')).toBeNull();
  });

  it('does not open an italic span inside bold markers', () => {
    expect(md('**a *b* c**').querySelector('em')?.textContent).toBe('b');
  });

  it('renders links with target and rel, allowing safe schemes', () => {
    for (const href of ['https://x.test', 'http://x.test', 'mailto:a@b.test', '/rel', '#frag', './rel']) {
      const a = md(`[label](${href})`).querySelector('a');
      expect(a?.getAttribute('href')).toBe(href);
      expect(a?.textContent).toBe('label');
      expect(a?.getAttribute('target')).toBe('_blank');
      expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('rewrites an unsafe href to # rather than dropping the link', () => {
    const a = md('[click](javascript:alert(1))').querySelector('a');
    expect(a?.getAttribute('href')).toBe('#');
  });
});

describe('renderMarkdown escaping', () => {
  it('never lets source markup become DOM', () => {
    const out = md('<script>alert(1)</script>');
    expect(out.querySelector('script')).toBeNull();
    // Present as text, which is the whole point: React made it a text node, not an element.
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
  });

  it('treats an img onerror payload as text', () => {
    const out = md('<img src=x onerror="alert(1)">');
    expect(out.querySelector('img')).toBeNull();
    expect(out.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('keeps ampersands and quotes as literal characters', () => {
    expect(md('a & b').textContent).toContain('a & b');
    expect(md('say "hi"').textContent).toContain('say "hi"');
  });

  it('does not process markup inside fenced code', () => {
    const out = md('```\n<b>x</b>\n```');
    expect(out.querySelector('pre > code')?.textContent).toBe('<b>x</b>');
    expect(out.querySelector('b')).toBeNull();
  });

  it('normalises CRLF', () => {
    expect([...md('one\r\n\r\ntwo').querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'one',
      'two',
    ]);
  });
});

// The grammar in classify() is all anchored regexes with explicit whitespace quantifiers, and
// every one of those pieces is load-bearing: a dropped anchor makes a line elsewhere match, and
// `\s+` collapsed to `\s` leaks whitespace into the captured text.
describe('renderMarkdown grammar edges', () => {
  it('eats all the space after the hashes, not just one', () => {
    expect(md('##   Spaced').querySelector('h2')?.textContent).toBe('Spaced');
  });

  it.each(['x---', '---x', '-- -', 'a***b'])('does not treat %p as a rule', (src) => {
    expect(md(src).querySelector('hr')).toBeNull();
  });

  it.each(['---', '***', '___', '---   ', '  ---  '])('treats %p as a rule', (src) => {
    expect(md(src).querySelector('hr')).not.toBeNull();
  });

  it('strips the marker from a quote with or without a following space', () => {
    expect(md('>tight').querySelector('blockquote')?.textContent).toBe('tight');
    expect(md('> loose').querySelector('blockquote')?.textContent).toBe('loose');
    expect(md('>  extra').querySelector('blockquote')?.textContent).toBe(' extra');
  });

  it('accepts an indented bullet and eats the whole gap after the marker', () => {
    expect(md('  - indented').querySelector('li')?.textContent).toBe('indented');
    expect(md('-   wide gap').querySelector('li')?.textContent).toBe('wide gap');
    expect(md('* star').querySelector('li')?.textContent).toBe('star');
    expect(md('+ plus').querySelector('li')?.textContent).toBe('plus');
  });

  it('numbers an ordered item with more than one digit', () => {
    const out = md('10. ten');
    expect(out.querySelector('ol')).not.toBeNull();
    expect(out.querySelector('li')?.textContent).toBe('ten');
  });

  it('eats the whole gap after an ordered marker, and keeps a multi-word tail', () => {
    expect(md('1.   spaced out').querySelector('li')?.textContent).toBe('spaced out');
    expect(md('  2. indented').querySelector('li')?.textContent).toBe('indented');
  });

  it('starts a new list when the marker kind changes', () => {
    const out = md('- a\n- b\n1. c\n2. d');
    expect(out.querySelectorAll('ul')).toHaveLength(1);
    expect(out.querySelectorAll('ol')).toHaveLength(1);
    expect([...out.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['a', 'b']);
    expect([...out.querySelectorAll('ol li')].map((li) => li.textContent)).toEqual(['c', 'd']);
  });

  it('opens a fence with an info string and closes one that is indented', () => {
    const out = md('```ts\nconst a = 1;\nconst b = 2;\n   ```\nafter');
    expect(out.querySelector('pre code')?.textContent).toBe('const a = 1;\nconst b = 2;');
    expect(out.querySelector('p')?.textContent).toBe('after');
  });

  it('opens a fence that is itself indented', () => {
    expect(md('   ```\nliteral\n```').querySelector('pre code')?.textContent).toBe('literal');
  });

  it('emits nothing but the block itself — no empty paragraph or list alongside it', () => {
    expect(md('# Only').children).toHaveLength(1);
    expect(md('---').children).toHaveLength(1);
    expect(md('- one').children).toHaveLength(1);
    expect(md('\n\n\n').children).toHaveLength(0);
  });

  it('renders no stray text nodes around a span that opens the line', () => {
    const out = md('**bold** tail');
    expect(out.querySelector('p')?.textContent).toBe('bold tail');
    expect(out.querySelector('strong')?.textContent).toBe('bold');
    // A span later in the line keeps the text before it.
    expect(md('pre **bold**').querySelector('p')?.textContent).toBe('pre bold');
  });

  it('joins a wrapped paragraph with single spaces and nothing else', () => {
    expect(md('one\ntwo\nthree').querySelector('p')?.textContent).toBe('one two three');
  });
});

describe('renderMarkdown anchoring and accumulator resets', () => {
  it('only starts an ordered item at the beginning of a line', () => {
    // An unanchored pattern would find "1." mid-sentence and turn prose into a list.
    expect(md('see 1. this').querySelector('ol')).toBeNull();
    expect(md('see 1. this').querySelector('p')?.textContent).toBe('see 1. this');
  });

  it('emits nothing beyond the blocks themselves', () => {
    // textContent, not querySelector: a seeded accumulator leaks as a bare text node that a
    // tag-based selector cannot see.
    expect(md('# Only').textContent).toBe('Only');
    expect(md('just a paragraph').textContent).toBe('just a paragraph');
    expect(md('- a\n- b\n1. c').textContent).toBe('abc');
  });

  it('starts the second list from empty after the first is flushed', () => {
    const out = md('- a\n1. b\n- c');
    expect([...out.querySelectorAll('ul, ol')].map((l) => l.textContent)).toEqual(['a', 'b', 'c']);
  });

  it('closes a fence on a line that opens with the marker even if more follows', () => {
    const out = md('```\ninside\n```ts\nafter');
    expect(out.querySelector('pre code')?.textContent).toBe('inside');
    expect(out.querySelector('p')?.textContent).toBe('after');
  });
});
