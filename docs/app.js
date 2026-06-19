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
  // off = absolute character offset in the full string
  constructor(off, text) {
    this.off = off;
    this.text = text;
  }
  apply(doc) {
    return doc.slice(0, this.off) + this.text + doc.slice(this.off);
  }
  undo(doc) {
    return doc.slice(0, this.off) + doc.slice(this.off + this.text.length);
  }
}

class Delete {
  // off = absolute offset, text = the string that was deleted (needed for undo)
  constructor(off, text) {
    this.off = off;
    this.text = text;
  }
  apply(doc) {
    return doc.slice(0, this.off) + doc.slice(this.off + this.text.length);
  }
  undo(doc) {
    return doc.slice(0, this.off) + this.text + doc.slice(this.off);
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
    this.#notify(action);               // 👈 this is now correctly defined
  }

  #notify(action) {
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

  // Convenience helpers
  text(id) {
    return localStorage.getItem(`doc:${id}`) || '';
  }
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

// ---------- Edit (contenteditable pre, native cursor) ----------
class Edit {
  #store; #doc; #lines; #heights; #scroll; #gutter; #pre;
  #history; #parser; #cursor; #cursors; #idle;
  #composing = false;

  constructor(store, main) {
    this.#store = store;
    this.#gutter = main.querySelector('.gutter');
    this.#scroll = main.querySelector('.content');
    this.#cursors = new Map();
    this.#cursor = { line: 0, col: 0 };
    this.#history = new History();

    // Create contenteditable pre (replaces hidden textarea)
    this.#pre = document.createElement('pre');
    this.#pre.className = 'edit';
    this.#pre.setAttribute('contenteditable', 'true');
    this.#pre.setAttribute('spellcheck', 'false');
    this.#pre.style.cssText = 'white-space:pre-wrap;word-wrap:break-word;margin:0;outline:none;min-height:100%;';
    this.#scroll.appendChild(this.#pre);

    this.#pre.addEventListener('keydown', (e) => this.#onKey(e));
    this.#pre.addEventListener('input', (e) => this.#onInput(e));
    this.#pre.addEventListener('compositionstart', () => { this.#composing = true; });
    this.#pre.addEventListener('compositionend', (e) => {
      this.#composing = false;
      // Let the input handler deal with the final text
      this.#onInput(e);
    });
    // Focus/blur for caret styling
    this.#pre.addEventListener('focus', () => this.#scroll.classList.add('focused'));
    this.#pre.addEventListener('blur', () => this.#scroll.classList.remove('focused'));

    store.subscribe((action) => {
      if (action === 'active' || action === 'docs') this.refresh();
    });
  }

  refresh() {
    const id = this.#store.active;
    if (!id) return;
    const doc = this.#store.docs.find(d => d.id === id);
    if (!doc) return;
    this.#doc = doc;
    const text = this.#store.text(id);
    this.#lines = text.split('\n');
    this.#history = new History();
    this.#parser = {
      plugin: plug[doc.mode] || plug.txt,
      ctx: (plug[doc.mode] || plug.txt).start()
    };

    // Restore previous cursor
    const saved = this.#cursors.get(id);
    if (saved) {
      this.#cursor = { line: saved.line, col: saved.col };
    } else {
      this.#cursor = { line: 0, col: 0 };
    }
    // Clamp to document bounds
    if (this.#cursor.line >= this.#lines.length)
      this.#cursor.line = Math.max(0, this.#lines.length - 1);
    if (this.#cursor.col > (this.#lines[this.#cursor.line] || '').length)
      this.#cursor.col = (this.#lines[this.#cursor.line] || '').length;

    this.#renderAll();
    this.#restoreCursor();
    this.#pre.focus();
  }

  // Render the entire document into the contenteditable pre (non-virtualised for now)
  #renderAll() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < this.#lines.length; i++) {
      const section = this.#renderLine(i);
      frag.appendChild(section);
    }
    this.#pre.innerHTML = '';
    this.#pre.appendChild(frag);
  }

  // Render a single line as a <div> with token spans and a <br>-based line feed
  #renderLine(lineIndex) {
    const div = document.createElement('div');
    div.className = 'section';   // corresponds to StackEdit's cledit-section
    div.dataset.line = lineIndex;

    const blockKind = this.#detectBlockKind(lineIndex);
    if (blockKind) div.classList.add(blockKind);

    // Token spans
    const tokens = this.#tokenizeLine(lineIndex);
    const textSpan = document.createElement('span');
    textSpan.className = 'text';
    tokens.forEach(tok => {
      const span = document.createElement('span');
      span.className = tok.kind;   // e.g., keyword, string, marker, text
      span.textContent = tok.span;
      textSpan.appendChild(span);
    });
    div.appendChild(textSpan);

    // Line feed (br) – required for contenteditable to have line breaks
    const lf = document.createElement('span');
    lf.className = 'lf';
    lf.innerHTML = '<br>';       // actual <br> element
    div.appendChild(lf);

    return div;
  }

  // Re‑highlight all visible sections (called after editing)
  #rehighlight() {
    const sections = this.#pre.querySelectorAll('.section');
    sections.forEach((div) => {
      const lineIndex = parseInt(div.dataset.line, 10);
      if (isNaN(lineIndex)) return;
      // Replace text span content with new tokens
      const textSpan = div.querySelector('.text');
      if (!textSpan) return;
      textSpan.innerHTML = '';
      const tokens = this.#tokenizeLine(lineIndex);
      tokens.forEach(tok => {
        const span = document.createElement('span');
        span.className = tok.kind;
        span.textContent = tok.span;
        textSpan.appendChild(span);
      });
      // Update block class
      div.className = 'section';  // reset
      const blockKind = this.#detectBlockKind(lineIndex);
      if (blockKind) div.classList.add(blockKind);
    });
  }

  #detectBlockKind(lineIndex) {
    const line = this.#lines[lineIndex] || '';
    if (/^```/.test(line)) return 'codeblock';
    if (/^#{1,6}\s/.test(line)) return 'heading';
    if (/^\s*[-*+]\s/.test(line)) return 'list-block';
    if (/^>\s/.test(line)) return 'quote';
    return 'para';
  }

  #tokenizeLine(lineIndex) {
    const plugin = this.#parser.plugin;
    const ctx = plugin.start();
    for (let i = 0; i < lineIndex; i++) plugin.line(this.#lines[i], ctx);
    return plugin.line(this.#lines[lineIndex], ctx);
  }

  // Save current cursor position from contenteditable DOM to model
  #saveCursor() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const node = sel.anchorNode;
    const section = node?.parentElement?.closest('.section');
    if (!section) return;
    const line = parseInt(section.dataset.line, 10);
    // Find column by counting characters before the cursor within the .text span
    const textSpan = section.querySelector('.text');
    let col = 0;
    if (textSpan) {
      const walker = document.createTreeWalker(textSpan, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current && current !== node) {
        col += current.textContent.length;
        current = walker.nextNode();
      }
      if (current === node) {
        col += sel.anchorOffset;
      }
    }
    this.#cursor = { line, col };
    if (this.#doc) this.#cursors.set(this.#doc.id, { line, col });
  }

  // Restore cursor from model into contenteditable
  #restoreCursor() {
    const { line, col } = this.#cursor;
    const section = this.#pre.querySelector(`.section[data-line="${line}"]`);
    if (!section) return;
    const textSpan = section.querySelector('.text');
    if (!textSpan) return;
    let offset = col;
    const walker = document.createTreeWalker(textSpan, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && offset > node.textContent.length) {
      offset -= node.textContent.length;
      node = walker.nextNode();
    }
    if (node) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(node, Math.min(offset, node.textContent.length));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  // ---------- Input handling (contentEditable fires 'input') ----------
  #onInput(e) {
    if (this.#composing) return;
    // Extract plain text from contenteditable
    const raw = this.#pre.innerText;   // innerText gives us the raw text with newlines
    // innerText in a pre typically keeps newlines as \n
    const newText = raw.replace(/\n$/, '');  // trailing newline might be extra
    if (newText === this.#doc.text) return;  // no change
    const oldText = this.#doc.text;
    // Create a command – we use a "replace all" for simplicity (undo knows old text)
    // For fine‑grained undo we'd diff, but for v1 we replace the whole document.
    const cmd = new Replace(this.#doc.id, oldText, newText);
    this.#applyCommand(cmd);
  }

  // Replace command (holds old and new full text)
  class Replace {
    constructor(id, oldText, newText) {
      this.id = id;
      this.old = oldText;
      this.new = newText;
    }
    apply(doc) { return this.new; }
    undo(doc) { return this.old; }
  }

  // Apply a command and update everything
  #applyCommand(cmd) {
    if (cmd instanceof Replace) {
      const newText = cmd.new;
      this.#store.save(this.#doc.id, newText);
      this.#doc.text = newText;
      this.#lines = newText.split('\n');
      this.#history.push(cmd);
      this.#store.dispatch('doc', { id: this.#doc.id, text: newText });
      // Re‑render and keep cursor
      this.#saveCursor();          // save before render
      this.#renderAll();
      this.#rehighlight();        // highlight is already in renderAll, but double safe
      this.#restoreCursor();
    }
  }

  // Undo/redo using the same mechanism
  #undo() {
    const cmd = this.#history.undo();
    if (!cmd) return;
    const newText = cmd.undo();
    this.#store.save(this.#doc.id, newText);
    this.#doc.text = newText;
    this.#lines = newText.split('\n');
    this.#store.dispatch('doc', { id: this.#doc.id, text: newText });
    this.#saveCursor();
    this.#renderAll();
    this.#restoreCursor();
  }

  #redo() {
    const cmd = this.#history.redo();
    if (!cmd) return;
    const newText = cmd.apply();
    this.#store.save(this.#doc.id, newText);
    this.#doc.text = newText;
    this.#lines = newText.split('\n');
    this.#store.dispatch('doc', { id: this.#doc.id, text: newText });
    this.#saveCursor();
    this.#renderAll();
    this.#restoreCursor();
  }

  // Keyboard shortcuts (Ctrl+Z/Y etc.)
  #onKey(e) {
    const key = e.key;
    if (key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.#undo();
    } else if (key === 'y' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.#redo();
    }
    // All other keys are handled natively by contentEditable
  }
}
// ---------- View (preview pane) ----------
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
