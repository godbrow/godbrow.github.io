// app.js – v1 Editor (ES module, no dependencies)

// ---------- Utility ----------
const load = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw Error(`Failed to load ${url}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
};

const build = (node) => {
  // Support fragments (no wrapper element)
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

// Escape HTML for preview safety
const escape = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- Plugin system ----------
const plug = {};

const register = (plugin) => {
  plug[plugin.mode] = plugin;
};

// ---- Built‑in: Text ----
register({
  mode: 'txt',
  name: 'Text',
  start: () => ({}),
  line: (line, ctx) => [{ kind: 'text', span: line }],
  block: (ctx) => ({ kind: 'para' }),
  render: (text) => `<pre>${escape(text)}</pre>`
});

// ---- Built‑in: Markdown (stateful) ----
register({
  mode: 'md',
  name: 'Markdown',
  start: () => ({ fence: false }),
  line: (line, ctx) => {
    const tokens = [];
    // Fenced code block toggle
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
    // Blockquote
    if (/^>\s/.test(line)) {
      const m = line.match(/^>\s(.*)/);
      if (m) {
        tokens.push({ kind: 'marker', span: '> ' });
        tokens.push({ kind: 'text', span: m[1] });
        return tokens;
      }
    }
    // Default: all text
    tokens.push({ kind: 'text', span: line });
    return tokens;
  },
  block: (ctx) => {
    if (ctx.fence) return { kind: 'codeblock' };
    // The block kind is determined during rendering based on the first token.
    // This method is called after line() for the line, but we need to decide based on content.
    // For simplicity, we return a generic kind and let the renderer inspect the line again.
    // Better approach: cache per line in ctx during line(), but v1 uses a simple heuristic.
    // We'll handle block classes in the editor by re‑inspecting the line string.
    // Return 'para' – actual block class will be set by editor’s own logic.
    return { kind: 'para' };
  },
  render: (text) => {
    let html = escape(text);
    // Code blocks (```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // Headings
    html = html.replace(/^#{1,6}\s(.*)$/gm, (line) => {
      const level = line.match(/^(#{1,6})/)[1].length;
      const content = line.replace(/^#{1,6}\s/, '');
      return `<h${level}>${content}</h${level}>`;
    });
    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Inline code
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    // Unordered list
    html = html.replace(/^\s*[-*+]\s(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    // Blockquote
    html = html.replace(/^>\s(.*)$/gm, '<blockquote>$1</blockquote>');
    return html;
  }
});

// ---- Built‑in: HTML, CSS, JS (simplified) ----
['html', 'css', 'js'].forEach(mode => {
  register({
    mode,
    name: mode.toUpperCase(),
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

// ---------- Undo / Redo ----------
class Insert {
  constructor(line, col, text) { this.line = line; this.col = col; this.text = text; }
  apply(doc) {
    const lines = doc.split('\n');
    lines[this.line] = lines[this.line].slice(0, this.col) + this.text + lines[this.line].slice(this.col);
    return lines.join('\n');
  }
  undo(doc) {
    const lines = doc.split('\n');
    const len = this.text.length;
    lines[this.line] = lines[this.line].slice(0, this.col) + lines[this.line].slice(this.col + len);
    return lines.join('\n');
  }
}

class Delete {
  constructor(line, col, text) { this.line = line; this.col = col; this.text = text; }
  apply(doc) {
    const lines = doc.split('\n');
    lines[this.line] = lines[this.line].slice(0, this.col) + lines[this.line].slice(this.col + this.text.length);
    return lines.join('\n');
  }
  undo(doc) {
    const lines = doc.split('\n');
    lines[this.line] = lines[this.line].slice(0, this.col) + this.text + lines[this.line].slice(this.col);
    return lines.join('\n');
  }
}

class History {
  constructor() { this.stack = []; this.idx = -1; }
  push(cmd) {
    this.stack = this.stack.slice(0, this.idx + 1);
    this.stack.push(cmd);
    this.idx++;
  }
  undo() {
    if (this.idx < 0) return null;
    return this.stack[this.idx--];
  }
  redo() {
    if (this.idx >= this.stack.length - 1) return null;
    return this.stack[++this.idx];
  }
}

// ---------- Store (central state, pub/sub) ----------
class Store {
  #state;
  #subs;

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
    this.#subs.forEach(fn => fn(action, this.#state));
  }

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
    if (action === 'theme') {
      localStorage.setItem('theme', this.#state.theme);
    }
  }

  load() {
    const tabs = JSON.parse(localStorage.getItem('tabs') || '[]');
    const active = localStorage.getItem('active') || null;
    const docs = JSON.parse(localStorage.getItem('docs') || '[]');
    const theme = localStorage.getItem('theme') || 'light';
    this.#state = { tabs, active, docs, theme };
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }

  // Convenience: get full text for a document id
  text(id) {
    return localStorage.getItem(`doc:${id}`) || '';
  }
  // Save text to localStorage
  save(id, text) {
    localStorage.setItem(`doc:${id}`, text);
  }
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
    // Delegate clicks on tabs
    this.el.querySelector('.tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      const id = tab.dataset.id;
      if (id) this.store.dispatch('active', id);
    });
    // Action buttons
    this.el.querySelector('.actions').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.action;
      if (act === 'new') this.newDoc();
      else if (act === 'theme') this.toggleTheme();
      // Other actions: export, import, etc. (placeholders)
    });
    // Render action buttons HTML
    this.el.querySelector('.actions').innerHTML = `
      <button data-action="new">New</button>
      <button data-action="theme">Theme</button>
    `;
  }

  newDoc() {
    const id = 'doc_' + Date.now();
    const doc = { id, name: 'untitled', mode: 'md', stamp: Date.now() };
    const docs = [...this.store.docs, doc];
    this.store.dispatch('docs', docs);
    this.store.save(id, '');
    this.store.dispatch('tabs', [...this.store.tabs, id]);
    this.store.dispatch('active', id);
  }

  toggleTheme() {
    const next = this.store.theme === 'dark' ? 'light' : 'dark';
    this.store.dispatch('theme', next);
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
    const docs = this.store.docs;
    this.el.innerHTML = docs.map(d => `
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
      // If not open, add to tabs
      if (!this.store.tabs.includes(id)) {
        this.store.dispatch('tabs', [...this.store.tabs, id]);
      }
      this.store.dispatch('active', id);
    });
  }
}

// ---------- Edit (virtualised editor) ----------
// ---------- Edit (virtualised editor, fixed input) ----------
class Edit {
  #store;
  #doc;
  #lines;
  #heights;
  #scroll;
  #gutter;
  #textarea;
  #history;
  #parser;
  #cursor;
  #pool;
  #sentinel;
  #composing = false;
  #composeStartText = '';

  constructor(store, main) {
    this.#store = store;
    this.#gutter = main.querySelector('.gutter');
    this.#scroll = main.querySelector('.content');
    this.#textarea = this.#makeTextarea();
    this.#scroll.appendChild(this.#textarea);
    this.#pool = [];
    this.#heights = [];
    this.#lines = [];
    this.#cursor = { line: 0, col: 0 };
    this.#history = new History();

    this.#sentinel = document.createElement('div');
    this.#sentinel.className = 'sentinel';
    this.#scroll.appendChild(this.#sentinel);

    this.#scroll.addEventListener('scroll', () => this.#render());
    this.#scroll.addEventListener('mousedown', (e) => this.#onMouseDown(e));
    this.#textarea.addEventListener('keydown', (e) => this.#onKey(e));
    // IME composition
    this.#textarea.addEventListener('compositionstart', () => {
      this.#composing = true;
      this.#composeStartText = this.#lines[this.#cursor.line] || '';
    });
    this.#textarea.addEventListener('compositionend', (e) => {
      this.#composing = false;
      const composed = e.data || '';
      const { line, col } = this.#cursor;
      const oldLine = this.#composeStartText;
      // Build a command that transforms oldLine into the composed text
      // Approach: delete the whole line, then insert the new content at col
      // For simplicity, we replace the entire line with the composed text.
      if (composed !== oldLine) {
        // Delete the entire old line, then insert the new one
        const delCmd = new Delete(line, 0, oldLine);
        this.#applyCommand(delCmd);
        const insCmd = new Insert(line, 0, composed);
        this.#applyCommand(insCmd);
        this.#setCursor(line, composed.length);
      }
    });

    store.subscribe((action) => {
      if (action === 'active' || action === 'docs') this.refresh();
    });
  }

  #makeTextarea() {
    const ta = document.createElement('textarea');
    ta.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;left:0;top:0;z-index:1;';
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
    this.#cursor = { line: 0, col: 0 };
    this.#clearPool();
    this.#render();
  }

  #clearPool() {
    this.#pool.forEach(el => el.remove());
    this.#pool = [];
  }

  #render() {
    const scrollTop = this.#scroll.scrollTop;
    const viewHeight = this.#scroll.clientHeight;
    let start = 0, end = 0, acc = 0;
    for (let i = 0; i < this.#lines.length; i++) {
      const h = this.#heights[i] || 24;
      if (acc + h > scrollTop) {
        start = i;
        break;
      }
      acc += h;
    }
    acc = 0;
    for (let i = start; i < this.#lines.length; i++) {
      const h = this.#heights[i] || 24;
      acc += h;
      if (acc > viewHeight + 200) {
        end = i;
        break;
      }
      if (i === this.#lines.length - 1) end = i;
    }

    this.#clearPool();
    const frag = document.createDocumentFragment();
    const gutterFrag = document.createDocumentFragment();

    for (let i = start; i <= end; i++) {
      const lineNum = document.createElement('div');
      lineNum.textContent = i + 1;
      lineNum.style.height = `${this.#heights[i] || 24}px`;
      lineNum.style.lineHeight = `${this.#heights[i] || 24}px`;
      gutterFrag.appendChild(lineNum);
    }
    this.#gutter.innerHTML = '';
    this.#gutter.appendChild(gutterFrag);

    for (let i = start; i <= end; i++) {
      const lineEl = document.createElement('div');
      lineEl.className = 'line';
      lineEl.style.top = `${this.#offset(i)}px`;
      lineEl.dataset.line = i;

      const blockKind = this.#detectBlockKind(i);
      if (blockKind) lineEl.classList.add(blockKind);

      const numSpan = document.createElement('span');
      numSpan.className = 'num';
      numSpan.textContent = i + 1;

      const textSpan = document.createElement('span');
      textSpan.className = 'text';
      const tokens = this.#tokenizeLine(i);
      tokens.forEach(tok => {
        const span = document.createElement('span');
        span.className = tok.kind;
        span.textContent = tok.span;
        textSpan.appendChild(span);
      });

      lineEl.appendChild(numSpan);
      lineEl.appendChild(textSpan);
      frag.appendChild(lineEl);
      this.#pool.push(lineEl);
    }

    this.#scroll.appendChild(frag);
    this.#sentinel.style.height = `${this.#offset(this.#lines.length)}px`;
  }

  #offset(untilLine) {
    let o = 0;
    for (let i = 0; i < untilLine; i++) o += this.#heights[i] || 24;
    return o;
  }

  #tokenizeLine(lineIndex) {
    const plugin = this.#parser.plugin;
    const ctx = plugin.start();
    for (let i = 0; i < lineIndex; i++) plugin.line(this.#lines[i], ctx);
    return plugin.line(this.#lines[lineIndex], ctx);
  }

  #detectBlockKind(lineIndex) {
    const line = this.#lines[lineIndex] || '';
    if (/^```/.test(line)) return 'codeblock';
    if (/^#{1,6}\s/.test(line)) return 'heading';
    if (/^\s*[-*+]\s/.test(line)) return 'list-block';
    if (/^>\s/.test(line)) return 'quote';
    return 'para';
  }

  #onMouseDown(e) {
    const lineEl = e.target.closest('.line');
    if (!lineEl) return;
    const line = parseInt(lineEl.dataset.line, 10);
    const textSpan = lineEl.querySelector('.text');
    if (!textSpan) return;
    const rect = textSpan.getBoundingClientRect();
    const charWidth = 9.6;
    const col = Math.max(0, Math.round((e.clientX - rect.left) / charWidth));
    this.#setCursor(line, col);
    this.#textarea.focus();
  }

  #setCursor(line, col) {
    this.#cursor = { line, col };
    const lineText = this.#lines[line] || '';
    this.#textarea.value = lineText;
    this.#textarea.setSelectionRange(col, col);
    const targetY = this.#offset(line);
    this.#scroll.scrollTop = targetY - this.#scroll.clientHeight / 2;
  }

  #onKey(e) {
    if (this.#composing) return; // let IME handle everything

    const { line, col } = this.#cursor;
    const key = e.key;

    // Navigation keys
    if (key === 'ArrowUp') {
      e.preventDefault();
      if (line > 0) this.#setCursor(line - 1, Math.min(col, (this.#lines[line-1] || '').length));
      return;
    }
    if (key === 'ArrowDown') {
      e.preventDefault();
      if (line < this.#lines.length - 1) this.#setCursor(line + 1, Math.min(col, (this.#lines[line+1] || '').length));
      return;
    }
    if (key === 'ArrowLeft') {
      e.preventDefault();
      this.#setCursor(line, Math.max(0, col - 1));
      return;
    }
    if (key === 'ArrowRight') {
      e.preventDefault();
      this.#setCursor(line, Math.min((this.#lines[line] || '').length, col + 1));
      return;
    }
    if (key === 'Home') {
      e.preventDefault();
      this.#setCursor(line, 0);
      return;
    }
    if (key === 'End') {
      e.preventDefault();
      this.#setCursor(line, (this.#lines[line] || '').length);
      return;
    }
    if (key === 'Backspace') {
      e.preventDefault();
      if (col > 0) {
        const deleted = this.#lines[line].charAt(col - 1);
        const cmd = new Delete(line, col - 1, deleted);
        this.#applyCommand(cmd);
        this.#setCursor(line, col - 1);
      } else if (line > 0) {
        const prevLen = this.#lines[line - 1].length;
        const cmd = new Delete(line - 1, prevLen, '\n');
        this.#applyCommand(cmd);
        this.#setCursor(line - 1, prevLen);
      }
      return;
    }
    if (key === 'Delete') {
      e.preventDefault();
      if (col < (this.#lines[line] || '').length) {
        const deleted = this.#lines[line].charAt(col);
        const cmd = new Delete(line, col, deleted);
        this.#applyCommand(cmd);
        this.#setCursor(line, col);
      } else if (line < this.#lines.length - 1) {
        const cmd = new Delete(line, (this.#lines[line] || '').length, '\n');
        this.#applyCommand(cmd);
        this.#setCursor(line, col);
      }
      return;
    }
    if (key === 'Enter') {
      e.preventDefault();
      const cmd = new Insert(line, col, '\n');
      this.#applyCommand(cmd);
      this.#setCursor(line + 1, 0);
      return;
    }
    // Undo/Redo
    if (key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.#undo();
      return;
    }
    if (key === 'y' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.#redo();
      return;
    }

    // Printable characters (length === 1 and no modifier)
    if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const cmd = new Insert(line, col, key);
      this.#applyCommand(cmd);
      this.#setCursor(line, col + 1);
    }
  }

  #applyCommand(cmd) {
    const oldText = this.#store.text(this.#doc.id);
    const newText = cmd.apply(oldText);
    this.#store.save(this.#doc.id, newText);
    this.#doc.text = newText;
    this.#lines = newText.split('\n');
    this.#heights = new Array(this.#lines.length).fill(24);
    this.#history.push(cmd);
    this.#render();
  }

  #undo() {
    const cmd = this.#history.undo();
    if (!cmd) return;
    const oldText = this.#store.text(this.#doc.id);
    const newText = cmd.undo(oldText);
    this.#store.save(this.#doc.id, newText);
    this.#doc.text = newText;
    this.#lines = newText.split('\n');
    this.#heights = new Array(this.#lines.length).fill(24);
    this.#render();
    this.#setCursor(cmd.line, Math.min(this.#cursor.col, (this.#lines[cmd.line] || '').length));
  }

  #redo() {
    const cmd = this.#history.redo();
    if (!cmd) return;
    const oldText = this.#store.text(this.#doc.id);
    const newText = cmd.apply(oldText);
    this.#store.save(this.#doc.id, newText);
    this.#doc.text = newText;
    this.#lines = newText.split('\n');
    this.#heights = new Array(this.#lines.length).fill(24);
    this.#render();
    this.#setCursor(cmd.line, Math.min(this.#cursor.col, (this.#lines[cmd.line] || '').length));
  }
}
// ---------- View (preview pane) ----------
class View {
  constructor(store, iframe) {
    this.store = store;
    this.iframe = iframe;
    store.subscribe((action) => {
      if (action === 'active' || action === 'docs') this.update();
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
    const html = plugin.render(text);
    this.iframe.srcdoc = html;
  }
}

// ---------- Foot (status bar) ----------
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
    this.el.textContent = `v1 Editor | Mode: ${mode} | Lines: ?`; // line/col will be added later
  }
}

// ---------- Boot ----------
(async () => {
  // Register service worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/worker.js');
    } catch (err) {
      console.warn('Service worker registration failed:', err);
    }
  }

  // Load SDUI and build DOM
  const ui = await load('/ui.json');
  const frag = build(ui);
  document.body.append(frag);

  // Initialise store
  const store = new Store();
  store.load();

  // Instantiate components using structural selectors
  new Head(store, document.querySelector('body > header'));
  new List(store, document.querySelector('body > aside:first-of-type'));
  new Edit(store, document.querySelector('body > main'));
  new View(store, document.querySelector('body > aside:last-of-type > iframe'));
  new Foot(store, document.querySelector('body > footer'));
})();
