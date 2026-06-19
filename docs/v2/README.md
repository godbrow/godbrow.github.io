Below is a **living project document** you can keep in your repo (README or `/docs/architecture.md`). It summarizes what you’ve built, what broke, what stabilized, and what still needs work.

---

# 📘 Project Document — SDUI Block Editor (Vanilla Architecture)

## 🧭 Overview

This project is a **from-scratch, dependency-free block-based Markdown editor** built using:

* Modern ES2024+ JavaScript
* Semantic HTML (SDUI-driven layout)
* Responsive CSS (light/dark theme ready)
* Service Worker (planned/partial)
* Custom transaction-based editing core

The goal is to evolve into a **Notion-like, plugin-ready document editor** without external dependencies like `marked.js`, `markdown-it`, or frameworks.

---

# 🧱 Architecture Evolution

## Phase 1 — Basic Editor Prototype

### What worked

* Simple `contenteditable` blocks
* Basic markdown rendering (regex-based)
* Live preview pane
* SDUI concept introduced (UI described via JSON)

### What didn’t work

* Direct DOM mutation caused instability
* No separation between UI and state
* Cursor loss on every update
* Enter/Backspace behavior inconsistent

---

## Phase 2 — Block Model Introduction

### What worked

* Document split into blocks
* Basic SPLIT and MERGE logic introduced
* Preview became block-driven instead of raw text

### What didn’t work

* DOM was still source-of-truth (bad coupling)
* Frequent re-renders caused focus loss
* No normalization system → orphan blocks appeared

---

## Phase 3 — Transaction Engine Introduction

### What worked

* Introduced transaction types:

  * `UPDATE`
  * `SPLIT`
  * `MERGE`
* Unified mutation path through engine
* Reduced direct DOM mutation significantly

### What didn’t work

* Still lacked state validation layer
* Edge cases (empty blocks, boundary merges) leaked into UI logic
* Cursor restoration unreliable

---

## Phase 4 — SDUI System (UI.json Driven Layout)

### What worked

* UI defined via JSON schema
* DOM generated declaratively
* Clear separation of layout vs logic intent

### What didn’t work

* Timing issues (UI not ready when editor initialized)
* Missing contract guarantees → null DOM errors
* Inconsistent initialization order

---

## Phase 5 — Single App Core Refactor (EditorApp)

### What worked

* Centralized state into `EditorApp`
* Eliminated duplicate globals (`BlockCache`, etc.)
* Cleaner mental model:

  * `EditorApp.state`
  * `EditorApp.UI`
  * `EditorApp.cursor`

### What didn’t work

* Backspace edge cases persisted
* Cursor restoration still frame-sensitive
* Normalization not enforced consistently at all mutation points

---

## Phase 6 — Normalization Engine (State Self-Healing)

### What worked

* Removed consecutive empty blocks
* Ensured safe document invariants
* Reduced corruption over time
* Made editor resilient to partial invalid states

### What didn’t work

* Backspace behavior still required special handling
* Cursor jump inconsistencies remained
* Timing between normalize → render → cursor restore still fragile

---

## Phase 7 — Stable Transaction + Cursor Fixes (Current State)

### What worked

#### ✔ Transaction system stabilized

* SPLIT / MERGE behaves consistently
* No more structural corruption

#### ✔ SDUI contract stabilized

* UI panels guaranteed before init
* No more null DOM errors

#### ✔ Rendering stabilized

* Cached block DOM reuse
* Reduced reflow and flicker

#### ✔ Normalization integrated

* Runs before render cycle
* Keeps document structurally valid

---

### Remaining issues resolved partially

#### ⚠ Backspace behavior (partially fixed)

* Merge works correctly
* Cursor now mostly stable
* Still sensitive to timing in some edge cases

#### ⚠ Cursor system

* Requires double RAF to stabilize DOM
* Still dependent on render timing

---

# ❌ What Still Does NOT Work Well

## 1. IME / complex input (major missing piece)

* No composition handling (CJK input breaks expected flow)
* Risk of text corruption during IME composition events

---

## 2. True selection model missing

* No multi-block selection
* Cursor exists only as:

  * blockId + offset
* No range selection system

---

## 3. Undo / Redo system missing (critical next step)

* No transaction history
* No replay mechanism
* No time-travel state model

---

## 4. Plugin architecture not yet integrated

* No hook system
* No event bus
* No lifecycle API for extensions

---

## 5. Performance scaling not addressed

* No virtualization
* Full DOM render per block update still used
* Large documents will degrade

---

## 6. Markdown engine is minimal

* Regex-based rendering only
* No AST
* No extensibility for syntax plugins (mermaid, math, etc.)

---

# 🧠 Core Design Insights Learned

## 1. DOM must never be source of truth

State must drive UI, not vice versa.

---

## 2. Block systems require normalization

Without a normalization layer:

* empty states accumulate
* edge cases multiply exponentially

---

## 3. Cursor management is the hardest problem

Stable editors require:

* post-render cursor restore
* frame-synchronized updates
* deterministic DOM identity

---

## 4. SDUI must be a contract, not a suggestion

If UI generation is not guaranteed:

* editor crashes or silently breaks

---

## 5. Transactions are the correct abstraction

Direct mutation is not scalable.

Everything must go through:

> Transaction → Apply → Normalize → Render

---

# 🚀 Next Steps Roadmap

## Phase 8 — Undo/Redo System (HIGH PRIORITY)

* Transaction log
* Stack-based history
* Time-travel debugging
* Replay engine

---

## Phase 9 — Selection Model Upgrade

* Range selection across blocks
* Multi-block operations
* Clipboard integration

---

## Phase 10 — IME-safe Input Layer

* compositionstart / compositionend handling
* input buffering during IME sessions

---

## Phase 11 — Plugin System (Architecture Unlock)

* hook-based lifecycle
* markdown extensions
* custom block types (code, math, mermaid)

---

## Phase 12 — Performance Layer

* virtualized rendering
* partial DOM updates
* diff-based reconciliation

---

# 📌 Current Status Summary

### ✔ Stable

* Block model
* Transaction engine
* SDUI contract layer
* Normalization engine
* Basic cursor handling

### ⚠ Fragile

* Backspace edge cases (mostly solved but timing-sensitive)
* Cursor restore still frame-dependent

### ❌ Missing core product features

* Undo/redo
* Selection model
* Plugin system
* IME safety
* Performance scaling

---

# 🧭 Final Note

This project has successfully evolved from:

> “simple contenteditable editor”

into:

> “transaction-based document engine with UI contract system”

The foundation is now **architecturally sound enough for production-grade extensions**, especially undo/redo and plugin systems.

---

If you want next, the natural continuation is:

> 🧠 Undo/Redo system built on your TransactionEngine (this is the real “editor milestone”)
