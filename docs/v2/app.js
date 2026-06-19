
/* =========================================================
   SDUI + TRANSACTION EDITOR CORE (v10)
   - deterministic UI contract
   - transaction engine preserved
   - stable editor binding
========================================================= */

/* =========================================================
   GLOBAL UI CONTRACT
========================================================= */

const UI = {
  editorPanel: null,
  previewPanel: null
};

/* =========================================================
   DOCUMENT MODEL
========================================================= */

const DocumentModel = {
  blocks: [],
  set(b) { this.blocks = b; },
  get() { return this.blocks; }
};

/* =========================================================
   BLOCK FACTORY
========================================================= */

let globalId = 0;

function createBlock(type = "paragraph", text = "") {
  return { id: globalId++, type, text };
}

/* =========================================================
   TRANSACTIONS
========================================================= */

const TX = {
  UPDATE: "update",
  SPLIT: "split",
  MERGE: "merge"
};

const TransactionEngine = {

  apply(tx) {

    const blocks = DocumentModel.get();

    switch (tx.type) {

      case TX.UPDATE: {
        tx.block.text = tx.value;
        break;
      }

      case TX.SPLIT: {
        const { block, pos } = tx;

        const before = block.text.slice(0, pos);
        const after = block.text.slice(pos);

        block.text = before;

        const newBlock = createBlock("paragraph", after);

        const idx = blocks.indexOf(block);
        blocks.splice(idx + 1, 0, newBlock);

        tx.result = newBlock;
        break;
      }

      case TX.MERGE: {
        const { block } = tx;

        const idx = blocks.indexOf(block);
        if (idx === 0) return;

        const prev = blocks[idx - 1];

        prev.text += block.text;

        blocks.splice(idx, 1);

        tx.result = prev;
        break;
      }
    }
  }
};

/* =========================================================
   STATE
========================================================= */

let editorPanel = null;
let previewPanel = null;

const BlockCache = new Map();
let activeBlockId = null;

/* =========================================================
   SCHEDULING
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
   CURSOR
========================================================= */

const Cursor = {
  blockId: null,
  offset: 0
};

function saveCursor(el, block) {
  Cursor.blockId = block.id;
  Cursor.offset = el.selectionStart ?? el.innerText.length;
}

function restoreCursor() {
  requestAnimationFrame(() => {

    const el = editorPanel.querySelector(
      `[data-id="${Cursor.blockId}"]`
    );

    if (!el) return;

    el.focus();

    try {
      el.setSelectionRange(Cursor.offset, Cursor.offset);
    } catch {}
  });
}

/* =========================================================
   SDUI BUILDER (FIXED CONTRACT)
========================================================= */

async function loadUI() {

  const res = await fetch("./ui.json");
  const schema = await res.json();

  buildUI(schema, document.body);

  // CONTRACT RESOLUTION STEP
  UI.editorPanel = document.querySelector('[role="editor-panel"]');
  UI.previewPanel = document.querySelector('[role="preview-panel"]');

  if (!UI.editorPanel || !UI.previewPanel) {
    throw new Error("UI CONTRACT FAILED: missing panels");
  }
}

function buildUI(node, parent) {

  switch (node.type) {

    case "page":
      node.children?.forEach(c => buildUI(c, parent));
      break;

    case "main":
      const main = document.querySelector("main") || parent;
      node.children?.forEach(c => buildUI(c, main));
      break;

    case "section":
      const el = document.createElement("section");

      if (node.role) {
        el.setAttribute("role", node.role);
      }

      parent.appendChild(el);
      break;
  }
}

/* =========================================================
   BLOCK ELEMENTS
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

    TransactionEngine.apply({
      type: TX.UPDATE,
      block,
      value: el.innerText
    });

    saveCursor(el, block);

    queuePreviewRender();
    queueEditorRender();
  });

  el.addEventListener("keydown", (e) => {
    handleKey(e, el, block);
  });

  return el;
}

/* =========================================================
   EDITOR RENDER
========================================================= */

function renderEditor() {

  const blocks = DocumentModel.get();
  const container = editorPanel;

  const active = new Set();

  for (const block of blocks) {

    active.add(block.id);

    let el = BlockCache.get(block.id);

    if (!el) {
      el = createBlockElement(block);
      BlockCache.set(block.id, el);
    }

    if (block.id !== activeBlockId) {
      el.innerText = block.text;
    }

    if (el.parentNode !== container) {
      container.appendChild(el);
    }
  }

  for (const [id, el] of BlockCache.entries()) {
    if (!active.has(id)) {
      el.remove();
      BlockCache.delete(id);
    }
  }
}

/* =========================================================
   KEY HANDLER
========================================================= */

function handleKey(e, el, block) {

  const pos = el.selectionStart ?? el.innerText.length;

  if (e.key === "Enter") {
    e.preventDefault();

    const tx = {
      type: TX.SPLIT,
      block,
      pos
    };

    TransactionEngine.apply(tx);

    queueEditorRender();
    queuePreviewRender();

    Cursor.blockId = tx.result.id;
    Cursor.offset = 0;

    restoreCursor();
    return;
  }

  if (e.key === "Backspace" && pos === 0) {
    e.preventDefault();

    const tx = {
      type: TX.MERGE,
      block
    };

    TransactionEngine.apply(tx);

    queueEditorRender();
    queuePreviewRender();

    if (tx.result) {
      Cursor.blockId = tx.result.id;
      Cursor.offset = tx.result.text.length;
      restoreCursor();
    }
  }
}

/* =========================================================
   PREVIEW
========================================================= */

function renderMarkdown(text) {
  if (!text) return "";

  return text
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.*?)\*/g, "<i>$1</i>");
}

function renderPreview() {

  if (!UI.previewPanel) return;

  const blocks = DocumentModel.get();

  UI.previewPanel.innerHTML = "";

  for (const b of blocks) {
    const el = document.createElement("div");
    el.innerHTML = renderMarkdown(b.text);
    UI.previewPanel.appendChild(el);
  }
}

/* =========================================================
   INIT
========================================================= */

async function init() {

  await loadUI();

  editorPanel = UI.editorPanel;
  previewPanel = UI.previewPanel;

  DocumentModel.set([
    createBlock("paragraph", "")
  ]);

  renderEditor();
  renderPreview();
}

init();
