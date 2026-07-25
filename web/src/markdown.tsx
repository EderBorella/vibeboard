import { createElement, type ReactNode } from 'react';

// A tiny, dependency-free markdown renderer for the Project Control preview pane. Deliberately
// minimal: headings, bold/italic, inline code, fenced code, lists, links, blockquotes, hr,
// paragraphs.
//
// It returns React nodes, not an HTML string. Nothing is ever parsed as HTML, so source markup
// cannot reach the DOM and no escaping step is needed — React escapes text by construction.

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
// http/https/mailto/relative only; anything else (javascript:, data:) becomes '#'.
const SAFE_HREF = /^(https?:|mailto:|\/|#|\.)/i;
// Alternatives in precedence order: bold before italic so ** wins, and the lookbehind stops a
// lone * inside ** from opening an italic span.
const SPAN = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|(?<!\*)\*([^*]+)\*/;

// One pass, so a code span's contents are emitted verbatim and never re-scanned for emphasis.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest !== '') {
    const m = SPAN.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const [, code, label, href, bold, italic] = m;
    const k = key++;
    if (code !== undefined) out.push(<code key={k}>{code}</code>);
    else if (label !== undefined)
      out.push(
        <a key={k} href={SAFE_HREF.test(href) ? href : '#'} target="_blank" rel="noopener noreferrer">
          {label}
        </a>,
      );
    else if (bold !== undefined) out.push(<strong key={k}>{bold}</strong>);
    else out.push(<em key={k}>{italic}</em>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

// What a single line is, decided before anything is emitted. Keeping the grammar separate from
// the emitting keeps both readable — the loop below becomes one case per block kind.
type Block =
  | { kind: 'fence' }
  | { kind: 'blank' }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'hr' }
  | { kind: 'quote'; text: string }
  | { kind: 'item'; list: 'ul' | 'ol'; text: string }
  | { kind: 'para'; text: string };

function classify(line: string): Block {
  const trimmed = line.trim();
  if (trimmed.startsWith('```')) return { kind: 'fence' };
  if (trimmed === '') return { kind: 'blank' };
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading) return { kind: 'heading', level: heading[1].length, text: heading[2] };
  if (/^(---|\*\*\*|___)\s*$/.test(trimmed)) return { kind: 'hr' };
  if (trimmed.startsWith('>')) return { kind: 'quote', text: trimmed.replace(/^>\s?/, '') };
  const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
  if (ul) return { kind: 'item', list: 'ul', text: ul[1] };
  const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
  if (ol) return { kind: 'item', list: 'ol', text: ol[1] };
  return { kind: 'para', text: trimmed };
}

export function renderMarkdown(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let key = 0;
  let para: string[] = [];
  let items: ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let code: string[] | null = null; // non-null while inside a fence

  const k = (): number => key++;
  const flushPara = (): void => {
    if (para.length) {
      out.push(<p key={k()}>{inline(para.join(' '))}</p>);
      para = [];
    }
  };
  const flushList = (): void => {
    if (listType) {
      out.push(listType === 'ul' ? <ul key={k()}>{items}</ul> : <ol key={k()}>{items}</ol>);
      items = [];
      listType = null;
    }
  };
  const flushCode = (): void => {
    if (code) {
      out.push(
        <pre key={k()}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      code = null;
    }
  };

  const flushBlocks = (): void => {
    flushPara();
    flushList();
  };

  for (const line of lines) {
    // Inside a fence every line is literal until the closing ```.
    if (code) {
      if (line.trim().startsWith('```')) flushCode();
      else code.push(line);
      continue;
    }

    const block = classify(line);
    switch (block.kind) {
      case 'fence':
        flushBlocks();
        code = [];
        break;
      case 'blank':
        flushBlocks();
        break;
      case 'heading':
        flushBlocks();
        out.push(createElement(HEADINGS[block.level - 1], { key: k() }, inline(block.text)));
        break;
      case 'hr':
        flushBlocks();
        out.push(<hr key={k()} />);
        break;
      case 'quote':
        flushBlocks();
        out.push(<blockquote key={k()}>{inline(block.text)}</blockquote>);
        break;
      case 'item':
        flushPara();
        if (listType && listType !== block.list) flushList();
        listType = block.list;
        items.push(<li key={k()}>{inline(block.text)}</li>);
        break;
      case 'para':
        flushList();
        para.push(block.text);
        break;
    }
  }

  flushCode();
  flushPara();
  flushList();
  return out;
}
