# v1 Text Editor — Project Retrospective

## 1. Introduction

The v1 Editor is an **offline-first, in-browser text editor** designed to handle multiple documents with syntax highlighting, live preview, and a clean, semantic UI.  
It was built entirely with **vanilla web technologies** — HTML, CSS, and modern JavaScript (ES2024+) — with zero third-party frameworks or libraries.  
The core requirements included:

- Semantic HTML dynamically generated from a static SDUI payload (`ui.json`)
- A robust plugin system for language modes (text, Markdown, HTML, CSS, JavaScript)
- LocalStorage-based document persistence, with export/import and a cloud‑sync placeholder
- Virtualised rendering for smooth editing of several thousand lines
- Multiple open documents via a tab interface
- Modern Service Worker for full offline capability

This document describes the final architecture, what worked well, the significant challenges encountered, and the solutions that emerged from an iterative, collaborative design process.

## 2. Final Architecture

### 2.1 Shell and Layout

The entire user interface is bootstrapped from a static `ui.json` file that describes a semantic DOM tree. The `build()` function in `app.js` recursively constructs DOM elements. The top-level structure is:

```html
<body>
  <header> … tabs & actions … </header>
  <aside> … file list … </aside>
  <main>
    <div class="gutter"> … line numbers … </div>
    <div class="content"> … editor surface … </div>
  </main>
  <aside> … preview iframe … </aside>
  <footer> … status bar … </footer>
</body>
```

No classes are used on the semantic elements (`header`, `aside`, `main`, `footer`); CSS selectors rely entirely on `body > …` structural pseudo‑classes. This keeps the markup minimal, readable, and cache‑friendly.

### 2.2 Component Model

The application is broken into five self‑contained classes that communicate through a central **Store** (pub/sub pattern):

- **Store** – Manages state (tabs, active document, document list, theme) and provides `dispatch`/`subscribe` methods. All persistence to `localStorage` happens here.
- **Head** – Renders the tab bar and global action buttons (new document, theme toggle).
- **List** – Left sidebar showing all saved documents; clicking opens a tab.
- **Edit** – The core editor: a virtualised rendering surface with a hidden `<textarea>` for input, a blinking custom caret, and offset‑based command‑pattern undo/redo.
- **View** – Right sidebar containing a sandboxed `<iframe>` that displays the active document’s live preview, updated on every document change.
- **Foot** – Status bar showing the current mode (and ready for line/column, dirty state).

All components subscribe to the store and re‑render only when relevant actions are dispatched.

### 2.3 Plugin System

Language support is entirely plugin‑based. Each plugin is an object registered into a global `plug` map under a mode identifier (`"md"`, `"html"`, `"css"`, `"js"`, `"txt"`). A plugin provides:

- `start()` – returns a mutable context object (e.g. for tracking fenced code blocks)
- `line(text, ctx)` – returns an array of tokens (`{kind, span}`) for syntax highlighting
- `block(ctx)` – returns a block‑level style hint (e.g. `"heading"`, `"codeblock"`)
- `render(text)` – returns an HTML string for the preview pane

Built‑in plugins are registered at startup; additional plugins can be loaded dynamically.

### 2.4 Editor Core (Virtualised Rendering)

The editor uses a **virtual scrolling** strategy to handle documents with thousands of lines:

- The entire document is stored as a single string, split into an array of lines.
- A scroll container (`.content`) holds a **sizing sentinel** (an invisible `<div>` with `height = total line heights`) to create the correct scrollbar.
- Only the lines visible within the viewport (plus a small overscan) are rendered as absolutely‑positioned `<div class="line">` elements.
- Line heights are initially estimated (24px) and can be measured for block‑specific styling (headings, code blocks).
- A separate gutter column is synchronised with the visible range.

### 2.5 Input Handling and Caret

Input is captured via a **single hidden `<textarea>`** placed off‑screen. This avoids the notorious pitfalls of `contenteditable` while keeping full control over text insertion, deletion, and cursor movement.  

A **blinking custom caret** (a `<span class="caret">`) is positioned absolutely to provide a visual cursor; the browser’s native caret is invisible.  

- **Typing**: Each printable key press is intercepted, converted to an `Insert` command, applied to the full document string, and then the virtual display is re‑rendered.
- **Navigation**: Arrow keys, Home, End, Backspace, Delete, and Enter are all explicitly handled, transforming line/column positions into absolute character offsets.
- **Click‑to‑cursor**: `document.caretPositionFromPoint()` is used for pixel‑perfect column placement on click, falling back to monospace‑width estimation.
- **IME composition**: A `compositionstart`/`compositionend` wrapper preserves the current line, applies the composed text as a replace operation.

### 2.6 Undo/Redo

Undo/redo operates on full document strings via a **command pattern**:

- `Insert(offset, text)` and `Delete(offset, text)` are the atomic commands.
- Each command knows how to `apply` and `undo` a change to the document string.
- The `History` class maintains a stack with an index; Ctrl+Z / Ctrl+Y trigger undo/redo.

### 2.7 Offline Capability

A Service Worker (`worker.js`) pre‑caches all essential files (`index.html`, `ui.json`, `styles.css`, `app.js`, `worker.js`) during the `install` event.  
The `fetch` handler implements a **cache‑first** strategy, serving the cached version instantly while updating the cache from the network in the background.  
All document data resides in `localStorage`, so the editor works completely offline after the first visit.

### 2.8 Theming

Light and dark themes are implemented entirely with CSS custom properties defined on `:root` and a `.dark` class on `<html>`.  
The theme is toggled via the store, persisted, and applied instantly without any page reload.

## 3. What Worked Well

### 3.1 SDUI Shell and Semantic Selectors

Using a static JSON payload to generate the entire DOM kept the HTML pristine and made it trivial to cache.  
Switching to structural CSS selectors (`body > header`, `body > aside:first-of-type`, etc.) eliminated class/ID bloat and made the markup self‑documenting.

### 3.2 Plugin Architecture

The plugin system proved extremely flexible. Adding a new language mode is a matter of providing a tokeniser, block‑hint function, and preview renderer.  
The Markdown plugin, though simple, correctly handles headings, lists, fenced code, and blockquotes both for inline highlighting and preview rendering.

### 3.3 Virtualised Rendering

The sentinel‑based virtual scrolling handles any document size gracefully. Only a few dozen DOM elements exist at any time, keeping memory usage and layout cost constant regardless of document length.

### 3.4 Offset‑Based Editing and Command Pattern

By converting line/column positions to absolute character offsets, all edit operations became simple string slices. This avoided the complexity of tracking line merges/splits separately and made undo/redo trivially correct.

### 3.5 Precise Click Positioning

Using `document.caretPositionFromPoint()` (with a fallback to monospace approximation) gave pixel‑accurate column placement for any font or zoom level. This was a significant improvement over earlier attempts that relied solely on character width averages.

### 3.6 Undo/Redo with Full Document Snapshots

While not memory‑efficient for huge texts, storing full document replacements for each undo step was simple, robust, and perfectly adequate for the target use case (documents up to a few thousand lines).

### 3.7 Offline Readiness

The Service Worker caching strategy worked flawlessly. The editor loads instantly on repeat visits, even without a network connection, and all document data is persisted in `localStorage`.

## 4. What Didn’t Work — and How We Fixed It

### 4.1 The Hidden Textarea Focus Problem

**Symptom:** After clicking inside the editor to reposition the cursor, the blinking caret would disappear and typing stopped working.  
**Cause:** Clicking on a rendered `<div class="line">` caused the browser to move focus away from the hidden `<textarea>`, triggering a `focusout` event that hid the caret.  
**Solution:** Added `e.preventDefault()` in the `mousedown` handler to keep focus on the textarea. Additionally, focus tracking was switched from the textarea to the scroll container using `focusin`/`focusout` events, and the caret is explicitly shown after any click.

### 4.2 ContentEditable Glitches

**Symptom:** An attempt to switch to a `contenteditable` `<pre>` element resulted in garbled text — characters appeared in reverse order, and extra empty lines proliferated.  
**Cause:** The `innerText` property of a `<pre>` containing `<div>`+`<br>` structures doubles newline characters. The browser’s editing model interacted poorly with our virtual DOM and programmatic re‑rendering.  
**Solution:** Abandoned the contenteditable approach entirely and returned to the hidden‑textarea + virtual rendering model. This gave us full control over text representation and avoided all browser‑specific editing quirks.

### 4.3 Duplicate Line Numbers

**Symptom:** Line numbers appeared both in the gutter column and inside each editor line (as a `<span class="num">`).  
**Cause:** During earlier iterations, the rendering loop created a gutter number **and** an inline number span for each line.  
**Solution:** Removed the inline `<span class="num">` from the line rendering; the gutter alone now provides all line numbers.

### 4.4 Caret Horizontal Lag

**Symptom:** The custom caret appeared 5–6 characters to the left of the actual cursor position.  
**Cause:** The caret’s `left` CSS value was calculated using only the pixel offset within the `.text` span, ignoring the span’s own horizontal offset within the scroll container (due to the 3em gutter column).  
**Solution:** Added `textSpan.offsetLeft` to the computed column pixel value. The caret now exactly matches the text insertion point.

### 4.5 Click‑to‑Cursor Inaccuracy

**Symptom:** Clicking on text did not always move the cursor to the correct column, especially for tokenised lines with multiple spans.  
**Cause:** Early implementations relied on a monospace‑width average or simple tree‑walker that didn’t account for token boundaries correctly.  
**Solution:** Used `document.caretPositionFromPoint()` and a robust tree walker from the `.text` container to the exact text node and offset. The fallback remained for browsers that don’t support that API.

### 4.6 IME Composition

**Symptom:** Composing characters (e.g., for Chinese or Japanese input) would trigger multiple tiny edits, often breaking the document.  
**Cause:** Each composition update fired the `input` event and inserted partial characters.  
**Solution:** Used the `compositionstart`/`compositionend` events to freeze normal editing during IME sessions and apply the final composed string as a single replace operation.

## 5. Lessons Learned

1. **Hidden textarea + virtual rendering beats contenteditable for full control.** While it requires manually implementing every edit behaviour (arrows, backspace, enter, composition), it eliminates an entire class of cross‑browser bugs and gives predictable, testable behaviour.

2. **Offset‑based editing is the right primitive.** Converting all cursor positions to absolute character offsets decouples the visual line model from the underlying string operations, simplifying both the command pattern and undo/redo.

3. **Focus management is critical.** With an invisible input, explicit focus handling is necessary. Using the scroll container’s `focusin`/`focusout` and preventing default blur on mouse events solved a persistent and subtle problem.

4. **Semantic, classless HTML + structural CSS is a clean architecture.** It improves readability, reduces maintenance, and works perfectly with a dynamic SDUI bootstrap.

5. **Plugins should be stateful from the start.** The Markdown plugin’s context object (tracking fenced code blocks) proved essential for correct multi‑line highlighting, and is easily extensible for other stateful features (e.g., nested lists).

6. **Iterative, collaborative debugging surfaced edge cases early.** The process of alternating between code proposals and live HTML inspection quickly identified issues like caret lag, duplicate numbers, and focus loss that would have been much harder to catch in isolation.

## 6. Future Improvements

- **Real line‑height measurement:** Use `ResizeObserver` on the caret or first token to measure actual line heights for variable‑size blocks (headings, code blocks).
- **Scroll sync:** Implement bidirectional scroll synchronisation between the editor and the preview iframe using `postMessage` and `data‑line` anchors.
- **Fine‑grained undo:** Replace full‑document snapshots with a diff‑based or operation‑based history for better memory efficiency.
- **Syntax highlighting enhancements:** Add token types for bold, italic, inline code, and links within the Markdown plugin, and richer keywords for CSS/JS/HTML.
- **Export/Import UI:** Add buttons to download a single file or a full workspace JSON bundle, and a file picker to import them.
- **Accessibility:** ARIA attributes and keyboard navigation for the file list and tabs, and screen‑reader announcements for mode/cursor changes.
- **Cloud sync:** Implement the placeholder sync event in the Service Worker to merge local documents with a remote backend when online.

## 7. Conclusion

The v1 Editor achieved all of its core goals: it is a fast, offline‑first, multi‑tab text editor with syntax highlighting and live preview, built entirely with vanilla web technologies.  
The final architecture — a hidden textarea, virtual scrolling, offset‑based commands, and a SDUI shell — proved robust after working through several non‑trivial interaction and rendering challenges.  
The editor is now a solid foundation that can be extended in any direction, from collaborative editing to advanced language support.

