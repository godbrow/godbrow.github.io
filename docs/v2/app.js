/* =========================================================
   SDUI Block Editor Kernel v7 (STABLE FIXED CORE)
========================================================= */

/* =========================================================
   DOCUMENT MODEL
========================================================= */

const DocumentModel = {
  blocks: [],
  setBlocks(b) { this.blocks = b; },
  getBlocks() { return this.blocks; }
};

let globalBlockId = 0;
function createBlock(type = "paragraph", text = "") {
  return { id: globalBlockId++, type, text };
}

/* =========================================================
   SIMPLE PARSER
========================================================= */

function parseToBlocks(text = "") {
  const lines = text.split("\n");
  const blocks = [];
  let buffer = [];
  let id = 0;

  const flush = (type = "paragraph") => {
    if (!buffer.length) return;
    blocks.push({ id: id++, type, text: buffer.join("\n") });
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
   DOM + STATE
========================================================= */

let editorPanel = null;
let previewPanel = null;

const BlockDOMCache = new Map();

let activeBlockId = null;

/* =========================================================
   SCHEDULERS (CRITICAL FIX)
========================================================= */

let editorQueued = false;
let previewQueued = false;

function queueEditorRender() {
  if (editorQueued) return;

  editorQueued = true;
  requestAnimationFrame(() => {
    editorQueued = false;
    renderEditor();
  });
}

function queuePreviewRender() {
  if (previewQueued) return;

  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    renderPreview();
  });
}

/* =========================================================
   CURSOR SAFETY
========================================================= */

const CursorState = {
  blockId: null,
  offset: 0
};

function saveCursor(el, block) {
  CursorState.blockId = block.id;
  CursorState.offset = el.selectionStart ?? el.innerText.length;
}

function restoreCursor() {
  requestAnimationFrame(() => {
    const el = editorPanel?.querySelector(
      `[data-id="${CursorState.blockId}"]`
    );

    if (!el) return;

    el.focus();

    try {
      el.setSelectionRange?.(CursorState.offset, CursorState.offset);
    } catch {}
  });
}

/* =========================================================
   BLOCK ELEMENT FACTORY (IMPORTANT)
========================================================= */

function createBlockElement(block) {
  const el = document.createElement("div");

  el.contentEditable = true;
  el.dataset.id = block.id;

  el.addEventListener("focus", () => {
    activeBlockId = block.id;
  });

  el.addEventListener("blur", () => {
    activeBlockId = null;
  });

  el.addEventListener("input", () => {
    block.text = el.innerText;

    saveCursor(el, block);

    queuePreviewRender();
    queueEditorRender();
  });

  el.addEventListener("keydown", (e) => {
    handleKeydown(e, el, block);
  });

  return el;
}

/* =========================================================
   EDITOR RENDER (SAFE DOM REUSE)
========================================================= */

function renderEditor() {
  const blocks = DocumentModel.getBlocks();
  const container = editorPanel;

  const activeIds = new Set();

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    activeIds.add(block.id);

    let el = BlockDOMCache.get(block.id);

    if (!el) {
      el = createBlockElement(block);
      BlockDOMCache.set(block.id, el);
    }

    // NEVER overwrite active typing block
    if (block.id !== activeBlockId) {
      el.innerText = block.text;
    }

    if (el.parentNode !== container) {
      container.appendChild(el);
    }
  }

  // cleanup removed blocks
  for (const [id, el] of BlockDOMCache.entries()) {
    if (!activeIds.has(id)) {
      el.remove();
      BlockDOMCache.delete(id);
    }
  }
}

/* =========================================================
   BLOCK OPERATIONS
========================================================= */

function splitBlock(block, pos) {
  const before = block.text.slice(0, pos);
  const after = block.text.slice(pos);

  block.text = before;

  const newBlock = createBlock("paragraph", after);

  const arr = DocumentModel.getBlocks();
  const idx = arr.indexOf(block);

  arr.splice(idx + 1, 0, newBlock);

  return newBlock;
}

function mergeWithPrevious(block) {
  const arr = DocumentModel.getBlocks();
  const idx = arr.indexOf(block);

  if (idx === 0) return null;

  const prev = arr[idx - 1];
  prev.text += block.text;

  arr.splice(idx, 1);

  return prev;
}

/* =========================================================
   KEY HANDLER (FIXED ENTER/DELETE)
========================================================= */

function handleKeydown(e, el, block) {

  const pos = el.selectionStart ?? el.innerText.length;

  if (e.key === "Enter") {
    e.preventDefault();

    const newBlock = splitBlock(block, pos);

    queueEditorRender();
    queuePreviewRender();

    restoreCursor();

    return;
  }

  if (e.key === "Backspace" && pos === 0) {
    e.preventDefault();

    const prev = mergeWithPrevious(block);

    queueEditorRender();
    queuePreviewRender();

    if (prev) {
      CursorState.blockId = prev.id;
      CursorState.offset = prev.text.length;
      restoreCursor();
    }

    return;
  }
}

/* =========================================================
   MARKDOWN RENDER
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

/* =========================================================
   PREVIEW RENDER
========================================================= */

function renderPreview() {
  const blocks = DocumentModel.getBlocks();

  previewPanel.innerHTML = "";

  for (const block of blocks) {
    const el = document.createElement("div");
    el.dataset.blockId = block.id;

    el.innerHTML = renderMarkdown(block.text);

    previewPanel.appendChild(el);
  }
}

/* =========================================================
   INIT
========================================================= */

function init() {
  editorPanel = document.querySelector('[role="editor-panel"]');
  previewPanel = document.querySelector('[role="preview-panel"]');

  const blocks = parseToBlocks("");

  DocumentModel.setBlocks(blocks);

  renderEditor();
  renderPreview();
}

init();
