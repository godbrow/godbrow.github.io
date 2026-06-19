
/* =========================================================
   SDUI Block Editor Kernel v6 (STABLE)
   - Fixes typing corruption
   - Safe rendering pipeline
   - Plugin system preserved
========================================================= */

/* =========================================================
   DOCUMENT MODEL
========================================================= */

const DocumentModel = {
  blocks: [],

  setBlocks(blocks) {
    this.blocks = blocks;
  },

  getBlocks() {
    return this.blocks;
  }
};

/* =========================================================
   BLOCK FACTORY
========================================================= */

let globalBlockId = 0;

function createBlock(type = "paragraph", text = "") {
  return {
    id: globalBlockId++,
    type,
    text
  };
}

/* =========================================================
   PARSER
========================================================= */

function parseToBlocks(text = "") {
  const lines = text.split("\n");

  const blocks = [];
  let buffer = [];
  let id = 0;

  const flush = (type = "paragraph") => {
    if (!buffer.length) return;

    blocks.push({
      id: id++,
      type,
      text: buffer.join("\n")
    });

    buffer = [];
  };

  for (const line of lines) {

    if (line.startsWith("# ")) {
      flush();
      blocks.push({ id: id++, type: "h1", text: line.slice(2) });
      continue;
    }

    if (line.startsWith("## ")) {
      flush();
      blocks.push({ id: id++, type: "h2", text: line.slice(3) });
      continue;
    }

    if (line.startsWith("> ")) {
      flush();
      blocks.push({ id: id++, type: "quote", text: line.slice(2) });
      continue;
    }

    buffer.push(line);
  }

  flush();

  return blocks;
}

/* =========================================================
   VIRTUAL RANGE
========================================================= */

const VirtualState = {
  start: 0,
  end: 0,
  buffer: 6
};

function estimateHeight(block) {
  return 28 + block.text.split("\n").length * 18;
}

function computeVisibleRange(blocks, scrollTop, viewportHeight) {

  let y = 0;
  let start = 0;

  for (let i = 0; i < blocks.length; i++) {
    const h = estimateHeight(blocks[i]);

    if (y + h > scrollTop) {
      start = Math.max(0, i - VirtualState.buffer);
      break;
    }

    y += h;
  }

  let end = start;
  let h = 0;

  while (end < blocks.length && h < viewportHeight) {
    h += estimateHeight(blocks[end]);
    end++;
  }

  VirtualState.start = start;
  VirtualState.end = end + VirtualState.buffer;
}

/* =========================================================
   CURSOR STATE (SAFE VERSION)
========================================================= */

const CursorState = {
  blockId: null,
  offset: 0
};

function saveCursor(el, block) {
  CursorState.blockId = block.id;
  CursorState.offset = el.selectionStart ?? el.innerText.length;
}

function restoreCursor(editorPanel) {

  requestAnimationFrame(() => {

    if (CursorState.blockId == null) return;

    const el = editorPanel.querySelector(
      `[data-id="${CursorState.blockId}"]`
    );

    if (!el) return;

    el.focus();

    try {
      el.setSelectionRange?.(
        CursorState.offset,
        CursorState.offset
      );
    } catch {}
  });
}

/* =========================================================
   ACTIVE EDITING GUARD (CRITICAL FIX)
========================================================= */

let activeBlockId = null;

/* =========================================================
   RENDER DEBOUNCE (CRITICAL FIX)
========================================================= */

let renderQueued = false;

function queueRender() {
  if (renderQueued) return;

  renderQueued = true;

  requestAnimationFrame(() => {
    renderQueued = false;
    scheduleRender();
  });
}

/* =========================================================
   PLUGIN SYSTEM
========================================================= */

const PluginRegistry = {
  plugins: new Map(),

  register(plugin) {
    this.plugins.set(plugin.type, plugin);
  },

  get(type) {
    return this.plugins.get(type);
  }
};

class PluginInstance {
  constructor(plugin, block, el) {
    this.plugin = plugin;
    this.block = block;
    this.el = el;
    this.abortController = new AbortController();
  }

  ctx() {
    return { signal: this.abortController.signal };
  }

  mount() {
    this.plugin.mount?.(this.block, this.el, this.ctx());
  }

  update(block) {
    this.block = block;
    this.plugin.update?.(this.block, this.el, this.ctx());
  }

  destroy() {
    this.abortController.abort();
    this.plugin.destroy?.(this.block, this.el);
  }
}

const PluginInstances = new Map();

/* =========================================================
   DOM CACHE (VIRTUALIZATION STABILITY)
========================================================= */

const BlockDOMCache = new Map();

/* =========================================================
   DOM REFERENCES
========================================================= */

let editorPanel = null;
let previewPanel = null;

/* =========================================================
   SDUI LOADER
========================================================= */

async function loadUI() {
  const res = await fetch("./ui.json");
  const schema = await res.json();

  renderNode(schema, document.body);
}

function renderNode(node, parent) {

  switch (node.type) {

    case "page":
      node.children?.forEach(c => renderNode(c, parent));
      break;

    case "main":
      const main = document.querySelector("main");
      node.children?.forEach(c => renderNode(c, main));
      break;

    case "section":
      const el = document.createElement("section");
      if (node.role) el.setAttribute("role", node.role);
      parent.appendChild(el);
      break;
  }
}

/* =========================================================
   PLUGIN RUNTIME
========================================================= */

function runPlugin(block, el) {

  const plugin = PluginRegistry.get(block.type);
  if (!plugin) return;

  const existing = PluginInstances.get(block.id);

  if (existing) {
    existing.update(block);
    return;
  }

  const instance = new PluginInstance(plugin, block, el);

  PluginInstances.set(block.id, instance);

  instance.mount();
}

function cleanupPlugins(activeIds) {

  for (const [id, inst] of PluginInstances.entries()) {
    if (!activeIds.has(id)) {
      inst.destroy();
      PluginInstances.delete(id);
    }
  }
}

/* =========================================================
   EDITOR (VIRTUAL + SAFE DOM REUSE)
========================================================= */

function renderEditorVirtual() {

  const blocks = DocumentModel.getBlocks();
  const container = editorPanel;

  const activeIds = new Set();

  for (
    let i = VirtualState.start;
    i < VirtualState.end;
    i++
  ) {
    const block = blocks[i];
    if (!block) continue;

    activeIds.add(block.id);

    let el = BlockDOMCache.get(block.id);

    if (!el) {
      el = document.createElement("div");

      el.contentEditable = true;
      el.dataset.id = block.id;

      el.addEventListener("focus", () => {
        activeBlockId = block.id;
      });

      el.addEventListener("blur", () => {
        activeBlockId = null;
      });

      el.addEventListener("input", () => {

        saveCursor(el, block);

        block.text = el.innerText;

        syncPreviewBlock(block);

        queueRender();

        restoreCursor(editorPanel);
      });

      el.addEventListener("keydown", (e) => {
        handleBlockEditing(e, el, block);
      });

      BlockDOMCache.set(block.id, el);
    }

    // IMPORTANT: do NOT overwrite active typing block
    if (block.id !== activeBlockId) {
      el.innerText = block.text;
    }

    container.appendChild(el);
  }

  for (const [id, el] of BlockDOMCache.entries()) {
    if (!activeIds.has(id)) {
      el.remove();
      BlockDOMCache.delete(id);
    }
  }
}

/* =========================================================
   BLOCK EDITING
========================================================= */

function splitBlock(block, cursorPos) {

  const before = block.text.slice(0, cursorPos);
  const after = block.text.slice(cursorPos);

  block.text = before;

  const newBlock = createBlock("paragraph", after);

  const blocks = DocumentModel.getBlocks();
  const index = blocks.indexOf(block);

  blocks.splice(index + 1, 0, newBlock);

  return newBlock;
}

function mergeWithPrevious(block) {

  const blocks = DocumentModel.getBlocks();
  const index = blocks.indexOf(block);

  if (index === 0) return null;

  const prev = blocks[index - 1];

  prev.text += block.text;

  blocks.splice(index, 1);

  return prev;
}

function handleBlockEditing(e, el, block) {

  const cursorPos = el.innerText.length;

  if (e.key === "Enter") {
    e.preventDefault();

    const newBlock = splitBlock(block, cursorPos);

    scheduleRender();
    renderPreview();

    restoreCursor(editorPanel);
  }

  if (e.key === "Backspace" && cursorPos === 0) {
    e.preventDefault();

    const prev = mergeWithPrevious(block);

    scheduleRender();
    renderPreview();

    if (prev) restoreCursor(editorPanel);
  }
}

/* =========================================================
   PREVIEW SYSTEM
========================================================= */

function renderBlock(block) {

  const plugin = PluginRegistry.get(block.type);

  if (plugin?.render) {
    return plugin.render(block);
  }

  return `<p>${block.text}</p>`;
}

function renderPreview() {

  if (!previewPanel) {
    previewPanel = document.querySelector('[role="preview-panel"]');
  }

  const blocks = DocumentModel.getBlocks();

  previewPanel.innerHTML = "";

  const activeIds = new Set();

  for (const block of blocks) {

    activeIds.add(block.id);

    const wrapper = document.createElement("div");

    wrapper.dataset.blockId = block.id;

    wrapper.innerHTML = renderBlock(block);

    previewPanel.appendChild(wrapper);

    runPlugin(block, wrapper);
  }

  cleanupPlugins(activeIds);
}

function syncPreviewBlock(block) {

  const el = previewPanel.querySelector(
    `[data-block-id="${block.id}"]`
  );

  if (!el) return;

  const inst = PluginInstances.get(block.id);

  if (inst) {
    inst.update(block);
  }
}

/* =========================================================
   PIPELINE
========================================================= */

function scheduleRender() {

  const blocks = DocumentModel.getBlocks();

  computeVisibleRange(
    blocks,
    editorPanel.scrollTop,
    editorPanel.clientHeight
  );

  requestAnimationFrame(() => {
    renderEditorVirtual();
  });
}

/* =========================================================
   MARKDOWN PLUGIN (FIXED ROOT CAUSE)
========================================================= */

function renderMarkdown(text) {

  if (!text) return "";

  return text
    .replace(/^###### (.*)$/gm, "<h6>$1</h6>")
    .replace(/^##### (.*)$/gm, "<h5>$1</h5>")
    .replace(/^#### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

PluginRegistry.register({
  type: "paragraph",
  render(block) {
    return renderMarkdown(block.text);
  }
});

/* =========================================================
   INIT
========================================================= */

function initEditor() {

  editorPanel = document.querySelector('[role="editor-panel"]');
  previewPanel = document.querySelector('[role="preview-panel"]');

  editorPanel.addEventListener("scroll", () => {
    scheduleRender();
  });
}

async function init() {

  await loadUI();

  initEditor();

  const blocks = parseToBlocks("");

  DocumentModel.setBlocks(blocks);

  scheduleRender();
  renderPreview();
}

init();
