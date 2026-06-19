/* =========================================================
   Vanilla Markdown Lab — app.js (CLEAN CORE)
   Unified architecture before async rendering layer
========================================================= */

/* =========================================================
   UTILITIES
========================================================= */

const debounce = (fn, wait = 60) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
};

const escapeHtml = (str = "") =>
  str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/* =========================================================
   DOM
========================================================= */

let editor;
let preview;

/* =========================================================
   STORAGE
========================================================= */

const storage = {
  key: "vml_doc_v1",

  save(value) {
    localStorage.setItem(this.key, value);
  },

  load() {
    return localStorage.getItem(this.key) || "";
  }
};

/* =========================================================
   EVENT BUS (lightweight core signal system)
========================================================= */

const EventBus = {
  emit(name, data) {
    document.dispatchEvent(new CustomEvent(name, { detail: data }));
  },

  on(name, handler) {
    document.addEventListener(name, (e) => handler(e.detail));
  }
};

/* =========================================================
   REGISTRIES
========================================================= */

/* -------------------------
   BLOCK REGISTRY
------------------------- */

const BlockRegistry = {
  blocks: new Map(),

  register(type, handler) {
    this.blocks.set(type, handler);
  },

  get(type) {
    return this.blocks.get(type);
  }
};

/* -------------------------
   INLINE REGISTRY
------------------------- */

const InlineRegistry = {
  rules: [],

  register(name, pattern, renderer, priority = 100) {
    this.rules.push({ name, pattern, renderer, priority });
    this.rules.sort((a, b) => a.priority - b.priority);
  },

  apply(text) {
    for (const rule of this.rules) {
      text = text.replace(rule.pattern, rule.renderer);
    }
    return text;
  }
};

/* =========================================================
   PLUGIN RUNTIME
========================================================= */

const PluginRuntime = {
  plugins: new Map(),
  active: new Set(),

  register(plugin) {
    this.plugins.set(plugin.name, {
      ...plugin,
      enabled: false
    });
  },

  enable(name, ctx) {
    const p = this.plugins.get(name);
    if (!p || p.enabled) return;

    p.enabled = true;
    this.active.add(name);

    p.init?.(ctx);
    p.onEnable?.(ctx);
  },

  disable(name, ctx) {
    const p = this.plugins.get(name);
    if (!p || !p.enabled) return;

    p.enabled = false;
    this.active.delete(name);

    p.onDisable?.(ctx);
  }
};

/* =========================================================
   PLUGIN CONTEXT
========================================================= */

function createPluginContext() {
  return {
    editor,
    preview,
    BlockRegistry,
    InlineRegistry,
    EventBus
  };
}

/* =========================================================
   MARKDOWN ENGINE
========================================================= */

/* -------------------------
   BLOCK EXTRACTION
------------------------- */

function extractBlocks(text) {
  const store = [];

  text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    const type = lang || "text";
    const handler = BlockRegistry.get(type);

    if (handler) {
      const html = handler({ content: code, lang: type });
      const id = store.length;
      store.push(html);
      return `@@B${id}@@`;
    }

    const safe = escapeHtml(code);
    const fallback = `<pre><code>${safe}</code></pre>`;
    const id = store.length;

    store.push(fallback);
    return `@@B${id}@@`;
  });

  return { text, store };
}

/* -------------------------
   INLINE PHASE
------------------------- */

function renderInline(text) {
  return InlineRegistry.apply(text);
}

/* -------------------------
   CORE RENDER PIPELINE
------------------------- */

function renderMarkdown(src) {
  let text = escapeHtml(src);

  // 1. block phase
  const { text: withoutBlocks, store } = extractBlocks(text);
  text = withoutBlocks;

  // 2. structural markdown
  text = text
    .replace(/^###### (.*)$/gm, "<h6>$1</h6>")
    .replace(/^##### (.*)$/gm, "<h5>$1</h5>")
    .replace(/^#### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^---$/gm, "<hr>");

  // 3. inline phase
  text = renderInline(text);

  // 4. restore blocks
  text = text.replace(/@@B(\d+)@@/g, (_, i) => store[i]);

  // 5. lists (simplified stable version)
  text = text.replace(
    /(?:^[-*] .*(\n|$))+?/gm,
    (block) => {
      const items = block
        .trim()
        .split("\n")
        .map(l => `<li>${l.replace(/^[-*] /, "")}</li>`)
        .join("");

      return `<ul>${items}</ul>`;
    }
  );

  text = text.replace(
    /(?:^\d+\. .*(\n|$))+?/gm,
    (block) => {
      const items = block
        .trim()
        .split("\n")
        .map(l => `<li>${l.replace(/^\d+\. /, "")}</li>`)
        .join("");

      return `<ol>${items}</ol>`;
    }
  );

  // 6. final newline handling
  return text.replace(/\n/g, "<br>");
}

/* =========================================================
   RENDER CONTROLLER
========================================================= */

const RenderController = {
  last: "",

  render(value) {
    const html = renderMarkdown(value);

    if (html === this.last) return;

    this.last = html;
    preview.innerHTML = html;

    EventBus.emit("render:update", html);
  }
};

/* =========================================================
   UX SYSTEM
========================================================= */

/* -------------------------
   scroll sync
------------------------- */

function attachScrollSync() {
  let ticking = false;

  editor.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;

    requestAnimationFrame(() => {
      const ratio =
        editor.scrollTop /
        Math.max(1, editor.scrollHeight - editor.clientHeight);

      preview.scrollTop =
        ratio *
        Math.max(1, preview.scrollHeight - preview.clientHeight);

      ticking = false;
    });
  });
}

/* -------------------------
   autosave + input loop
------------------------- */

function createLoop() {
  const save = debounce((v) => storage.save(v), 200);

  const update = debounce(() => {
    const value = editor.value;

    RenderController.render(value);
    save(value);

    EventBus.emit("editor:update", value);
  }, 40);

  return { update };
}

/* =========================================================
   INIT PLUGINS (example hooks)
========================================================= */

function initPlugins() {
  const ctx = createPluginContext();

  // Example JS block plugin
  PluginRuntime.register({
    name: "js-block",
    init(ctx) {
      ctx.BlockRegistry.register("js", (b) => {
        return `<pre><code>${escapeHtml(b.content)}</code></pre>`;
      });
    }
  });

  PluginRuntime.enable("js-block", ctx);
}

/* =========================================================
   BOOT
========================================================= */

function init() {
  editor = document.querySelector("#editor");
  preview = document.querySelector("#preview");

  // load saved content
  editor.value = storage.load();

  initPlugins();

  attachScrollSync();

  const loop = createLoop();

  editor.addEventListener("input", loop.update);

  // initial render
  RenderController.render(editor.value);
}

document.addEventListener("DOMContentLoaded", init);
