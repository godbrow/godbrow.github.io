
/* =========================================================
   TRANSACTION ENGINE CORE (v9)
========================================================= */

/* =========================================================
   DOCUMENT STATE
========================================================= */

const DocumentModel = {
  blocks: [],

  set(blocks) {
    this.blocks = blocks;
  },

  get() {
    return this.blocks;
  }
};

/* =========================================================
   TRANSACTION TYPES
========================================================= */

const TX = {
  UPDATE: "update",
  SPLIT: "split",
  MERGE: "merge"
};

/* =========================================================
   TRANSACTION ENGINE
========================================================= */

const TransactionEngine = {

  apply(tx) {

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

        const arr = DocumentModel.get();
        const idx = arr.indexOf(block);

        arr.splice(idx + 1, 0, newBlock);

        tx.result = newBlock;
        break;
      }

      case TX.MERGE: {
        const { block } = tx;

        const arr = DocumentModel.get();
        const idx = arr.indexOf(block);

        if (idx === 0) return;

        const prev = arr[idx - 1];

        prev.text += block.text;

        arr.splice(idx, 1);

        tx.result = prev;
        break;
      }
    }
  }
};

/* =========================================================
   BLOCK FACTORY
========================================================= */

let globalId = 0;

function createBlock(type = "paragraph", text = "") {
  return {
    id: globalId++,
    type,
    text
  };
}

/* =========================================================
   STATE
========================================================= */

let editorPanel = null;
let previewPanel = null;

const BlockCache = new Map();
let activeBlockId = null;

/* =========================================================
   SCHEDULING (STABLE)
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
   CURSOR STATE
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
   EDITOR ELEMENT
========================================================= */

function createEditorBlock(block) {

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
   RENDER EDITOR (NO DIRECT MUTATION)
========================================================= */

function renderEditor() {

  const blocks = DocumentModel.get();
  const container = editorPanel;

  const active = new Set();

  for (const block of blocks) {

    active.add(block.id);

    let el = BlockCache.get(block.id);

    if (!el) {
      el = createEditorBlock(block);
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
   KEY HANDLER (TRANSACTION BASED)
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

    return;
  }
}

/* =========================================================
   PREVIEW
========================================================= */

function renderPreview() {

  if (!previewPanel) return;

  const blocks = DocumentModel.get();

  previewPanel.innerHTML = "";

  for (const b of blocks) {
    const el = document.createElement("div");
    el.dataset.id = b.id;
    el.innerHTML = renderMarkdown(b.text);
    previewPanel.appendChild(el);
  }
}

function renderMarkdown(text) {
  if (!text) return "";

  return text
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.*?)\*/g, "<i>$1</i>");
}

/* =========================================================
   INIT
========================================================= */

function init() {

  editorPanel = document.querySelector('[role="editor-panel"]');
  previewPanel = document.querySelector('[role="preview-panel"]');

  if (!editorPanel || !previewPanel) {
    console.error("Missing editor panels");
    return;
  }

  DocumentModel.set([
    createBlock("paragraph", "")
  ]);

  renderEditor();
  renderPreview();
}

init();
