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
