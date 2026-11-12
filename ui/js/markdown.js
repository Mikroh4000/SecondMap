// Markdown/LaTeX/Mermaid rendering for node bodies.

// ─── MARKDOWN RENDERER ───────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '<span style="color:var(--border2);font-style:italic">Kein Inhalt</span>';

  const placeholders = [];
  let phIdx = 0;

  // Extract fenced code blocks ```lang\ncode\n```
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const key = `__MDPH${phIdx++}__`;
    let highlighted;
    if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(code.trimEnd(), { language: lang }).value;
    } else if (typeof hljs !== 'undefined' && code.trim()) {
      highlighted = hljs.highlightAuto(code.trimEnd()).value;
    } else {
      highlighted = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    const langLabel = lang ? `<span class="code-lang-label">${lang}</span>` : '';
    placeholders.push(`<div class="code-block">${langLabel}<pre><code>${highlighted}</code></pre></div>`);
    return key;
  });

  // Extract mermaid blocks ```mermaid\n...\n```
  text = text.replace(/```mermaid\n([\s\S]*?)```/g, (_, diagram) => {
    const key = `__MDPH${phIdx++}__`;
    const id = 'mermaid-' + Date.now() + '-' + phIdx;
    placeholders.push(`<div class="mermaid-block" data-mermaid="${btoa(unescape(encodeURIComponent(diagram.trim())))}" id="${id}"></div>`);
    return key;
  });

  // Extract display LaTeX $$...$$
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, formula) => {
    const key = `__MDPH${phIdx++}__`;
    if (typeof katex !== 'undefined') {
      try { placeholders.push(`<div class="latex-block">${katex.renderToString(formula.trim(), { displayMode: true, throwOnError: false })}</div>`); }
      catch(e) { placeholders.push(`<div class="latex-block latex-error">${formula.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div>`); }
    } else { placeholders.push(`<div class="latex-block">$$${formula}$$</div>`); }
    return key;
  });

  // Extract inline LaTeX $...$
  text = text.replace(/\$([^\$\n]+?)\$/g, (_, formula) => {
    const key = `__MDPH${phIdx++}__`;
    if (typeof katex !== 'undefined') {
      try { placeholders.push(katex.renderToString(formula.trim(), { displayMode: false, throwOnError: false })); }
      catch(e) { placeholders.push(`<span class="latex-error">${formula.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</span>`); }
    } else { placeholders.push(`$${formula}$`); }
    return key;
  });

  // Extract tables (before HTML escaping)
  text = text.replace(/((?:^|\n)\|.+\|[ \t]*\n\|[\s\-:|]+\|[ \t]*\n(?:\|.+\|[ \t]*\n?)+)/g, (tableBlock) => {
    const key = `__MDPH${phIdx++}__`;
    const rows = tableBlock.trim().split('\n').filter(r => r.trim());
    if (rows.length < 2) { placeholders.push(tableBlock); return key; }
    const parseRow = r => r.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    const headers = parseRow(rows[0]);
    const aligns = parseRow(rows[1]).map(c => {
      if (/^:-+:$/.test(c)) return 'center';
      if (/^-+:$/.test(c)) return 'right';
      return 'left';
    });
    let tableHtml = '<table class="md-table"><thead><tr>';
    headers.forEach((h, i) => { tableHtml += `<th style="text-align:${aligns[i] || 'left'}">${h.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</th>`; });
    tableHtml += '</tr></thead><tbody>';
    for (let r = 2; r < rows.length; r++) {
      const cells = parseRow(rows[r]);
      tableHtml += '<tr>';
      cells.forEach((c, i) => { tableHtml += `<td style="text-align:${aligns[i] || 'left'}">${c.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</td>`; });
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table>';
    placeholders.push(tableHtml);
    return key;
  });

  // Standard markdown
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g, (_, alt, src) => `<img class="md-img" src="${src}" alt="${alt.replace(/"/g,'&quot;')}" loading="lazy" onclick="event.stopPropagation();window.open('${src}','_blank','noopener')"/>`)
    .replace(/!\[([^\]]*)\]\((data:[^\)]+)\)/g, (_, alt, src) => `<img class="md-img" src="${src}" alt="${alt.replace(/"/g,'&quot;')}" loading="lazy"/>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (_, l, u) => `<a href="${u}" data-url="${u}" onclick="openLink(event)">${l}</a>`)
    .replace(/\[([^\]]+)\]\((file:\/\/[^\)]+)\)/g, (_, l, u) => `<a href="${u}" data-url="${u}" onclick="openLink(event)">${l}</a>`)
    .replace(/(https?:\/\/[^\s<]+)/g, u => `<a href="${u}" data-url="${u}" onclick="openLink(event)">${u}</a>`);

  // Process line-based markdown (headings, lists, blockquotes, hr, checkboxes)
  html = html.split('\n').map(line => {
    // Headings
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) return `<h${hMatch[1].length} class="md-heading">${hMatch[2]}</h${hMatch[1].length}>`;
    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) return '<hr class="md-hr">';
    // Blockquote
    const bqMatch = line.match(/^&gt;\s?(.*)$/);
    if (bqMatch) return `<div class="md-blockquote">${bqMatch[1]}</div>`;
    // Checkbox list items
    const cbChecked = line.match(/^[\-\*]\s+\[x\]\s+(.+)$/i);
    if (cbChecked) return `<div class="md-li md-checkbox checked">☑ ${cbChecked[1]}</div>`;
    const cbUnchecked = line.match(/^[\-\*]\s+\[ \]\s+(.+)$/);
    if (cbUnchecked) return `<div class="md-li md-checkbox">☐ ${cbUnchecked[1]}</div>`;
    // Unordered list item
    const ulMatch = line.match(/^[\-\*]\s+(.+)$/);
    if (ulMatch) return `<div class="md-li">• ${ulMatch[1]}</div>`;
    // Ordered list item
    const olMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) return `<div class="md-li">${olMatch[1]}. ${olMatch[2]}</div>`;
    return line;
  }).join('<br>')
  // Collapse consecutive <br> between block elements
  .replace(/(<\/h[1-6]>|<hr class="md-hr">|<\/div>)<br>(<h[1-6]|<hr|<div class="md-)/g, '$1$2')
  .replace(/<br>(<h[1-6])/g, '$1')
  .replace(/(<\/h[1-6]>)<br>/g, '$1');

  // Restore placeholders
  for (let i = 0; i < placeholders.length; i++) {
    html = html.replace(`__MDPH${i}__`, placeholders[i]);
  }

  return html;
}

// Render mermaid diagrams after DOM insertion
function renderMermaidBlocks(root = document) {
  if (typeof mermaid === 'undefined') return;
  root.querySelectorAll('.mermaid-block[data-mermaid]').forEach(async el => {
    const code = decodeURIComponent(escape(atob(el.dataset.mermaid)));
    el.removeAttribute('data-mermaid');
    try {
      const { svg } = await mermaid.render(el.id + '-svg', code);
      el.innerHTML = svg;
    } catch(e) {
      el.innerHTML = `<pre class="mermaid-error">${code.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>`;
    }
  });
}

function openLink(e) { e.preventDefault(); e.stopPropagation(); const u = e.currentTarget.dataset.url; if (u) window.open(u, '_blank', 'noopener'); }
window.openLink = openLink;
