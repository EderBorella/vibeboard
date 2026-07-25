// A tiny, dependency-free markdown→HTML renderer for the Project Control preview pane.
// It is deliberately minimal (headings, bold/italic, inline code, fenced code, lists, links,
// blockquotes, hr, paragraphs). It escapes ALL input first, so the output is safe to inject —
// no raw HTML from the file survives into the DOM.

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Inline spans, applied to already-escaped text. Order matters: code first so its contents
// aren't re-processed, then links, then emphasis.
function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
      // Only allow safe-looking hrefs (http/https/mailto/relative); drop anything else.
      const safe = /^(https?:|mailto:|\/|#|\.)/i.test(href) ? href : '#';
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

export function renderMarkdown(src: string): string {
  const lines = escapeHtml(src.replace(/\r\n/g, '\n')).split('\n');
  const out: string[] = [];
  let i = 0;
  let inCode = false;
  let codeBuf: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const flushList = (): void => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${codeBuf.join('\n')}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushPara();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(---|\*\*\*|___)\s*$/.test(line.trim())) {
      flushPara();
      flushList();
      out.push('<hr>');
      continue;
    }

    if (line.trim().startsWith('&gt;')) {
      flushPara();
      flushList();
      out.push(`<blockquote>${inline(line.trim().replace(/^&gt;\s?/, ''))}</blockquote>`);
      continue;
    }

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const want: 'ul' | 'ol' = ul ? 'ul' : 'ol';
      if (listType && listType !== want) flushList();
      if (!listType) {
        out.push(`<${want}>`);
        listType = want;
      }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
      continue;
    }

    flushList();
    para.push(line.trim());
  }

  if (inCode) out.push(`<pre><code>${codeBuf.join('\n')}</code></pre>`);
  flushPara();
  flushList();
  return out.join('\n');
}
