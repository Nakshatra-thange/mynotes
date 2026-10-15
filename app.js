(() => {
  const $ = s => document.querySelector(s);
  const editor = $('#editor'), items = $('#items'), wrap = $('.editor-wrap');
  const KEY = 'notes.v1';

  /* ---------- tiny markdown → html (for notes/*.md) ---------- */
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = s => esc(s)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
  function md(src) {
    const L = src.split('\n'); let out = '', i = 0;
    while (i < L.length) {
      const l = L[i];
      let m;
      if (!l.trim()) { i++; continue; }
      if ((m = l.match(/^(#{1,3})\s+(.*)/))) { out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; i++; continue; }
      if (/^\s*-\s+\[[ xX]\]/.test(l)) {
        out += '<ul class="check">';
        while (i < L.length && (m = L[i].match(/^\s*-\s+\[([ xX])\]\s*(.*)/))) { out += `<li${m[1] !== ' ' ? ' class="done"' : ''}>${inline(m[2])}</li>`; i++; }
        out += '</ul>'; continue;
      }
      if (/^\s*[-*]\s+/.test(l)) {
        out += '<ul>'; while (i < L.length && (m = L[i].match(/^\s*[-*]\s+(.*)/))) { out += `<li>${inline(m[1])}</li>`; i++; } out += '</ul>'; continue;
      }
      if (/^\s*\d+\.\s+/.test(l)) {
        out += '<ol>'; while (i < L.length && (m = L[i].match(/^\s*\d+\.\s+(.*)/))) { out += `<li>${inline(m[1])}</li>`; i++; } out += '</ol>'; continue;
      }
      if (l.trim().startsWith('|')) {
        const rows = []; while (i < L.length && L[i].trim().startsWith('|')) rows.push(L[i++]);
        const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const body = rows.filter(r => !/^\s*\|?[\s:-]+\|[\s|:-]*$/.test(r));
        out += '<table>' + body.map((r, k) => '<tr>' + cells(r).map(c => `<${k ? 'td' : 'th'}>${inline(c)}</${k ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</table>'; continue;
      }
      out += `<p>${inline(l)}</p>`; i++;
    }
    return out;
  }

  /* ---------- state ---------- */
  let store = { notes: {} };           // id -> {html, date, pinned, deleted}
  try { store = JSON.parse(localStorage.getItem(KEY)) || store; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { alert('Storage is full — try smaller photos.'); } };

  const fileNotes = (window.NOTES_DATA || []).map(n => ({ id: n.id, date: n.date, pinned: n.pinned, html: md(n.md) }));
  function all() {
    const map = new Map(fileNotes.map(n => [n.id, { ...n }]));
    for (const [id, o] of Object.entries(store.notes)) map.set(id, { ...(map.get(id) || { id }), ...o });
    return [...map.values()].filter(n => !n.deleted);
  }
  let currentId = null, q = '';
  const text = html => { const d = document.createElement('div'); d.innerHTML = html; return d; };
  function lines(n) {
    const d = text(n.html); d.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
    d.querySelectorAll('h1,h2,h3,p,div,li,tr').forEach(e => e.append('\n'));
    d.querySelectorAll('td,th').forEach(e => e.append(' '));
    const t = d.textContent.split('\n').map(s => s.trim()).filter(Boolean);
    return { title: t[0] || 'New Note', preview: t[1] || 'No additional text', all: t.join(' ') };
  }

  /* ---------- list ---------- */
  const fmtShort = d => {
    const dt = new Date(d), now = new Date(), days = (new Date(now.toDateString()) - new Date(dt.toDateString())) / 864e5;
    if (days <= 0) return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (days < 7) return dt.toLocaleDateString([], { weekday: 'long' });
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };
  function label(n) {
    if (n.pinned) return '📌 Pinned';
    const dt = new Date(n.date), now = new Date(), days = (new Date(now.toDateString()) - new Date(dt.toDateString())) / 864e5;
    if (days <= 0) return 'Today'; if (days < 7) return 'Previous 7 Days'; if (days < 30) return 'Previous 30 Days';
    return dt.getFullYear() === now.getFullYear() ? dt.toLocaleDateString([], { month: 'long' }) : String(dt.getFullYear());
  }
  function renderList() {
    let list = all();
    $('#count').textContent = list.length;
    $('#subcount').textContent = list.length + (list.length === 1 ? ' note' : ' notes');
    if (q) list = list.filter(n => lines(n).all.toLowerCase().includes(q));
    list.sort((a, b) => (b.pinned - a.pinned) || (new Date(b.date) - new Date(a.date)));
    let html = '', last = '';
    for (const n of list) {
      const lb = label(n), l = lines(n);
      if (lb !== last) { html += `<div class="group-label">${lb}</div>`; last = lb; }
      html += `<div class="item${n.id === currentId ? ' sel' : ''}" data-id="${n.id}"><div class="t">${esc(l.title)}</div><div class="m"><span>${fmtShort(n.date)}</span><span>${esc(l.preview)}</span></div></div>`;
    }
    items.innerHTML = html || '<div class="none">No notes</div>';
  }

  /* ---------- open / create ---------- */
  function open(id) {
    currentId = id;
    const n = all().find(x => x.id === id);
    wrap.classList.toggle('blank', !n);
    if (n) {
      editor.innerHTML = n.html;
      $('#date').textContent = new Date(n.date).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
      document.querySelector('[data-cmd=pin]').classList.toggle('on', !!n.pinned);
      document.body.classList.add('reading');
    }
    renderList();
  }
  function create() {
    const id = 'local:' + Date.now();
    store.notes[id] = { html: '<h1><br></h1>', date: new Date().toISOString() }; save();
    open(id); q = ''; $('#search').value = ''; renderList();
    editor.focus(); const r = document.createRange(); r.selectNodeContents(editor.firstChild); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  let t;
  function persist() {
    if (!currentId) return;
    const base = all().find(n => n.id === currentId) || {};
    store.notes[currentId] = { ...(store.notes[currentId] || {}), html: editor.innerHTML, date: new Date().toISOString(), pinned: base.pinned };
    clearTimeout(t); t = setTimeout(() => { save(); renderList(); }, 250);
  }

  /* ---------- editing helpers ---------- */
  const cmd = (c, v) => { editor.focus(); document.execCommand(c, false, v); persist(); };
  function checklist() {
    editor.focus();
    const sel = getSelection(); let node = sel.anchorNode; node = node && (node.nodeType === 3 ? node.parentNode : node);
    const li = node && node.closest && node.closest('ul.check li');
    if (li) { document.execCommand('insertUnorderedList'); }
    else { document.execCommand('insertHTML', false, '<ul class="check"><li><br></li></ul>'); }
    persist();
  }
  function table() {
    const cell = '<td><br></td>', row = `<tr>${cell.repeat(3)}</tr>`;
    cmd('insertHTML', `<table><tr>${'<th><br></th>'.repeat(3)}</tr>${row}${row}</table><p><br></p>`);
  }
  function shrink(file) {
    return new Promise(res => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 1200, k = Math.min(1, max / img.width), c = document.createElement('canvas');
          c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', .85));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  async function addImages(files) {
    for (const f of files) if (f.type.startsWith('image/')) cmd('insertHTML', `<img src="${await shrink(f)}"><p><br></p>`);
  }

  /* ---------- events ---------- */
  items.addEventListener('click', e => { const it = e.target.closest('.item'); if (it) open(it.dataset.id); });
  $('#newBtn').onclick = create;
  $('#backBtn').onclick = () => document.body.classList.remove('reading');
  $('#search').oninput = e => { q = e.target.value.toLowerCase().trim(); renderList(); };
  editor.addEventListener('input', persist);

  editor.addEventListener('click', e => {      // toggle checklist circles
    const li = e.target.closest && e.target.closest('ul.check li');
    if (li && e.target === li && e.offsetX < 26) { li.classList.toggle('done'); persist(); }
  });
  editor.addEventListener('keydown', e => {
    if (e.key === 'Enter') setTimeout(() => { const n = getSelection().anchorNode; const li = n && (n.nodeType === 3 ? n.parentNode : n).closest('li'); if (li && li.parentNode.classList.contains('check')) li.classList.remove('done'); });
    if (e.key === 'Tab') {
      const n = getSelection().anchorNode, td = n && (n.nodeType === 3 ? n.parentNode : n).closest('td,th');
      if (td) {
        e.preventDefault();
        const cells = [...td.closest('table').querySelectorAll('td,th')], idx = cells.indexOf(td) + (e.shiftKey ? -1 : 1);
        if (idx >= cells.length) { const r = td.closest('tr').cloneNode(true); r.querySelectorAll('td,th').forEach(c => c.innerHTML = '<br>'); td.closest('table').append(r); }
        const next = cells[idx] || td.closest('table').lastChild.firstChild;
        if (next) { const r = document.createRange(); r.selectNodeContents(next); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); }
      }
    }
  });
  editor.addEventListener('paste', e => {
    const imgs = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'));
    if (imgs.length) { e.preventDefault(); addImages(imgs); return; }
    e.preventDefault();                         // paste as plain text to keep notes clean
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
  editor.addEventListener('drop', e => { if (e.dataTransfer.files.length) { e.preventDefault(); addImages(e.dataTransfer.files); } });

  const menu = $('#fmtMenu');
  document.addEventListener('click', e => { if (!e.target.closest('[data-cmd=format]') && !e.target.closest('.menu')) menu.classList.remove('open'); });
  menu.addEventListener('click', e => {
    const f = e.target.closest('[data-fmt]')?.dataset.fmt; if (!f) return;
    if (/^h\d$|^p$/.test(f)) cmd('formatBlock', f);
    else if (f === 'ul') cmd('insertUnorderedList'); else if (f === 'ol') cmd('insertOrderedList'); else cmd(f);
    menu.classList.remove('open');
  });
  document.querySelector('.toolbar').addEventListener('click', e => {
    const c = e.target.closest('[data-cmd]')?.dataset.cmd; if (!c) return;
    if (c === 'format') menu.classList.toggle('open');
    if (c === 'check') checklist();
    if (c === 'table') table();
    if (c === 'photo') $('#file').click();
    if (c === 'pin') { const n = all().find(x => x.id === currentId); if (n) { store.notes[currentId] = { ...(store.notes[currentId] || {}), html: editor.innerHTML, date: n.date, pinned: !n.pinned }; save(); open(currentId); } }
    if (c === 'delete' && currentId && confirm('Delete this note?')) {
      if (currentId.startsWith('local:')) delete store.notes[currentId]; else store.notes[currentId] = { deleted: true };
      save(); const rest = all().sort((a, b) => b.pinned - a.pinned || new Date(b.date) - new Date(a.date)); document.body.classList.remove('reading'); open(rest[0]?.id || null);
    }
  });
  $('#file').onchange = e => { addImages(e.target.files); e.target.value = ''; };

  document.addEventListener('keydown', e => {
    const typing = document.activeElement === editor || document.activeElement.tagName === 'INPUT';
    if (!typing && e.key === 'n') { e.preventDefault(); create(); }
    if (!typing && e.key === '/') { e.preventDefault(); $('#search').focus(); }
  });

  /* ---------- boot ---------- */
  const first = all().sort((a, b) => b.pinned - a.pinned || new Date(b.date) - new Date(a.date))[0];
  open(first ? first.id : null);
  document.body.classList.remove('reading');
})();
