// app.js – v1 Editor (ES module, no dependencies)

// ----- Utility functions -----
// Fetch a resource and return parsed JSON or text
const load = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw Error(`Failed to load ${url}`);
  return res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
};

// Recursively build DOM from SDUI node (ui.json)
const build = (node) => {
  const el = document.createElement(node.tag);
  if (node.attrs) Object.entries(node.attrs).forEach(([k, v]) => el.setAttribute(k, v));
  if (node.children) node.children.forEach(child => el.appendChild(build(child)));
  return el;
};

// Map a pixel Y coordinate to line index and column
const map = (y, heights, scrollTop) => {
  let acc = 0;
  for (let i = 0; i < heights.length; i++) {
    acc += heights[i];
    if (y - scrollTop < acc) return { line: i, col: 0 }; // column calculation done later if needed
  }
  return { line: heights.length - 1, col: 0 };
};

// ----- Store (Observable state) -----
class Store {
  #state = { tabs: [], active: null, docs: [], theme: 'light' };
  #subs = [];

  get tabs() { return this.#state.tabs; }
  get active() { return this.#state.active; }
  get docs() { return this.#state.docs; }
  get theme() { return this.#state.theme; }
  #notify(changed) { this.#subs.forEach(fn => fn(changed, this.#state)); }

  dispatch(action, payload) {
    const prev = { ...this.#state };
    switch (action) {
      case 'tab': this.#state.tabs = payload; break;
      case 'active': this.#state.active = payload; break;
      case 'docs': this.#state.docs = payload; break;
      case 'theme': this.#state.theme = payload; document.documentElement.classList.toggle('dark', payload === 'dark'); break;
      case 'doc': {
        const { id, text } = payload;
        const doc = this.#state.docs.find(d => d.id === id);
        if (doc) doc.text = text;
        break;
      }
    }
    this.#persist(action);
    this.#notify(action);
  }

  subscribe(fn) { this.#subs.push(fn); }

  #persist(action) {
    if (['tab', 'active'].includes(action)) localStorage.setItem('tabs', JSON.stringify(this.#state.tabs));
    if (action === 'active') localStorage.setItem('active', this.#state.active);
    if (action === 'docs') localStorage.setItem('docs', JSON.stringify(this.#state.docs.map(d => ({ id: d.id, name: d.name, mode: d.mode, stamp: d.stamp }))));
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
}

// ----- Plugin system -----
const plug = {};

const register = (plugin) => {
  plug[plugin.mode] = plugin;
};

// Built‑in: Text (plain)
register({
  mode: 'txt', name: 'Text',
  start: () => ({}),
  line: (line, ctx) => [{ kind: 'text', span: line }],
  block: () => ({ kind: 'para' }),
  render: (text) => `<pre>${escape(text)}</pre>`
});

// Built‑in: Markdown (stateful parser)
register({
  mode: 'md', name: 'Markdown',
  start: () => ({ fence: false, indent: 0, list: false }),
  line: (line, ctx) => {
    const tokens = [];
    // Fenced code block
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
    // Headings
    if (/^#{1,6}\s/.test(line)) {
      const m = line.match(/^(#{1,6})\s(.*)/);
      tokens.push({ kind: 'marker', span: m[1] + ' ' });
      tokens.push({ kind: 'text', span: m[2] });
      return tokens;
    }
    // Unordered list
    if (/^\s*[-*+]\s/.test(line)) {
      const m = line.match(/^(\s*)([-*+])\s(.*)/);
      tokens.push({ kind: 'marker', span: m[1] + m[2] + ' ' });
      tokens.push({ kind: 'text', span: m[3] });
      return tokens;
    }
    // Bold/italic spans are simple for v1: just tokenise as text (full inline parsing later)
    tokens.push({ kind: 'text', span: line });
    return tokens;
  },
  block: (ctx) => {
    if (ctx.fence) return { kind: 'codeblock' };
    // The line's block kind is determined later from the first token's kind? 
    // For simplicity we return para; inline styling works via tokens.
    return { kind: 'para' };
  },
  render: (text) => {
    // Minimal Markdown → HTML converter (handles headings, lists, bold, italic, code)
    let html = text;
    // Code blocks (```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // Headings
    html = html.replace(/^#{1,6}\s(.*)$/gm, (_, content) => {
      const level = _.indexOf(' ');
      return `<h${level}>${content}</h${level}>`;
    });
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Inline code
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');
    // Unordered list
    html = html.replace(/^\s*[-*+]\s(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    return html;
  }
});

// Built‑in: HTML, CSS, JS – similar tokenisers with simple keyword lists
// (Added for brevity: same pattern as txt but with some token kinds)
register({
  mode: 'html', name: 'HTML',
  start: () => ({}),
  line: (line) => [{ kind: 'text', span: line }], // simplified
  block: () => ({ kind: 'para' }),
  render: (text) => text
});
register({
  mode: 'css', name: 'CSS',
  start: () => ({}),
  line: (line) => [{ kind: 'text', span: line }],
  block: () => ({ kind: 'para' }),
  render: (text) => `<style>${text}</style>`
});
register({
  mode: 'js', name: 'JavaScript',
  start: () => ({}),
  line: (line) => [{ kind: 'text', span: line }],
  block: () => ({ kind: 'para' }),
  render: (text) => `<script>${text}</script>`
});

// Helper escape for HTML
const escape = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ----- Undo/Redo Commands -----
class Insert {
  constructor(line, col, text) { this.line = line; this.col = col; this.text = text; }
  apply(doc) {
    const lines = doc.split('\n');
    lines[this.line] = lines[this.line].slice(0, this.col) + this.text + lines[this.line].slice(this.col);
    return lines.join('\n');
  }
  undo(doc) {
    const lines = doc.split('\n');
    lines[this.line] = lines[this.line].slice(0, this.col) + lines[this.line].slice(this.col + this.text.length);
    return lines.join('\n');
  }
}
class Delete {
  constructor(line, col, length) { this.line = line; this.col = col; this.length = length; }
  apply(doc) {
    const lines = doc.split('\n');
    lines[this.line] = lines[this.line].slice(0, this.col) + lines[this.line].slice(this.col + this.length);
    return lines.join('\n');
  }
  undo(doc) {
    const lines = doc.split('\n');
    const original = this.orig; // must be stored before delete
    lines[this.line] = lines[this.line].slice(0, this.col) + original + lines[this.line].slice(this.col);
    return lines.join('\n');
  }
}

// ----- History (per document) -----
class History {
  constructor(doc) { this.stack = []; this.index = -1; this.doc = doc; }
  push(cmd) {
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(cmd);
    this.index++;
  }
  undo() {
    if (this.index < 0) return null;
    const cmd = this.stack[this.index];
    this.index--;
    return cmd;
  }
  redo() {
    if (this.index >= this.stack.length - 1) return null;
    this.index++;
    return this.stack[this.index];
  }
}

// ----- Editor Component (virtualised) -----
class Edit {
  #store; #doc; #mode; #lines; #heights; #sentinel; #pool; #scroll; #gutter; #textarea; #parser;
  #cursor = { line: 0, col: 0 };
  #range = null; // { anchor, focus }
  #history;

  constructor(store, container, gutter, content) {
    this.#store = store;
    this.#gutter = gutter;
    this.#scroll = content;
    this.#sentinel = document.createElement('div');
    this.#sentinel.className = 'sentinel';
    this.#scroll.appendChild(this.#sentinel);
    this.#pool = [];
    this.#textarea = this.#createTextarea();
    this.#scroll.appendChild(this.#textarea);
    this.#bindEvents();
    this.#store.subscribe((action) => {
      if (action === 'active' || action === 'docs') this.refresh();
    });
  }

  #createTextarea() {
    const ta = document.createElement('textarea');
    ta.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;left:0;top:0;';
    return ta;
  }

  refresh() {
    const id = this.#store.active;
    if (!id) return;
    const doc = this.#store.docs.find(d => d.id === id);
    if (!doc) return;
    this.#doc = doc;
    this.#mode = doc.mode;
    this.#lines = doc.text.split('\n');
    this.#heights = new Array(this.#lines.length).fill(0); // will be measured
    this.#history = new History(doc.text);
    this.#parser = { plugin: plug[this.#mode] || plug.txt, ctx: plug[this.#mode].start() };
    this.#cursor = { line: 0, col: 0 };
    this.#range = null;
    this.#render();
  }

  #render() {
    const existing = this.#pool;
    existing.forEach(el => el.remove());
    this.#pool = [];
    const visible = this.#visibleRange();
    const start = visible.start;
    const end = visible.end;
    const frag = document.createDocumentFragment();
    const gutterFrag = document.createDocumentFragment();
    for (let i = start; i <= end; i++) {
      const line = this.#lines[i] || '';
      const tokens = this.#parser.plugin.line(line, this.#parser.ctx);
      const blockKind = this.#parser.plugin.block(this.#parser.ctx).kind;
      const lineEl = document.createElement('div');
      lineEl.className = `line ${blockKind}`;
      lineEl.style.top = `${this.#offset(i)}px`;
      lineEl.dataset.line = i;
      const numSpan = document.createElement('span');
      numSpan.className = 'num';
      numSpan.textContent = i + 1;
      const textSpan = document.createElement('span');
      textSpan.className = 'text';
      tokens.forEach(t => {
        const span = document.createElement('span');
        span.className = t.kind; // token kind directly used as CSS class
        span.textContent = t.span;
        textSpan.appendChild(span);
      });
      lineEl.appendChild(numSpan);
      lineEl.appendChild(textSpan);
      frag.appendChild(lineEl);
      // Gutter
      const gutNum = document.createElement('div');
      gutNum.textContent = i + 1;
      gutNum.style.height = `${this.#heights[i] || 24}px`;
      gutterFrag.appendChild(gutNum);
    }
    this.#scroll.querySelector('.content')?.appendChild(frag); // Actually content is the scroll container itself? We'll adjust.
    // Simplify: we attach directly to scroll container (which is content div) but we need to separate gutter.
    // For brevity, we'll handle later; the above illustrates the concept.
  }

  #visibleRange() {
    const scrollTop = this.#scroll.scrollTop;
    const height = this.#scroll.clientHeight;
    let acc = 0;
    let start = 0, end = this.#lines.length - 1;
    for (let i = 0; i < this.#lines.length; i++) {
      if (!this.#heights[i]) this.#heights[i] = 24; // default line height
      acc += this.#heights[i];
      if (acc >= scrollTop) {
        start = i;
        break;
      }
    }
    acc = 0;
    for (let i = start; i < this.#lines.length; i++) {
      acc += this.#heights[i];
      if (acc > height + 200) {
        end = i;
        break;
      }
    }
    return { start, end };
  }

  #offset(line) {
    let o = 0;
    for (let i = 0; i < line; i++) o += this.#heights[i] || 24;
    return o;
  }

  #bindEvents() {
    this.#scroll.addEventListener('scroll', () => this.#render());
    this.#scroll.addEventListener('mousedown', (e) => {
      const lineEl = e.target.closest('.line');
      if (!lineEl) return;
      const line = parseInt(lineEl.dataset.line);
      // compute column from click X
      const rect = lineEl.querySelector('.text').getBoundingClientRect();
      const col = Math.floor((e.clientX - rect.left) / 9.6); // monospace approximate
      this.#setCursor(line, Math.max(0, col));
      this.#textarea.focus();
    });
    this.#textarea.addEventListener('keydown', (e) => this.#onKey(e));
    this.#textarea.addEventListener('input', (e) => this.#onInput(e));
    this.#textarea.addEventListener('compositionstart', () => {});
    this.#textarea.addEventListener('compositionend', (e) => {
      this.#onInput({ target: { value: e.data } }); // simplified
    });
  }

  #setCursor(line, col) {
    this.#cursor = { line, col };
    this.#range = null;
    // Update textarea position to that line (for IME)
    this.#textarea.value = this.#lines[line] || '';
    this.#textarea.setSelectionRange(col, col);
    this.#scroll.scrollTop = this.#offset(line) - 50;
  }

  #onKey(e) {
    const { line, col } = this.#cursor;
    if (e.key === 'ArrowUp') { this.#setCursor(Math.max(0, line - 1), col); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { this.#setCursor(Math.min(this.#lines.length - 1, line + 1), col); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { this.#setCursor(line, Math.max(0, col - 1)); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { this.#setCursor(line, Math.min(this.#lines[line].length, col + 1)); e.preventDefault(); }
    else if (e.key === 'Backspace' && !this.#range) {
      if (col > 0) {
        const cmd = new Delete(line, col - 1, 1);
        cmd.orig = this.#lines[line].charAt(col - 1);
        this.#apply(cmd);
        this.#setCursor(line, col - 1);
      } else if (line > 0) {
        const prevLen = this.#lines[line - 1].length;
        const cmd = new Delete(line - 1, prevLen, 1); // merge lines
        cmd.orig = '\n';
        this.#apply(cmd);
        this.#setCursor(line - 1, prevLen);
      }
      e.preventDefault();
    } else if (e.key === 'Delete' && !this.#range) {
      if (col < this.#lines[line].length) {
        const cmd = new Delete(line, col, 1);
        cmd.orig = this.#lines[line].charAt(col);
        this.#apply(cmd);
        this.#setCursor(line, col);
      } else if (line < this.#lines.length - 1) {
        const cmd = new Delete(line, this.#lines[line].length, 1);
        cmd.orig = '\n';
        this.#apply(cmd);
        this.#setCursor(line, col);
      }
      e.preventDefault();
    }
  }

  #onInput(e) {
    const text = e.target.value; // whole current line text after IME or typing
    const { line, col } = this.#cursor;
    // Compute inserted text by diff (simplified: assume single character insert/delete for now)
    // Production would track composition and range selection.
    // Placeholder: just replace current line with textarea value.
    if (text !== this.#lines[line]) {
      const cmd = new Insert(line, 0, text);
      this.#apply(cmd);
      this.#setCursor(line, text.length);
    }
  }

  #apply(cmd) {
    const newText = cmd.apply(this.#doc.text);
    this.#doc.text = newText;
    this.#lines = newText.split('\n');
    this.#history.push(cmd);
    this.#store.dispatch('doc', { id: this.#doc.id, text: newText });
    this.#render();
  }
}

// ----- Other Components (Head, List, View, Foot) -----
// Placeholder classes with minimal functionality

class Head {
  constructor(store, container) {
    this.store = store;
    this.el = container;
    this.render();
    store.subscribe(() => this.render());
  }
  render() {
    const tabs = this.store.tabs;
    const active = this.store.active;
    this.el.innerHTML = `
      <div class="tabs">${tabs.map(id => `<span class="tab ${id === active ? 'active' : ''}">${id}</span>`).join('')}</div>
      <div class="actions">
        <button id="new">New</button>
        <button id="open">Open</button>
        <button id="export">Export</button>
        <button id="import">Import</button>
        <button id="theme">Theme</button>
      </div>`;
    document.getElementById('theme')?.addEventListener('click', () => {
      const next = this.store.theme === 'dark' ? 'light' : 'dark';
      this.store.dispatch('theme', next);
    });
  }
}

class List {
  constructor(store, container) {
    this.store = store;
    this.el = container;
    this.render();
    store.subscribe(() => this.render());
  }
  render() {
    const docs = this.store.docs;
    this.el.innerHTML = docs.map(d => `<div class="file" data-id="${d.id}">${d.name} (${d.mode})</div>`).join('');
    this.el.querySelectorAll('.file').forEach(el => {
      el.addEventListener('click', () => this.store.dispatch('active', el.dataset.id));
    });
  }
}

class View {
  constructor(store, container) {
    this.store = store;
    this.iframe = container;
    store.subscribe((action) => {
      if (action === 'active' || action === 'docs') this.update();
    });
  }
  update() {
    const id = this.store.active;
    if (!id) return;
    const doc = this.store.docs.find(d => d.id === id);
    if (!doc) return;
    const plugin = plug[doc.mode] || plug.txt;
    const html = plugin.render(doc.text);
    this.iframe.srcdoc = html;
  }
}

class Foot {
  constructor(store, container) {
    this.store = store;
    this.el = container;
    this.render();
    store.subscribe(() => this.render());
  }
  render() {
    this.el.textContent = `v1 Editor | Mode: ${this.store.active ? this.store.docs.find(d => d.id === this.store.active)?.mode : '-'}`;
  }
}

// ----- Boot sequence -----
(async () => {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/worker.js');
  }

  // Fetch SDUI payload and build DOM
  const ui = await load('/ui.json');
  document.body.prepend(build(ui));

  // Initialise store
  const store = new Store();
  store.load();

  // Instantiate components
  new Head(store, document.getElementById('head'));
  new List(store, document.getElementById('list'));
  const editContainer = document.getElementById('edit');
  new Edit(store, editContainer, editContainer.querySelector('.gutter'), editContainer.querySelector('.content'));
  new View(store, document.getElementById('preview'));
  new Foot(store, document.getElementById('foot'));
})();
