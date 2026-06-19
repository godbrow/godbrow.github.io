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
  let text = escapeHtml(src);

  /* =====================================================
     1. BLOCKS (structural elements first)
  ===================================================== */

  // HEADINGS
  text = text
    .replace(/^###### (.*)$/gm, "<h6>$1</h6>")
    .replace(/^##### (.*)$/gm, "<h5>$1</h5>")
    .replace(/^#### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>");

  // BLOCKQUOTE
  text = text.replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>");

  // UNORDERED LISTS (simple grouped version)
  text = text.replace(
    /(?:^[-*] .*(\n|$))+?/gm,
    (match) => {
      const items = match
        .trim()
        .split("\n")
        .map((line) => line.replace(/^[-*] /, ""))
        .map((item) => `<li>${item}</li>`)
        .join("");

      return `<ul>${items}</ul>`;
    }
  );

  // ORDERED LISTS
  text = text.replace(
    /(?:^\d+\. .*(\n|$))+?/gm,
    (match) => {
      const items = match
        .trim()
        .split("\n")
        .map((line) => line.replace(/^\d+\. /, ""))
        .map((item) => `<li>${item}</li>`)
        .join("");

      return `<ol>${items}</ol>`;
    }
  );

  /* =====================================================
     2. INLINE ELEMENTS
  ===================================================== */

  // INLINE CODE
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

  // BOLD
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // ITALIC
  text = text.replace(/\*(.+?)\*/g, "<i>$1</i>");

  // LINKS [text](url)
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
    `<a href="$2" target="_blank" rel="noopener">$1</a>`
  );

  // INLINE MATH
  text = text.replace(/\$(.+?)\$/g, "<span class='math'>$1</span>");

  /* =====================================================
     3. CODE BLOCKS (last step to avoid interference)
  ===================================================== */

  const codeBlocks = [];

  text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    const id = codeBlocks.length;
    codeBlocks.push({ lang, code });
    return `@@CODE${id}@@`;
  });

  text = text.replace(/@@CODE(\d+)@@/g, (_, i) => {
    const { lang, code } = codeBlocks[i];

    const safe = escapeHtml(code);

    return `
      <pre><code class="lang-${lang || "text"}">${safe}</code></pre>
    `;
  });

  /* =====================================================
     4. FINAL LINE HANDLING
  ===================================================== */

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
