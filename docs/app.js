/* =========================================================
   Markdown Lab — app.js
   Core UX + rendering orchestration layer
   ES2025+ clean modular style (no frameworks)
========================================================= */

/* -----------------------------
   Utilities
----------------------------- */

const debounce = (fn, wait = 60) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
};

const escapeHtml = (str) =>
  str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/* -----------------------------
   State
----------------------------- */

const state = {
  storageKey: "vanilla_md_doc_v1",
  themeKey: "vanilla_md_theme_v1"
};

/* -----------------------------
   DOM refs (initialized later)
----------------------------- */

let editor;
let preview;

/* -----------------------------
   Autosave system
----------------------------- */

const storage = {
  save(content) {
    localStorage.setItem(state.storageKey, content);
  },

  load() {
    return localStorage.getItem(state.storageKey) || "";
  }
};

/* -----------------------------
   Scroll Sync System
----------------------------- */

function attachScrollSync(editorEl, previewEl) {
  let ticking = false;

  editorEl.addEventListener("scroll", () => {
    if (ticking) return;

    ticking = true;

    requestAnimationFrame(() => {
      const ratio =
        editorEl.scrollTop /
        Math.max(1, editorEl.scrollHeight - editorEl.clientHeight);

      previewEl.scrollTop =
        ratio *
        Math.max(1, previewEl.scrollHeight - previewEl.clientHeight);

      ticking = false;
    });
  });
}

/* -----------------------------
   Render Pipeline (core markdown)
   NOTE: intentionally minimal here
   plugins will extend later
----------------------------- */

function renderMarkdown(src) {
  // step 1: escape first
  let text = escapeHtml(src);

  // step 2: headings
  text = text
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>");

  // step 3: bold
  text = text.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");

  // step 4: inline math placeholder
  text = text.replace(/\$(.+?)\$/g, "<span class='math'>$1</span>");

  // step 5: line breaks
  text = text.replace(/\n/g, "<br>");

  return text;
}

/* -----------------------------
   Render Controller
   - prevents unnecessary DOM updates
----------------------------- */

function createRenderController() {
  let last = "";

  return {
    render(content) {
      const html = renderMarkdown(content);

      if (html === last) return html;

      last = html;
      preview.innerHTML = html;

      return html;
    }
  };
}

/* -----------------------------
   Autosave + render pipeline
----------------------------- */

function createEditorLoop(controller) {
  const save = debounce((value) => {
    storage.save(value);
  }, 250);

  const render = debounce(() => {
    const value = editor.value;

    controller.render(value);
    save(value);
  }, 50);

  return { render };
}

/* -----------------------------
   Theme system (basic hook)
----------------------------- */

function initTheme() {
  const saved = localStorage.getItem(state.themeKey);

  if (saved === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else if (saved === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    // system default
    document.documentElement.removeAttribute("data-theme");
  }
}

/* -----------------------------
   App bootstrap
----------------------------- */

function init() {
  editor = document.querySelector("#editor");
  preview = document.querySelector("#preview");

  initTheme();

  const controller = createRenderController();
  const loop = createEditorLoop(controller);

  // load saved content
  editor.value = storage.load();

  // initial render
  controller.render(editor.value);

  // input → pipeline
  editor.addEventListener("input", loop.render);

  // scroll sync
  attachScrollSync(editor, preview);
}

/* -----------------------------
   boot
----------------------------- */

document.addEventListener("DOMContentLoaded", init);
