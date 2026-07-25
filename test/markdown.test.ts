import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../web/src/markdown.js';

// Characterisation tests: these pin down what the renderer does today so the switch from an HTML
// string to React nodes can be proved behaviour-preserving rather than hoped to be.

describe('renderMarkdown blocks', () => {
  it('renders headings at every level', () => {
    expect(renderMarkdown('# One')).toContain('<h1>One</h1>');
    expect(renderMarkdown('### Three')).toContain('<h3>Three</h3>');
    expect(renderMarkdown('###### Six')).toContain('<h6>Six</h6>');
  });

  it('does not treat seven hashes as a heading', () => {
    expect(renderMarkdown('####### Seven')).not.toContain('<h7>');
  });

  it('joins consecutive lines into one paragraph, separated by a blank line', () => {
    expect(renderMarkdown('one\ntwo')).toBe('<p>one two</p>');
    expect(renderMarkdown('one\n\ntwo')).toBe('<p>one</p>\n<p>two</p>');
  });

  it('renders a horizontal rule for each marker form', () => {
    for (const rule of ['---', '***', '___']) expect(renderMarkdown(rule)).toContain('<hr>');
  });

  it('renders blockquotes, stripping the marker', () => {
    expect(renderMarkdown('> quoted')).toBe('<blockquote>quoted</blockquote>');
  });

  it('renders fenced code without processing its contents', () => {
    const out = renderMarkdown('```\nconst a = **1**;\n```');
    expect(out).toBe('<pre><code>const a = **1**;</code></pre>');
  });

  it('closes an unterminated fence at end of input', () => {
    expect(renderMarkdown('```\nunclosed')).toBe('<pre><code>unclosed</code></pre>');
  });

  it('renders unordered and ordered lists', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
  });

  it('starts a new list when the marker type changes', () => {
    const out = renderMarkdown('- a\n1. b');
    expect(out).toBe('<ul>\n<li>a</li>\n</ul>\n<ol>\n<li>b</li>\n</ol>');
  });

  it('accepts -, * and + as bullets', () => {
    for (const bullet of ['-', '*', '+']) expect(renderMarkdown(`${bullet} item`)).toContain('<li>item</li>');
  });
});

describe('renderMarkdown inline spans', () => {
  it('renders bold, italic and inline code', () => {
    expect(renderMarkdown('a **b** c')).toContain('<strong>b</strong>');
    expect(renderMarkdown('a *b* c')).toContain('<em>b</em>');
    expect(renderMarkdown('a `b` c')).toContain('<code>b</code>');
  });

  // Known bug: the chained replaces each run over the whole string, so emphasis inside an
  // already-emitted <code> still matches. it.fails flips to failing the moment this is fixed.
  it.fails('leaves inline code contents unformatted', () => {
    expect(renderMarkdown('`**not bold**`')).toContain('<code>**not bold**</code>');
  });

  it('renders links with target and rel, allowing safe schemes', () => {
    for (const href of ['https://x.test', 'http://x.test', 'mailto:a@b.test', '/rel', '#frag', './rel']) {
      expect(renderMarkdown(`[label](${href})`)).toContain(
        `<a href="${href}" target="_blank" rel="noopener noreferrer">label</a>`,
      );
    }
  });

  it('rewrites an unsafe href to # rather than dropping the link', () => {
    const out = renderMarkdown('[click](javascript:alert(1))');
    expect(out).toContain('href="#"');
    expect(out).not.toContain('javascript:');
  });
});

describe('renderMarkdown escaping', () => {
  it('escapes markup so no raw HTML from the source reaches the output', () => {
    const out = renderMarkdown('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes ampersands and double quotes', () => {
    expect(renderMarkdown('a & b')).toContain('&amp;');
    expect(renderMarkdown('say "hi"')).toContain('&quot;');
  });

  it('escapes markup inside fenced code too', () => {
    expect(renderMarkdown('```\n<b>x</b>\n```')).toBe('<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>');
  });

  it('normalises CRLF', () => {
    expect(renderMarkdown('one\r\n\r\ntwo')).toBe('<p>one</p>\n<p>two</p>');
  });
});
