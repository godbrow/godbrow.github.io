/* =========================================================
   SDUI Markdown Editor — app.js (CORE v1)
   Clean slate architecture
========================================================= */

/* =========================================================
   STATE (Single Source of Truth)
========================================================= */

const DocumentModel = {
  text: "",

  set(value) {
    this.text = value;
  },

  get() {
    return this.text;
  }
};

/* =========================================================
   SDUI RENDERER
========================================================= */

async function loadUI() {
  const res = await fetch("./ui.json");
  const schema = await res.json();

  renderNode(schema, document.body);
}

function renderNode(node, parent) {
  let el;

  switch (node.type) {

    case "page":
      node.children?.forEach(child =>
        renderNode(child, parent)
      );
      return;

    case "main":
      el = document.querySelector("main");

      node.children?.forEach(child =>
        renderNode(child, el)
      );
      return;

    case "section":
      el = document.createElement("section");

      if (node.role) {
        el.setAttribute("role", node.role);
      }

      parent.appendChild(el);
      node.el = el;
      return;

    default:
      console.warn("Unknown SDUI node:", node);
  }
}

/* =========================================================
   EDITOR ENGINE (contentEditable root)
========================================================= */

let editorPanel = null;
let previewPanel = null;

function initEditor() {
  editorPanel = document.querySelector(
    '[role="editor-panel"]'
  );

  previewPanel = document.querySelector(
    '[role="preview-panel"]'
  );

  editorPanel.contentEditable = true;
  editorPanel.spellcheck = false;

  editorPanel.addEventListener("input", onEditorInput);
}

/* =========================================================
   INPUT HANDLER
========================================================= */

function onEditorInput() {
  const value = editorPanel.innerText;

  DocumentModel.set(value);

  renderPreview();
}

/* =========================================================
   MARKDOWN ENGINE (minimal core v1)
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
    .replace(/`([^`]+)`/g, "<code>$1</code>")

    .replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>")

    .replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>")

    .replace(/\n/g, "<br>");
}

/* =========================================================
   PREVIEW RENDERER
========================================================= */

function renderPreview() {
  if (!previewPanel) return;

  const text = DocumentModel.get();

  previewPanel.innerHTML = renderMarkdown(text);
}

/* =========================================================
   SDUI THEME / SYSTEM HOOK (future-ready)
========================================================= */

const AppRuntime = {
  theme: "system",

  setTheme(mode) {
    this.theme = mode;
    document.documentElement.dataset.theme = mode;
  }
};

/* =========================================================
   SERVICE WORKER REGISTRATION
========================================================= */

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.register("./worker.js")
    .catch(err => {
      console.warn("SW registration failed:", err);
    });
}

/* =========================================================
   BOOTSTRAP
========================================================= */

async function init() {
  await loadUI();

  initEditor();

  registerServiceWorker();

  DocumentModel.set("");

  renderPreview();
}

/* =========================================================
   START APP
========================================================= */

init();
