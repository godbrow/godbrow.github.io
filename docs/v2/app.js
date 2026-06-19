/* =========================================================
   SDUI Block Editor Kernel v3
   - Block-based model
   - Virtualized editor
   - Split / merge editing
   - Preview renderer
========================================================= */

/* =========================================================
   STATE
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
   BLOCK MODEL
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
   INITIAL PARSER (string → blocks)
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
   VIRTUALIZATION ENGINE
========================================================= */

const VirtualState = {
  start: 0,
  end: 0,
  buffer: 6
};

function estimateHeight(block) {
  const base = 28;
  const lines = block.text.split("\n").length;
  return base + lines * 18;
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
   DOM REFERENCES
========================================================= */

let editorPanel = null;
let previewPanel = null;

/* =========================================================
   INIT SDUI (minimal semantic loader)
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
   EDITOR RENDER (virtual blocks)
========================================================= */

function renderEditorVirtual() {

  const blocks = DocumentModel.getBlocks();
  const container = editorPanel;

  container.innerHTML = "";

  for (
    let i = VirtualState.start;
    i < VirtualState.end;
    i++
  ) {
    const block = blocks[i];
    if (!block) continue;

    const el = document.createElement("div");

    el.contentEditable = true;
    el.dataset.id = block.id;
    el.innerText = block.text;

    el.addEventListener("input", () => {
      block.text = el.innerText;

      renderPreview();
    });

    el.addEventListener("keydown", (e) => {
      handleBlockEditing(e, el, block);
    });

    container.appendChild(el);
  }
}

/* =========================================================
   BLOCK EDITING LOGIC (split / merge)
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

  const cursorOffset = prev.text.length;

  prev.text += block.text;

  blocks.splice(index, 1);

  return { block: prev, cursorOffset };
}

function handleBlockEditing(e, el, block) {

  const cursorPos = el.innerText.length;

  if (e.key === "Enter") {
    e.preventDefault();

    const newBlock = splitBlock(block, cursorPos);

    scheduleRender();

    focusBlock(newBlock);
  }

  if (e.key === "Backspace" && cursorPos === 0) {
    e.preventDefault();

    const result = mergeWithPrevious(block);

    scheduleRender();

    if (result) focusBlock(result.block);
  }
}

function focusBlock(block) {
  requestAnimationFrame(() => {
    const el = editorPanel.querySelector(
      `[data-id="${block.id}"]`
    );

    if (el) el.focus();
  });
}

/* =========================================================
   PREVIEW RENDERER
========================================================= */

function renderBlock(block) {

  const text = block.text;

  switch (block.type) {

    case "h1":
      return `<h1>${text}</h1>`;

    case "h2":
      return `<h2>${text}</h2>`;

    case "quote":
      return `<blockquote>${text}</blockquote>`;

    default:
      return `<p>${text}</p>`;
  }
}

function renderPreview() {

  if (!previewPanel) {
    previewPanel = document.querySelector('[role="preview-panel"]');
  }

  const blocks = DocumentModel.getBlocks();

  previewPanel.innerHTML =
    blocks.map(renderBlock).join("");
}

/* =========================================================
   MAIN RENDER PIPELINE
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
   EDITOR INIT
========================================================= */

function initEditor() {

  editorPanel = document.querySelector('[role="editor-panel"]');
  previewPanel = document.querySelector('[role="preview-panel"]');

  editorPanel.addEventListener("scroll", () => {
    scheduleRender();
  });

  editorPanel.contentEditable = false;
}

/* =========================================================
   BOOTSTRAP
========================================================= */

async function init() {

  await loadUI();

  initEditor();

  const initial = "";

  const blocks = parseToBlocks(initial);

  DocumentModel.setBlocks(blocks);

  scheduleRender();
  renderPreview();
}

init();
