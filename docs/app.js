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

const BlockRegistry = {
  blocks: new Map(),

  register(type, handler) {
    this.blocks.set(type, handler);
  },

  has(type) {
    return this.blocks.has(type);
  },

  get(type) {
    return this.blocks.get(type);
  }
};

function extractBlocks(text) {
  const store = [];

  text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    const type = lang || "text";

    const handler = BlockRegistry.get(type);

    const block = {
      type,
      content: code
    };

    if (handler) {
      const html = handler(block);
      const id = store.length;

      store.push(html);
      return `@@BLOCK_${id}@@`;
    }

    // fallback (no plugin registered)
    const safe = escapeHtml(code);
    const fallback = `<pre><code>${safe}</code></pre>`;

    const id = store.length;
    store.push(fallback);

    return `@@BLOCK_${id}@@`;
  });

  return { text, store };
}

function buildList(block) {
  const lines = block.split("\n");

  let html = "";
  let stack = [{ level: 0, html: "<ul>" }];

  const getLevel = (line) => line.match(/^\s*/)[0].length;

  for (let line of lines) {
    const isOrdered = /^\s*\d+\./.test(line);
    const isUnordered = /^\s*[-*]/.test(line);

    if (!isOrdered && !isUnordered) continue;

    const level = getLevel(line);
    const content = line.replace(/^\s*([-*]|\d+\.)\s*/, "");

    const tag = isOrdered ? "ol" : "ul";

    // adjust nesting
    let current = stack[stack.length - 1];

    if (level > current.level) {
      stack.push({ level, html: `<${tag}><li>${content}` });
    } else {
      while (stack.length && level < stack[stack.length - 1].level) {
        const closed = stack.pop();
        stack[stack.length - 1].html += closed.html + `</${tag}>`;
      }
      stack[stack.length - 1].html += `<li>${content}`;
    }
  }

  while (stack.length > 1) {
    const closed = stack.pop();
    stack[stack.length - 1].html += closed.html + "</ul>";
  }

  html = stack[0].html + "</ul>";

  return html;
}

function renderInline(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/\$(.+?)\$/g, "<span class='math'>$1</span>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
      `<a href="$2" target="_blank" rel="noopener">$1</a>`
    );
}

function renderMarkdown(src) {
  // 1. escape early (safety baseline)
  let text = escapeHtml(src);

  // 2. block extraction (registry-driven)
  const { text: withoutBlocks, store } = extractBlocks(text);

  text = withoutBlocks;

  // 3. structural markdown (still core-owned)
  text = text
    .replace(/^---$/gm, "<hr>")
    .replace(/^###### (.*)$/gm, "<h6>$1</h6>")
    .replace(/^##### (.*)$/gm, "<h5>$1</h5>")
    .replace(/^#### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>");

  // task list
  text = text.replace(/^[-*] \[( |x)\] (.*)$/gm, (_, checked, content) => {
    return `
      <li class="task">
        <input type="checkbox" ${checked === "x" ? "checked" : ""} disabled />
        <span>${content}</span>
      </li>
    `;
  });
  // 4. inline phase
  text = renderInline(text);

  // 5. restore blocks
  text = text.replace(/@@BLOCK_(\d+)@@/g, (_, i) => store[i]);

  // 6. lists (kept core for now)
  text = text.replace(/(?:^(?:\s*[-*]|\s*\d+\.).*(\n|$))+?/gm, (block) => buildList(block.trim()));
  
  // 7. table
  text = text.replace(/((?:\|.*\|\n)+)/g, (block) => {
    const rows = block.trim().split("\n");

    const htmlRows = rows
      .filter(r => r.includes("|"))
      .map((row, i) => {
        const cells = row
          .split("|")
          .map(c => c.trim())
          .filter(Boolean);

        const tag = i === 1 ? "th" : "td";

        const htmlCells = cells
          .map(c => `<${tag}>${c}</${tag}>`)
          .join("");

        return `<tr>${htmlCells}</tr>`;
      })
      .join("");

    return `<table>${htmlRows}</table>`;
  });
  // 8. blockquote
  text = text.replace(/(?:^> .*(\n|$))+?/gm, (block) => {
    const content = block
      .split("\n")
      .map(l => l.replace(/^> ?/, ""))
      .join("<br>");

    return `<blockquote>${content}</blockquote>`;
  });

  // 9. final newline pass
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
  BlockRegistry.register("js", (block) => {
     const code = escapeHtml(block.content);
     // very simple highlight (still core-safe)
     const highlighted = code.replace(/\b(const|let|function|return|if|for)\b/g, "<span class='kw'>$1</span>");
     return `<pre><code class="lang-js">${highlighted}</code></pre>`;
     }
  );
}

/* -----------------------------
   boot
----------------------------- */

document.addEventListener("DOMContentLoaded", init);
