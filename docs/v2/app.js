
/* =========================================================
   SDUI + TRANSACTION + NORMALIZATION ENGINE (v11)
========================================================= */

/* =========================================================
   UI CONTRACT
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

/* =========================================================
   TRANSACTION ENGINE
========================================================= */

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

        const blocks = DocumentModel.get();
        const idx = blocks.indexOf(block);

        if (idx === 0 && blocks.length > 1) {
          // merge downward fallback
          const next = blocks[1];
          next.text = block.text + next.text;
          blocks.splice(idx, 1);
          tx.result = next;
          break;
        }

        if (idx > 0) {
          const prev = blocks[idx - 1];
          prev.text += block.text;
          blocks.splice(idx, 1);
          tx.result = prev;
        }

        break;
      }
    }
  }
};

/* =========================================================
   NORMALIZATION ENGINE (🔥 CORE ADDITION)
========================================================= */

const Normalizer = {

  run() {
    const blocks = DocumentModel.get();

    if (blocks.length === 0) {
      blocks.push(createBlock("paragraph", ""));
      return;
    }

    // RULE 1: remove duplicate empty blocks
    for (let i = blocks.length - 1; i >= 1; i--) {
      if (blocks[i].text === "" && blocks[i - 1].text === "") {
        blocks[i - 1].text += blocks[i].text;
        blocks.splice(i, 1);
      }
    }

    // RULE 2: ensure at least one block exists
    if (blocks.length === 0) {
      blocks.push(createBlock("paragraph", ""));
    }

    // RULE 3: ensure no dangling null states
    for (const b of blocks) {
      if (b.text == null) b.text = "";
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
    Normalizer.run();        // 🔥 IMPORTANT
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
   SDUI (UNCHANGED BUT SAFE)
========================================================= */

async function loadUI() {

  const res = await fetch("./ui.json");
  const schema = await res.json();

  buildUI(schema, document.body);

  UI.editorPanel = document.querySelector('[role="editor-panel"]');
  UI.previewPanel = document.querySelector('[role="preview-panel"]');

  if (!UI.editorPanel || !UI.previewPanel) {
    throw new Error("UI CONTRACT FAILED");
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
   EDITOR
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

  el.addEventListener("keydown", (e) => handleKey(e, el, block));

  return el;
}

/* =========================================================
   RENDER EDITOR
========================================================= */

const BlockCache = new Map();

function renderEditor() {

  const blocks = DocumentModel.get();
  const container = UI.editorPanel;

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

  if (e.key === "Backspace") {

    const pos = el.selectionStart ?? el.innerText.length;

    if (pos === 0) {
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

  DocumentModel.set([createBlock("paragraph", "")]);

  renderEditor();
  renderPreview();
}

init();
