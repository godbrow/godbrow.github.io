
/* =========================================================
   SINGLE APP CORE (v12)
   - unified state
   - SDUI contract
   - transaction engine
   - normalization engine
========================================================= */

const EditorApp = {

  /* -------------------------
     UI CONTRACT
  ------------------------- */
  UI: {
    editorPanel: null,
    previewPanel: null
  },

  /* -------------------------
     STATE
  ------------------------- */
  state: {
    blocks: [],
    blockCache: new Map(),
    activeBlockId: null
  },

  /* -------------------------
     CURSOR
  ------------------------- */
  cursor: {
    blockId: null,
    offset: 0
  },

  /* -------------------------
     TRANSACTION TYPES
  ------------------------- */
  TX: {
    UPDATE: "update",
    SPLIT: "split",
    MERGE: "merge"
  }
};

/* =========================================================
   BLOCK FACTORY
========================================================= */

let globalId = 0;

function createBlock(type = "paragraph", text = "") {
  return { id: globalId++, type, text };
}

/* =========================================================
   DOCUMENT HELPERS
========================================================= */

function getBlocks() {
  return EditorApp.state.blocks;
}

function setBlocks(b) {
  EditorApp.state.blocks = b;
}

/* =========================================================
   TRANSACTION ENGINE
========================================================= */

const TransactionEngine = {

  apply(tx) {

    const blocks = getBlocks();

    switch (tx.type) {

      case EditorApp.TX.UPDATE: {
        tx.block.text = tx.value;
        break;
      }

      case EditorApp.TX.SPLIT: {
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

      case EditorApp.TX.MERGE: {
        const { block } = tx;

        const idx = blocks.indexOf(block);
        if (idx === 0 && blocks.length > 1) {
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
   NORMALIZATION ENGINE
========================================================= */

const Normalizer = {

  run() {

    const blocks = getBlocks();

    if (blocks.length === 0) {
      blocks.push(createBlock("paragraph", ""));
      return;
    }

    for (let i = blocks.length - 1; i >= 1; i--) {
      if (blocks[i].text === "" && blocks[i - 1].text === "") {
        blocks[i - 1].text += blocks[i].text;
        blocks.splice(i, 1);
      }
    }

    for (const b of blocks) {
      if (b.text == null) b.text = "";
    }
  }
};

/* =========================================================
   RENDER SCHEDULING
========================================================= */

let editorQueued = false;
let previewQueued = false;

function queueEditorRender() {
  if (editorQueued) return;

  editorQueued = true;

  requestAnimationFrame(() => {
    editorQueued = false;

    Normalizer.run();
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
   CURSOR HELPERS
========================================================= */

function saveCursor(el, block) {
  EditorApp.cursor.blockId = block.id;
  EditorApp.cursor.offset = el.selectionStart ?? el.innerText.length;
}

function restoreCursor() {

  requestAnimationFrame(() => {

    const el = EditorApp.UI.editorPanel.querySelector(
      `[data-id="${EditorApp.cursor.blockId}"]`
    );

    if (!el) return;

    el.focus();

    try {
      el.setSelectionRange(
        EditorApp.cursor.offset,
        EditorApp.cursor.offset
      );
    } catch {}
  });
}

/* =========================================================
   SDUI LAYER
========================================================= */

async function loadUI() {

  const res = await fetch("./ui.json");
  const schema = await res.json();

  buildUI(schema, document.body);

  EditorApp.UI.editorPanel =
    document.querySelector('[role="editor-panel"]');

  EditorApp.UI.previewPanel =
    document.querySelector('[role="preview-panel"]');

  if (!EditorApp.UI.editorPanel || !EditorApp.UI.previewPanel) {
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
    EditorApp.state.activeBlockId = block.id;
  });

  el.addEventListener("blur", () => {
    EditorApp.state.activeBlockId = null;
  });

  el.addEventListener("input", () => {

    TransactionEngine.apply({
      type: EditorApp.TX.UPDATE,
      block,
      value: el.innerText
    });

    saveCursor(el, block);

    queuePreviewRender();
    queueEditorRender();
  });

  el.addEventListener("keydown", (e) =>
    handleKey(e, el, block)
  );

  return el;
}

/* =========================================================
   RENDER EDITOR
========================================================= */

function renderEditor() {

  const blocks = getBlocks();
  const container = EditorApp.UI.editorPanel;

  const active = new Set();

  for (const block of blocks) {

    active.add(block.id);

    let el = EditorApp.state.blockCache.get(block.id);

    if (!el) {
      el = createBlockElement(block);
      EditorApp.state.blockCache.set(block.id, el);
    }

    if (block.id !== EditorApp.state.activeBlockId) {
      el.innerText = block.text;
    }

    if (el.parentNode !== container) {
      container.appendChild(el);
    }
  }

  for (const [id, el] of EditorApp.state.blockCache.entries()) {
    if (!active.has(id)) {
      el.remove();
      EditorApp.state.blockCache.delete(id);
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
      type: EditorApp.TX.SPLIT,
      block,
      pos
    };

    TransactionEngine.apply(tx);

    queueEditorRender();
    queuePreviewRender();

    EditorApp.cursor.blockId = tx.result.id;
    EditorApp.cursor.offset = 0;

    restoreCursor();
    return;
  }

  if (e.key === "Backspace") {

    if (pos === 0) {
      e.preventDefault();

      const tx = {
        type: EditorApp.TX.MERGE,
        block
      };

      TransactionEngine.apply(tx);

      queueEditorRender();
      queuePreviewRender();

      if (tx.result) {
        EditorApp.cursor.blockId = tx.result.id;
        EditorApp.cursor.offset = tx.result.text.length;
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

  const panel = EditorApp.UI.previewPanel;
  if (!panel) return;

  const blocks = getBlocks();

  panel.innerHTML = "";

  for (const b of blocks) {
    const el = document.createElement("div");
    el.innerHTML = renderMarkdown(b.text);
    panel.appendChild(el);
  }
}

/* =========================================================
   INIT
========================================================= */

async function init() {

  await loadUI();

  setBlocks([createBlock("paragraph", "")]);

  renderEditor();
  renderPreview();
}

init();
