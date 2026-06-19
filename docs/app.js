/* global caches */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  const mdEl = $("#md");
  const previewEl = $("#previewContent");
  const statusEl = $("#status");

  const splitBtn = document.querySelector('[data-action="split"]');
  const themeBtn = document.querySelector('[data-action="theme"]');

  const STORAGE_KEY = "md-editor.content.v1";
  const SETTINGS_KEY = "md-editor.settings.v1";

  const DEFAULT_TEXT = `# Hello

Write **Markdown** here.

- Bullets
- Lists
- \`inline code\`

> Tip: select text and click toolbar buttons.
`;

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  const now = () => performance.now();

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return {};
      return JSON.parse(raw) ?? {};
    } catch {
      return {};
    }
  }

  function saveSettings(s) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      // ignore
    }
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    root.dataset.theme = theme;
    try { localStorage.setItem("md-editor.theme.v1", theme); } catch {}
  }

  function getPreferredTheme() {
    const stored = (() => { try { return localStorage.getItem("md-editor.theme.v1"); } catch { return null; } })();
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme || getPreferredTheme();
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    render();
  }

  // --- Minimal vanilla Markdown renderer (no external libs) ---
  // Supports:
  // - headings (#..######
  // - bold/italic
  // - inline code
  // - code fences ```lang? (lang ignored)
  // - links [text](url)
  // - blockquote >
  // - unordered/ordered lists
  // - paragraphs + line breaks (gfm breaks)
  // - horizontal rule ---
  //
  // Note: this is intentionally simple and not a full CommonMark implementation.
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function inline(md) {
    let s = md;

    // inline code
    s = s.replace(/`([^`]+)`/g, (_, code) => `<code>\${escapeHtml(code)}</code>\`);

    // links
    s = s.replace(/$$([^$$]+)\\]$(https?:\/\/[^\s)]+|mailto:[^\s)]+|\/[^\s)]+)$/g, (\_, text, url) => {
      const safeUrl = url.replace(/"/g, "%22");
      return `<a href="${safeUrl}" target="_blank" rel="noreferrer noopener">${escapeHtml(text)}</a>`;
    });

    // bold then italic
    s = s.replace(/\\\*\\\*([^\*]+)\\\*\\\*/g, (\_, t) => `<strong>${escapeHtml(t)}</strong>`);
    s = s.replace(/\_\_([^\_]+)\_\_/g, (\_, t) => `<strong>${escapeHtml(t)}</strong>`);
    s = s.replace(/\\\*([^\*]+)\\\*/g, (\_, t) => `<em>${escapeHtml(t)}</em>`);
    s = s.replace(/\_([^\_]+)\_/g, (\_, t) => `<em>${escapeHtml(t)}</em>`);

    // breaks
    s = s.replace(/\n/g, "<br />");
    return s;
  }

  function parseMarkdown(md) {
    // Normalize newlines
    const text = (md ?? "").replace(/\r\n?/g, "\n");

    // Tokenize code fences first
    const fenceRegex = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
    let placeholders = [];
    let working = text.replace(fenceRegex, (\_, lang, code) => {
      const idx = placeholders.length;
      placeholders.push({
        lang: lang ?? "",
        code
      });
      return `@@FENCE_${idx}@@`;
    });

    const lines = working.split("\n");

    let html = [];
    let i = 0;

    function peekNonEmpty(start) {
      for (let k = start; k < lines.length; k++) {
        if (lines[k].trim() !== "") return lines[k];
      }
      return "";
    }

    while (i < lines.length) {
      const line = lines[i];

      // Horizontal rule ---
      if (/^\s\*(---|\\\*\\\*\\\*|\_\_\_)\s\*\$/.test(line)) {
        html.push(`<hr />`);
        i++;
        continue;
      }

      // Code fence placeholder line
      const fenceMatch = line.match(/^@@FENCE\_(\d+)@@\$/);
      if (fenceMatch) {
        const idx = Number(fenceMatch[1]);
        const code = placeholders[idx]?.code ?? "";
        html.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
        i++;
        continue;
      }

      // Blockquote (consecutive lines starting with >)
      if (/^\s\*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s\*>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s\*>\s?/, ""));
          i++;
        }
        const content = inline(buf.join("\n"));
        html.push(`<blockquote>${content}</blockquote>`);
        continue;
      }

      // Headings
      const h = line.match(/^(#{1,6})\s+(.\*)\$/);
      if (h) {
        const level = h[1].length;
        html.push(`<h${level}>${inline(h[2].trim())}</h${level}>`);
        i++;
        continue;
      }

      // Lists (unordered / ordered)
      const ul = line.match(/^\s\*([-\*+])\s+(.\*)\$/);
      const ol = line.match(/^\s\*(\d+)\\.\s+(.\*)\$/);

      if (ul || ol) {
        const ordered = !!ol;
        let listItems = [];

        while (i < lines.length) {
          const cur = lines[i];

          const mUl = !ordered ? cur.match(/^\s\*([-\*+])\s+(.\*)\$/) : null;
          const mOl = ordered ? cur.match(/^\s\*(\d+)\\.\s+(.\*)\$/) : null;

          if (!mUl && !mOl) break;

          const itemText = (ordered ? mOl[2] : mUl[2]);
          listItems.push(`<li>${inline(itemText)}</li>`);
          i++;
        }

        html.push(ordered ? `<ol>${listItems.join("")}</ol>` : `<ul>${listItems.join("")}</ul>`);
        continue;
      }

      // Blank line: skip
      if (line.trim() === "") {
        i++;
        continue;
      }

      // Paragraph: gather until blank line or block start
      let buf = [line];
      i++;
      while (i < lines.length) {
        const nxt = lines[i];
        if (nxt.trim() === "") break;

        if (/^(#{1,6})\s+/.test(nxt)) break;
        if (/^\s\*>\s?/.test(nxt)) break;
        if (/^\s\*([-\*+])\s+/.test(nxt)) break;
        if (/^\s\*(\d+)\\.\s+/.test(nxt)) break;
        if (/^\s\*(---|\\\*\\\*\\\*|\_\_\_)\s\*\$/.test(nxt)) break;

        // Fence placeholder line starts its own block
        if (/^@@FENCE\_\d+@@\$/.test(nxt)) break;

        buf.push(nxt);
        i++;
      }

      const p = inline(buf.join("\n"));
      html.push(`<p>${p}</p>`);
    }

    return html.join("\n");
  }

  function render() {
    const t0 = now();
    const html = parseMarkdown(mdEl.value);
    previewEl.innerHTML = html;

    const dt = Math.round(now() - t0);
    if (statusEl) statusEl.textContent = `Rendered in ${dt}ms`;
  }

  // --- Toolbar helpers ---
  function wrapSelection(before, after, fallbackText = "") {
    const el = mdEl;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;

    const selected = el.value.slice(start, end);
    const insert = before + (selected || fallbackText) + after;

    // Replace selection
    el.setRangeText(insert, start, end, "end");
    el.focus();

    // Put caret inside selection area when possible
    if (!selected && fallbackText) {
      const caretPos = start + before.length;
      el.setSelectionRange(caretPos, caretPos + fallbackText.length);
    }
  }

  function prefixLines(prefix) {
    const el = mdEl;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;

    const v = el.value;
    const selStart = start;
    const selEnd = end;

    // Expand to line boundaries
    let lineStart = v.lastIndexOf("\n", selStart - 1);
    lineStart = lineStart === -1 ? 0 : lineStart + 1;

    let lineEnd = v.indexOf("\n", selEnd);
    lineEnd = lineEnd === -1 ? v.length : lineEnd;

    const segment = v.slice(lineStart, lineEnd);
    const lines = segment.split("\n");
    const changed = lines.map(l => (l.trim() === "" ? l : prefix + l)).join("\n");

    el.setRangeText(changed, lineStart, lineEnd, "end");
    el.focus();
    el.setSelectionRange(lineStart, lineStart + changed.length);
  }

  function toggleSplit(saved) {
    const layout = document.querySelector(".layout");
    const editorPanel = \$("#editor").closest(".panel");
    const previewPanel = \$("#preview").closest(".panel");

    const on = saved;
    if (on) {
      // split mode
      layout.style.gridTemplateColumns = "1fr 1fr";
      splitBtn?.setAttribute("aria-pressed", "true");
    } else {
      // single-pane mode: show preview only (default)
      layout.style.gridTemplateColumns = "1fr";
      editorPanel?.style.display = "none";
      previewPanel?.style.display = "block";
      splitBtn?.setAttribute("aria-pressed", "false");
    }
  }

  function setupScrollSync() {
    const editorWrap = \$("#editor").parentElement; // panel
    const editor = mdEl;

    // We sync editor scrollTop to preview scrollTop proportionally
    let syncing = false;

    editor.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true;

      const e = editor;
      const p = previewEl;

      const eMax = Math.max(1, e.scrollHeight - e.clientHeight);
      const pMax = Math.max(1, p.scrollHeight - p.clientHeight);

      const ratio = e.scrollTop / eMax;
      p.scrollTop = ratio \* pMax;

      syncing = false;
    });
  }

  function setupKeyboardShortcuts() {
    mdEl.addEventListener("keydown", (e) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      const key = e.key.toLowerCase();

      if (key === "b") {
        e.preventDefault();
        wrapSelection("\*\*", "\*\*");
      } else if (key === "i") {
        e.preventDefault();
        wrapSelection("\*", "\*");
      } else if (key === "/") {
        e.preventDefault();
        wrapSelection("`", "`");
      }
    });
  }

  function bindToolbar() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");

      if (action === "bold") wrapSelection("\*\*", "\*\*");
      else if (action === "italic") wrapSelection("\*", "\*");
      else if (action === "code") wrapSelection("`", "`");
      else if (action === "quote") prefixLines("> ");
      else if (action === "ul") prefixLines("- ");
      else if (action === "ol") {
        // number list: handle by prefixing starting at 1 per selected line
        const el = mdEl;
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;

        const v = el.value;
        let lineStart = v.lastIndexOf("\n", start - 1);
        lineStart = lineStart === -1 ? 0 : lineStart + 1;

        let lineEnd = v.indexOf("\n", end);
        lineEnd = lineEnd === -1 ? v.length : lineEnd;

        const segment = v.slice(lineStart, lineEnd);
        const lines = segment.split("\n");

        let n = 1;
        const changed = lines.map(l => (l.trim() === "" ? l : `${n++}. ${l}`)).join("\n");

        el.setRangeText(changed, lineStart, lineEnd, "end");
        el.focus();
        el.setSelectionRange(lineStart, lineStart + changed.length);
      }
      else if (action === "export-md") {
        const blob = new Blob([mdEl.value], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const base = `markdown-editor-${new Date().toISOString().slice(0,10)}`;
        a.href = url;
        a.download = `${base}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      else if (action === "theme") toggleTheme();
      else if (action === "split") {
        const s = loadSettings();
        const next = !(s.split ?? true);
        s.split = next;
        saveSettings(s);
        // If split off, show preview only; turning split back on restores editor
        const editorPanel = \$("#editor").closest(".panel");
        if (next) {
          document.querySelector(".layout").style.gridTemplateColumns = "1fr 1fr";
          editorPanel.style.display = "";
          \$("#preview").closest(".panel").style.display = "";
        } else {
          document.querySelector(".layout").style.gridTemplateColumns = "1fr";
          editorPanel.style.display = "none";
        }
        btn.setAttribute("aria-pressed", String(next));
      }
      else if (action === "clear") {
        const ok = confirm("Clear saved markdown for this browser?");
        if (!ok) return;
        try { localStorage.removeItem(STORAGE\_KEY); } catch {}
        mdEl.value = DEFAULT\_TEXT;
        render();
        persistSoon();
      }
    });
  }

  // --- Autosave to localStorage (debounced) ---
  let saveTimer = 0;
  function persistSoon() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try { localStorage.setItem(STORAGE\_KEY, mdEl.value); } catch {}
    }, 250);
  }

  // --- Load initial content ---
  function loadContent() {
    try {
      const saved = localStorage.getItem(STORAGE\_KEY);
      if (saved && saved.trim() !== "") {
        mdEl.value = saved;
        return;
      }
    } catch {}
    mdEl.value = DEFAULT\_TEXT;
  }

  // --- Service Worker ---
  async function registerSW() {
    if (!("serviceWorker" in navigator)) return;

    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      // If updates are available, let it install; don't force-activate.
      reg.addEventListener("updatefound", () => {});
    } catch {
      // ignore
    }
  }

  // --- Init ---
  const init = () => {
    const settings = loadSettings();
    const splitOn = settings.split ?? true;

    // theme
    applyTheme(getPreferredTheme());

    // split mode initial
    const editorPanel = \$("#editor").closest(".panel");
    if (!splitOn) {
      document.querySelector(".layout").style.gridTemplateColumns = "1fr";
      editorPanel.style.display = "none";
      document.querySelector('[data-action="split"]').setAttribute("aria-pressed", "false");
    }

    loadContent();
    render();
    setupScrollSync();
    setupKeyboardShortcuts();
    bindToolbar();

    mdEl.addEventListener("input", () => {
      render();
      persistSoon();
    });

    // initial persist if empty storage
    persistSoon();
    registerSW();
  };

  // Throttle render on huge changes (optional, but keep simple)
  let renderRAF = 0;
  mdEl?.addEventListener("input", () => {
    if (renderRAF) cancelAnimationFrame(renderRAF);
    renderRAF = requestAnimationFrame(() => {
      render();
    });
  }, { passive: true });

  init();
})();
