// app.js – v1 Editor (ES module, no dependencies)

// ---------- Utility ----------
const load = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw Error(`Failed to load ${url}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
};

const build = (node) => {
  if (node.fragment) {
    const frag = document.createDocumentFragment();
    node.children.forEach(child => frag.appendChild(build(child)));
    return frag;
  }
  const el = document.createElement(node.tag);
  if (node.attrs) {
    Object.entries(node.attrs).forEach(([k, v]) => el.setAttribute(k, v));
  }
  if (node.children) {
    node.children.forEach(child => el.appendChild(build(child)));
  }
  return el;
};

const escape = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- Plugin system ----------
const plug = {};
const register = (plugin) => { plug[plugin.mode] = plugin; };

// ---- Built‑in: Text ----
register({
  mode: 'txt', name: 'Text',
  start: () => ({}),
  line: (line) => [{ kind: 'text', span: line }],
  block: () => ({ kind: 'para' }),
  render: (text) => `<pre>${escape(text)}</pre>`
});

// ---- Built‑in: Markdown (stateful) ----
register({
  mode: 'md', name: 'Markdown',
  start: () => ({ fence: false, list: null }),
  line: (line, ctx) => {
    const tokens = [];
    if (line.startsWith('```')) {
      ctx.fence = !ctx.fence;
      tokens.push({ kind: 'marker', span: '```' });
      if (line.length > 3) tokens.push({ kind: 'text', span: line.slice(3) });
      return tokens;
    }
    if (ctx.fence) {
      tokens.push({ kind: 'text', span: line });
      return tokens;
    }
    // Heading
    if (/^#{1,6}\s/.test(line)) {
      const m = line.match(/^(#{1,6})\s(.*)/);
      if (m) {
        tokens.push({ kind: 'marker', span: m[1] + ' ' });
        tokens.push({ kind: 'text', span: m[2] });
        return tokens;
      }
    }
    // Unordered list
    if (/^\s*[-*+]\s/.test(line)) {
      const m = line.match(/^(\s*)([-*+])\s(.*)/);
      if (m) {
        tokens.push({ kind: 'marker', span: m[1] + m[2] + ' ' });
        tokens.push({ kind: 'text', span: m[3] });
        return tokens;
      }
    }
    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      const m = line.match(/^(\s*\d+\.)\s(.*)/);
      if (m) {
        tokens.push({ kind: 'marker', span: m[1] + ' ' });
        tokens.push({ kind: 'text', span: m[2] });
        return tokens;
      }
    }
    // Blockquote
    if (/^>\s/.test(line)) {
      const m = line.match(/^>\s(.*)/);
      if (m) {
        tokens.push({ kind: 'marker', span: '> ' });
        tokens.push({ kind: 'text', span: m[1] });
        return tokens;
      }
    }
    tokens.push({ kind: 'text', span: line });
    return tokens;
  },
  block: (ctx) => {
    if (ctx.fence) return { kind: 'codeblock' };
    return { kind: 'para' };
  },
  render: (text) => {
    let html = escape(text);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    html = html.replace(/^#{1,6}\s(.*)$/gm, (line) => {
      const level = line.match(/^(#{1,6})/)[1].length;
      const content = line.replace(/^#{1,6}\s/, '');
      return `<h${level}>${content}</h${level}>`;
    });
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    // Unordered list
    html = html.replace(/^\s*[-*+]\s(.*)$/gm, '<li>$1</li>');
    html = html.replace(/((<li>.*?<\/li>\s*)+)/g, '<ul>$1</ul>');
    // Ordered list
    html = html.replace(/^\s*\d+\.\s(.*)$/gm, '<li>$1</li>');
    html = html.replace(/((<li>.*?<\/li>\s*)+)/g, (match) => {
      if (match.includes('<ul>')) return match;
      return `<ol>${match}</ol>`;
    });
    html = html.replace(/^>\s(.*)$/gm, '<blockquote>$1</blockquote>');
    return html;
  }
});

// ---- Built‑in: HTML, CSS, JS (simplified) ----
['html', 'css', 'js'].forEach(mode => {
  register({
    mode, name: mode.toUpperCase(),
    start: () => ({}),
    line: (line) => [{ kind: 'text', span: line }],
    block: () => ({ kind: 'para' }),
    render: (text) => {
      if (mode === 'html') return text;
      if (mode === 'css') return `<style>${text}</style>`;
      if (mode === 'js') return `<script>${text}</script>`;
    }
  });
});

// ---------- Undo / Redo commands ----------
class Insert {
  constructor(off, text) { this.off = off; this.text = text; }
  apply(doc) { return doc.slice(0, this.off) + this.text + doc.slice(this.off); }
  undo(doc) { return doc.slice(0, this.off) + doc.slice(this.off + this.text.length); }
}
class Delete {
  constructor(off, text) { this.off = off; this.text = text; }
  apply(doc) { return doc.slice(0, this.off) + doc.slice(this.off + this.text.length); }
  undo(doc) { return doc.slice(0, this.off) + this.text + doc.slice(this.off); }
}

class History {
  constructor() { this.stack = []; this.idx = -1; }
  push(cmd) { this.stack = this.stack.slice(0, this.idx + 1); this.stack.push(cmd); this.idx++; }
  undo() { if (this.idx < 0) return null; return this.stack[this.idx--]; }
  redo() { if (this.idx >= this.stack.length - 1) return null; return this.stack[++this.idx]; }
}

// ---------- Store ----------
class Store {
  #state; #subs;
  constructor() {
    this.#state = { tabs: [], active: null, docs: [], theme: 'light' };
    this.#subs = [];
  }
  get tabs()  { return this.#state.tabs; }
  get active() { return this.#state.active; }
  get docs()  { return this.#state.docs; }
  get theme() { return this.#state.theme; }
  subscribe(fn) { this.#subs.push(fn); }
  dispatch(action, data) {
    switch (action) {
      case 'tabs': this.#state.tabs = data; break;
      case 'active': this.#state.active = data; break;
      case 'docs': this.#state.docs = data; break;
      case 'theme':
        this.#state.theme = data;
        document.documentElement.classList.toggle('dark', data === 'dark');
        break;
      case 'doc': {
        const { id, text } = data;
        const doc = this.#state.docs.find(d => d.id === id);
        if (doc) doc.text = text;
        break;
      }
    }
    this.#persist(action);
    this.#notify(action);
  }
  #notify(action) { this.#subs.forEach(fn => fn(action, this.#state)); }
  #persist(action) {
    if (action === 'tabs' || action === 'active') {
      localStorage.setItem('tabs', JSON.stringify(this.#state.tabs));
      if (action === 'active') localStorage.setItem('active', this.#state.active);
    }
    if (action === 'docs') {
      localStorage.setItem('docs', JSON.stringify(
        this.#state.docs.map(d => ({ id: d.id, name: d.name, mode: d.mode, stamp: d.stamp }))
      ));
    }
    if (action === 'theme') localStorage.setItem('theme', this.#state.theme);
  }
  load() {
    const tabs = JSON.parse(localStorage.getItem('tabs') || '[]');
    const active = localStorage.getItem('active') || null;
    const docs = JSON.parse(localStorage.getItem('docs') || '[]');
    const theme = localStorage.getItem('theme') || 'light';
    this.#state = { tabs, active, docs, theme };
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
  text(id) { return localStorage.getItem(`doc:${id}`) || ''; }
  save(id, text) { localStorage.setItem(`doc:${id}`, text); }
}

// ---------- Head (toolbar + tabs) ----------
class Head {
  constructor(store, el) {
    this.store = store;
    this.el = el;
    this.render();
    store.subscribe(() => this.render());
    this.bind();
  }
  render() {
    const { tabs, active } = this.store;
    this.el.querySelector('.tabs').innerHTML = tabs.map(id => {
      const doc = this.store.docs.find(d => d.id === id);
      const name = doc ? doc.name : id;
      return `<span class="tab${id === active ? ' active' : ''}" data-id="${id}">${name}</span>`;
    }).join('');
  }
  bind() {
    this.el.querySelector('.tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      this.store.dispatch('active', tab.dataset.id);
    });
    this.el.querySelector('.actions').innerHTML = `
      <button data-action="new">New</button>
      <button data-action="theme">Theme</button>
    `;
    this.el.querySelector('.actions').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.action === 'new') this.newDoc();
      else if (btn.dataset.action === 'theme') this.toggleTheme();
    });
  }
  newDoc() {
    const id = 'doc_' + Date.now();
    const doc = { id, name: 'untitled', mode: 'md', stamp: Date.now() };
    this.store.dispatch('docs', [...this.store.docs, doc]);
    this.store.save(id, '');
    this.store.dispatch('tabs', [...this.store.tabs, id]);
    this.store.dispatch('active', id);
  }
  toggleTheme() {
    this.store.dispatch('theme', this.store.theme === 'dark' ? 'light' : 'dark');
  }
}

// ---------- List (left sidebar – file inventory) ----------
class List {
  constructor(store, el) {
    this.store = store;
    this.el = el;
    this.render();
    store.subscribe(() => this.render());
    this.bind();
  }
  render() {
    this.el.innerHTML = this.store.docs.map(d => `
      <div class="file" data-id="${d.id}">
        <span>${d.name}</span>
        <span class="mode">${d.mode}</span>
      </div>
    `).join('');
  }
  bind() {
    this.el.addEventListener('click', (e) => {
      const file = e.target.closest('.file');
      if (!file) return;
      const id = file.dataset.id;
      if (!this.store.tabs.includes(id)) {
        this.store.dispatch('tabs', [...this.store.tabs, id]);
      }
      this.store.dispatch('active', id);
    });
  }
}

// ---------- Edit (virtualised editor) ----------
class Edit {
  #store; #doc; #lines; #heights; #scroll; #gutter; #textarea;
  #history; #parser; #cursor; #pool; #sentinel; #caret;
  #focused = false; #composing = false; #composeStartText = '';
  #cursors = new Map();

  constructor(store, main) {
    this.#store = store;
    this.#gutter = main.querySelector('.gutter');
    this.#scroll = main.querySelector('.content');
    this.#textarea = this.#makeTextarea();
    this.#scroll.appendChild(this.#textarea);
    this.#pool = []; this.#heights = []; this.#lines = [];
    this.#cursor = { line: 0, col: 0 };
    this.#history = new History();
    this.#sentinel = document.createElement('div');
    this.#sentinel.className = 'sentinel';
    this.#scroll.appendChild(this.#sentinel);

    this.#caret = document.createElement('span');
    this.#caret.className = 'caret';
    this.#caret.style.cssText = 'position:absolute;width:2px;height:24px;background:var(--text);display:none;pointer-events:none;z-index:2;';
    this.#scroll.appendChild(this.#caret);

    this.#scroll.addEventListener('scroll', () => this.#render());
    this.#scroll.addEventListener('mousedown', (e) => this.#onMouseDown(e));
    this.#textarea.addEventListener('keydown', (e) => this.#onKey(e));

    // Use scroll container for focus tracking (not the invisible textarea)
    this.#scroll.addEventListener('focusin', () => { this.#focused = true; this.#showCaret(); });
    this.#scroll.addEventListener('focusout', () => { this.#focused = false; this.#hideCaret(); });

    this.#textarea.addEventListener('compositionstart', () => {
      this.#composing = true;
      this.#composeStartText = this.#lines[this.#cursor.line] || '';
    });
    this.#textarea.addEventListener('compositionend', (e) => {
      this.#composing = false;
      const composed = e.data || '';
      const { line, col } = this.#cursor;
      const oldLine = this.#composeStartText;
      if (composed !== oldLine) {
        const startOff = this.#offsetFromLineCol(line, 0);
        this.#applyCommand(new Delete(startOff, oldLine));
        this.#applyCommand(new Insert(startOff, composed));
        this.#setCursor(line, composed.length);
      }
    });

    store.subscribe((action) => {
      if (action === 'active' || action === 'docs') this.refresh();
    });
  }

  #makeTextarea() {
    const ta = document.createElement('textarea');
    ta.style.cssText = 'position:absolute;opacity:0;width:1px;height:1px;left:0;top:0;z-index:1;';
    return ta;
  }

  refresh() {
    const id = this.#store.active;
    if (!id) return;
    const doc = this.#store.docs.find(d => d.id === id);
    if (!doc) return;
    this.#doc = doc;
    const text = this.#store.text(id);
    this.#lines = text.split('\n');
    this.#heights = new Array(this.#lines.length).fill(24);
    this.#history = new History();
    this.#parser = {
      plugin: plug[doc.mode] || plug.txt,
      ctx: (plug[doc.mode] || plug.txt).start()
    };
    const saved = this.#cursors.get(id);
    this.#cursor = saved ? { line: saved.line, col: saved.col } : { line: 0, col: 0 };
    if (this.#cursor.line >= this.#lines.length) this.#cursor.line = Math.max(0, this.#lines.length - 1);
    if (this.#cursor.col > (this.#lines[this.#cursor.line] || '').length) this.#cursor.col = (this.#lines[this.#cursor.line] || '').length;

    this.#clearPool();
    this.#render();
    this.#setCursor(this.#cursor.line, this.#cursor.col);
    this.#textarea.focus();
  }

  #clearPool() { this.#pool.forEach(el => el.remove()); this.#pool = []; }

  #render() {
    const st = this.#scroll.scrollTop, vh = this.#scroll.clientHeight;
    let start = 0, end = 0, acc = 0;
    for (let i = 0; i < this.#lines.length; i++) {
      if (acc + (this.#heights[i] || 24) > st) { start = i; break; }
      acc += this.#heights[i] || 24;
    }
    acc = 0;
    for (let i = start; i < this.#lines.length; i++) {
      acc += this.#heights[i] || 24;
      if (acc > vh + 200) { end = i; break; }
      if (i === this.#lines.length - 1) end = i;
    }
    this.#clearPool();
    const gf = document.createDocumentFragment();
    for (let i = start; i <= end; i++) {
      const n = document.createElement('div');
      n.textContent = i + 1;
      n.style.height = (this.#heights[i] || 24) + 'px';
      n.style.lineHeight = (this.#heights[i] || 24) + 'px';
      gf.appendChild(n);
    }
    this.#gutter.innerHTML = ''; this.#gutter.appendChild(gf);

    const frag = document.createDocumentFragment();
    for (let i = start; i <= end; i++) {
      const le = document.createElement('div');
      le.className = 'line';
      le.style.top = this.#offset(i) + 'px';
      le.dataset.line = i;
      const bk = this.#detectBlockKind(i);
      if (bk) le.classList.add(bk);
      const ts = document.createElement('span');
      ts.className = 'text';
      this.#tokenizeLine(i).forEach(tok => {
        const sp = document.createElement('span');
        sp.className = tok.kind;
        sp.textContent = tok.span;
        ts.appendChild(sp);
      });
      le.appendChild(ts);
      frag.appendChild(le);
      this.#pool.push(le);
    }
    this.#scroll.appendChild(frag);
    this.#sentinel.style.height = this.#offset(this.#lines.length) + 'px';
    if (this.#focused) this.#showCaret();
  }

  #offset(until) { let o = 0; for (let i = 0; i < until; i++) o += this.#heights[i] || 24; return o; }
  #offsetFromLineCol(l, c) { let o = 0; for (let i = 0; i < l; i++) o += this.#lines[i].length + 1; return o + c; }
  #lineColFromOffset(off) {
    let l = 0, c = 0, a = 0;
    while (l < this.#lines.length) {
      const len = this.#lines[l].length;
      if (a + len >= off) { c = off - a; break; }
      a += len + 1; l++;
    }
    if (l >= this.#lines.length) { l = this.#lines.length - 1; c = this.#lines[l].length; }
    return { line: l, col: Math.min(c, this.#lines[l].length) };
  }
  #tokenizeLine(i) {
    const p = this.#parser.plugin, ctx = p.start();
    for (let j = 0; j < i; j++) p.line(this.#lines[j], ctx);
    return p.line(this.#lines[i], ctx);
  }
  #detectBlockKind(i) {
    const line = this.#lines[i] || '';
    if (/^```/.test(line)) return 'codeblock';
    if (/^#{1,6}\s/.test(line)) return 'heading';
    if (/^\s*[-*+]\s/.test(line)) return 'list-block';
    if (/^\s*\d+\.\s/.test(line)) return 'list-block';
    if (/^>\s/.test(line)) return 'quote';
    return 'para';
  }

  // ---------- Click ----------
#onMouseDown(e) {
  // Keep the browser from stealing focus from the hidden textarea
  e.preventDefault();

  const le = e.target.closest('.line');
  if (!le) return;
  const line = parseInt(le.dataset.line, 10);
  const ts = le.querySelector('.text');
  if (!ts) { this.#setCursor(line, 0); this.#showCaret(); return; }

  const cp = document.caretPositionFromPoint(e.clientX, e.clientY);
  if (cp) {
    let node = cp.offsetNode;
    while (node && node !== ts) node = node.parentNode;
    if (node === ts) {
      let col = 0;
      const w = document.createTreeWalker(ts, NodeFilter.SHOW_TEXT);
      let n = w.nextNode();
      while (n && n !== cp.offsetNode) { col += n.textContent.length; n = w.nextNode(); }
      if (n === cp.offsetNode) col += cp.offset;
      this.#setCursor(line, Math.min(col, (this.#lines[line] || '').length));
      this.#showCaret();
      return;
    }
  }

  // Fallback
  const rect = ts.getBoundingClientRect();
  const cw = 9.6;
  const col = Math.max(0, Math.round((e.clientX - rect.left) / cw));
  this.#setCursor(line, Math.min(col, (this.#lines[line] || '').length));
  this.#showCaret();
}

  #focus() {
    this.#focused = true;
    this.#textarea.focus();
    this.#showCaret();
  }

  // ---------- Cursor ----------
  #setCursor(line, col) {
    this.#cursor = { line, col };
    this.#textarea.value = this.#lines[line] || '';
    this.#textarea.setSelectionRange(col, col);
    if (this.#doc) this.#cursors.set(this.#doc.id, { line, col });
    if (this.#focused) this.#showCaret();
  }
  #showCaret() {
    if (!this.#doc) return;
    const { line, col } = this.#cursor;
    const le = this.#pool.find(el => parseInt(el.dataset.line) === line);
    if (!le) { this.#caret.style.display = 'none'; return; }
    const ts = le.querySelector('.text');
    if (!ts) { this.#caret.style.display = 'none'; return; }
    const bl = ts.offsetLeft;
    let x = 0, cur = 0;
    for (const ch of ts.children) {
      const len = ch.textContent.length;
      if (cur + len > col) {
        const r = document.createRange();
        const tn = ch.firstChild;
        if (tn) { r.setStart(tn, 0); r.setEnd(tn, col - cur); }
        x += r.getBoundingClientRect().width;
        break;
      } else { x += ch.getBoundingClientRect().width; cur += len; }
    }
    this.#caret.style.display = 'block';
    this.#caret.style.left = (bl + x) + 'px';
    this.#caret.style.top = le.style.top;
    this.#caret.style.height = (this.#heights[line] || 24) + 'px';
  }
  #hideCaret() { this.#caret.style.display = 'none'; }

  // ---------- Keyboard ----------
  #onKey(e) {
    if (this.#composing) return;
    const { line, col } = this.#cursor;
    const k = e.key;
    if (k === 'ArrowUp') { e.preventDefault(); if (line > 0) this.#setCursor(line - 1, Math.min(col, (this.#lines[line-1] || '').length)); }
    else if (k === 'ArrowDown') { e.preventDefault(); if (line < this.#lines.length - 1) this.#setCursor(line + 1, Math.min(col, (this.#lines[line+1] || '').length)); }
    else if (k === 'ArrowLeft') { e.preventDefault(); if (col > 0) this.#setCursor(line, col - 1); else if (line > 0) this.#setCursor(line - 1, (this.#lines[line-1] || '').length); }
    else if (k === 'ArrowRight') { e.preventDefault(); if (col < (this.#lines[line] || '').length) this.#setCursor(line, col + 1); else if (line < this.#lines.length - 1) this.#setCursor(line + 1, 0); }
    else if (k === 'Home') { e.preventDefault(); this.#setCursor(line, 0); }
    else if (k === 'End') { e.preventDefault(); this.#setCursor(line, (this.#lines[line] || '').length); }
    else if (k === 'Backspace') {
      e.preventDefault();
      if (col > 0) {
        const off = this.#offsetFromLineCol(line, col - 1);
        this.#applyCommand(new Delete(off, this.#doc.text.charAt(off)));
        this.#setCursor(line, col - 1);
      } else if (line > 0) {
        const prevLen = this.#lines[line - 1].length;
        this.#applyCommand(new Delete(this.#offsetFromLineCol(line - 1, prevLen), '\n'));
        this.#setCursor(line - 1, prevLen);
      }
    } else if (k === 'Delete') {
      e.preventDefault();
      if (col < (this.#lines[line] || '').length) {
        const off = this.#offsetFromLineCol(line, col);
        this.#applyCommand(new Delete(off, this.#doc.text.charAt(off)));
        this.#setCursor(line, col);
      } else if (line < this.#lines.length - 1) {
        this.#applyCommand(new Delete(this.#offsetFromLineCol(line, this.#lines[line].length), '\n'));
        this.#setCursor(line, col);
      }
    } else if (k === 'Enter') {
      e.preventDefault();
      this.#applyCommand(new Insert(this.#offsetFromLineCol(line, col), '\n'));
      this.#setCursor(line + 1, 0);
    } else if (k === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.#undo(); }
    else if (k === 'y' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.#redo(); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      this.#applyCommand(new Insert(this.#offsetFromLineCol(line, col), k));
      this.#setCursor(line, col + 1);
    }
  }

  #applyCommand(cmd) {
    const old = this.#store.text(this.#doc.id);
    const nxt = cmd.apply(old);
    this.#store.save(this.#doc.id, nxt);
    this.#doc.text = nxt;
    this.#lines = nxt.split('\n');
    this.#heights = new Array(this.#lines.length).fill(24);
    this.#history.push(cmd);
    this.#store.dispatch('doc', { id: this.#doc.id, text: nxt });
    this.#render();
  }
  #undo() {
    const cmd = this.#history.undo();
    if (!cmd) return;
    const nxt = cmd.undo(this.#store.text(this.#doc.id));
    this.#store.save(this.#doc.id, nxt);
    this.#doc.text = nxt;
    this.#lines = nxt.split('\n');
    this.#heights = new Array(this.#lines.length).fill(24);
    this.#store.dispatch('doc', { id: this.#doc.id, text: nxt });
    this.#render();
    const { line, col } = this.#lineColFromOffset(cmd.off);
    this.#setCursor(line, col);
  }
  #redo() {
    const cmd = this.#history.redo();
    if (!cmd) return;
    const nxt = cmd.apply(this.#store.text(this.#doc.id));
    this.#store.save(this.#doc.id, nxt);
    this.#doc.text = nxt;
    this.#lines = nxt.split('\n');
    this.#heights = new Array(this.#lines.length).fill(24);
    this.#store.dispatch('doc', { id: this.#doc.id, text: nxt });
    this.#render();
    const { line, col } = this.#lineColFromOffset(cmd.off + cmd.text.length);
    this.#setCursor(line, col);
  }
}

// ---------- View (preview) ----------
class View {
  constructor(store, iframe) {
    this.store = store;
    this.iframe = iframe;
    store.subscribe((action) => {
      if (action === 'active' || action === 'docs' || action === 'doc') this.update();
    });
    this.update();
  }
  update() {
    const id = this.store.active;
    if (!id) return;
    const doc = this.store.docs.find(d => d.id === id);
    if (!doc) return;
    const text = this.store.text(id);
    const plugin = plug[doc.mode] || plug.txt;
    this.iframe.srcdoc = plugin.render(text);
  }
}

// ---------- Foot ----------
class Foot {
  constructor(store, el) {
    this.store = store;
    this.el = el;
    store.subscribe(() => this.render());
    this.render();
  }
  render() {
    const mode = this.store.active
      ? (this.store.docs.find(d => d.id === this.store.active)?.mode || 'txt')
      : '-';
    this.el.textContent = `v1 Editor | Mode: ${mode}`;
  }
}

// ---------- Boot ----------
(async () => {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/worker.js'); } catch {}
  }
  const ui = await load('/ui.json');
  document.body.append(build(ui));
  const store = new Store();
  store.load();
  new Head(store, document.querySelector('body > header'));
  new List(store, document.querySelector('body > aside:first-of-type'));
  new Edit(store, document.querySelector('body > main'));
  new View(store, document.querySelector('body > aside:last-of-type > iframe'));
  new Foot(store, document.querySelector('body > footer'));
})();
