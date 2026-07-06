// markdown.js — a small, dependency-free renderer for lesson markdown.
// Supports what lessons actually use: headings, paragraphs, bold/italic/inline
// code, links, ordered/unordered lists, tables, blockquotes, fenced code, hr.
// All input is HTML-escaped before any markdown transforms, so lesson content
// can't inject markup.

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// Front matter: an optional leading block delimited by --- lines with key: value pairs.
// Returns { meta, body }. Unknown keys are kept; absent front matter → empty meta.
export function parseFrontMatter(md) {
  const meta = {};
  if (!md.startsWith('---')) return { meta, body: md };
  const end = md.indexOf('\n---', 3);
  if (end === -1) return { meta, body: md };
  for (const line of md.slice(3, end).split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/);
    if (m) meta[m[1]] = m[2];
  }
  return { meta, body: md.slice(end + 4).replace(/^\n+/, '') };
}

export function renderMarkdown(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  let list = null; // 'ul' | 'ol'

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // fenced code
    if (/^```/.test(line)) {
      closeList();
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(esc(lines[i])); i += 1; }
      i += 1;
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      continue;
    }

    // table: header row + |---| separator
    if (/^\|.*\|$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      closeList();
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(esc(c.trim())));
      out.push('<table><thead><tr>' + cells(line).map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>');
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        out.push('<tr>' + cells(lines[i]).map((c) => `<td>${c}</td>`).join('') + '</tr>');
        i += 1;
      }
      out.push('</tbody></table>');
      continue;
    }

    // heading
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(esc(h[2]))}</h${level}>`);
      i += 1;
      continue;
    }

    // hr
    if (/^(-{3,}|\*{3,})$/.test(line)) { closeList(); out.push('<hr />'); i += 1; continue; }

    // blockquote
    if (/^>\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(inline(esc(lines[i].trim().replace(/^>\s?/, ''))));
        i += 1;
      }
      out.push(`<blockquote>${buf.join('<br />')}</blockquote>`);
      continue;
    }

    // lists
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline(esc((ul || ol)[1]))}</li>`);
      i += 1;
      continue;
    }

    // blank line
    if (line === '') { closeList(); i += 1; continue; }

    // paragraph — merge consecutive plain lines
    closeList();
    const buf = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (next === '' || /^(#{1,4}\s|>|```|\||[-*]\s|\d+[.)]\s|-{3,}$)/.test(next)) break;
      buf.push(next);
      i += 1;
    }
    out.push(`<p>${inline(esc(buf.join(' ')))}</p>`);
  }
  closeList();
  return out.join('\n');
}
