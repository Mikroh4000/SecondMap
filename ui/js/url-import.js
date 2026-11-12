// Creating nodes from URLs.

// ─── URL IMPORT ──────────────────────────────────────────────────
async function fetchUrlContent(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const contentType = resp.headers.get('content-type') || '';
    const text = await resp.text();
    if (contentType.includes('text/html')) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      doc.querySelectorAll('script, style, nav, footer, header, aside, iframe, noscript, svg').forEach(el => el.remove());
      const main = doc.querySelector('article') || doc.querySelector('main') || doc.querySelector('.content') || doc.body;
      const title = doc.querySelector('title')?.textContent?.trim() || '';
      let extracted = '';
      const walk = (node) => {
        if (node.nodeType === 3) extracted += node.textContent;
        else if (node.nodeType === 1) {
          const tag = node.tagName.toLowerCase();
          if (['p','div','br','h1','h2','h3','h4','h5','h6','li','tr'].includes(tag)) extracted += '\n';
          if (['h1','h2','h3','h4','h5','h6'].includes(tag)) extracted += '**';
          for (const child of node.childNodes) walk(child);
          if (['h1','h2','h3','h4','h5','h6'].includes(tag)) extracted += '**';
          if (['p','div','h1','h2','h3','h4','h5','h6','li'].includes(tag)) extracted += '\n';
        }
      };
      walk(main);
      extracted = extracted.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
      if (extracted.length > 2000) extracted = extracted.substring(0, 2000) + '\n\n... (gekürzt)';
      return { title, content: extracted, source: url };
    } else {
      let content = text.trim();
      if (content.length > 2000) content = content.substring(0, 2000) + '\n\n... (gekürzt)';
      return { title: url.split('/').pop() || 'Import', content, source: url };
    }
  } catch (err) { throw new Error(`Konnte URL nicht laden: ${err.message}`); }
}

function openUrlImportDialog() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="width:480px">
      <div class="modal-header">
        <div class="modal-title">Block aus URL erstellen</div>
        <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">URL eingeben</label>
          <input class="form-input" id="url-input" placeholder="https://example.com/article" autocomplete="off"/>
        </div>
        <div id="url-status" style="font-size:12px;font-family:var(--font-mono);color:var(--text2);min-height:20px"></div>
        <div style="font-size:11px;color:var(--text2);font-family:var(--font-mono);padding:8px;background:var(--bg);border-radius:6px;line-height:1.8;margin-top:12px">
          Hinweis: Funktioniert nur mit URLs, die CORS erlauben.<br>
          Der Text wird automatisch extrahiert (max. 2000 Zeichen).
        </div>
      </div>
      <div class="modal-footer">
        <button class="tb-btn" onclick="this.closest('.modal-backdrop').remove()">Abbrechen</button>
        <button class="tb-btn accent" id="url-fetch-btn">Laden & Block erstellen</button>
      </div>
    </div>
  `;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  const urlInput = backdrop.querySelector('#url-input');
  const statusEl = backdrop.querySelector('#url-status');
  const fetchBtn = backdrop.querySelector('#url-fetch-btn');
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchBtn.click(); });
  fetchBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) { statusEl.textContent = 'Bitte eine URL eingeben.'; statusEl.style.color = 'var(--danger)'; return; }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      statusEl.textContent = 'URL muss mit http:// oder https:// beginnen.'; statusEl.style.color = 'var(--danger)'; return;
    }
    statusEl.textContent = 'Lade Inhalt...'; statusEl.style.color = 'var(--accent)';
    fetchBtn.disabled = true; fetchBtn.textContent = 'Laden...';
    try {
      const result = await fetchUrlContent(url);
      backdrop.remove();
      const cx = canvasWrap.offsetWidth / 2, cy = canvasWrap.offsetHeight / 2;
      const wp = screenToWorld(cx, cy);
      await addNode(wp.x - 110 + (Math.random()-0.5)*150, wp.y - 40 + (Math.random()-0.5)*100, {
        title: result.title || 'URL Import',
        content: `Quelle: [${url}](${url})\n\n${result.content}`,
        skipEdit: true
      });
      showToast('Block aus URL erstellt', 'success');
    } catch (err) {
      statusEl.textContent = err.message; statusEl.style.color = 'var(--danger)';
      fetchBtn.disabled = false; fetchBtn.textContent = 'Laden & Block erstellen';
    }
  });
  document.body.appendChild(backdrop);
  setTimeout(() => urlInput.focus(), 50);
}
if ($('btn-import-url')) $('btn-import-url').addEventListener('click', openUrlImportDialog);
