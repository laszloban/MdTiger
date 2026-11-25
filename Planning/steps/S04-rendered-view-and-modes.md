# S04 – Rendered view and modes

| | |
|---|---|
| **Depends on** | S03 |
| **Requirements** | FR-EDIT-01, FR-EDIT-03, FR-EDIT-05 (incl. the visibly active mode button), FR-MD-01 … FR-MD-05, FR-TABLE-01, NFR-02 (incremental render), NFR-06, NFR-09 (b) |
| **Spike reference** | `spike/frontend/src/render.ts`, `spike/frontend/src/main.ts` sections *modes*, *rendering*, scroll handlers (`onEditorScroll`, `onRenderedScroll`, `topSourcePos`, `renderedElementAt`); `spike/samples/tables.md`, `spike/samples/showcase.md` |

## 1. Goal

The rendered reading view, built from the editor's own Lezer tree with
exact source offsets on every element, plus the three modes (Rendered,
Source, Split) with a mode switch whose active button is always obvious.
Re-rendering is incremental so Split mode stays fast on big documents.

## 2. Scope

**In:** the renderer for all CommonMark + GFM block and inline elements,
tolerant tables, YAML front matter, footnotes, GitHub-style heading
anchors, sanitised inline/block HTML, rendering typography (one neutral
style), the mode switch, position keeping, Split mode with scroll sync,
incremental re-rendering.

**Out:** code-block features (highlighting, copy button, language label),
Mermaid, images, link clicking, task checkboxes (all S05); outline (S06);
themes and alternative styles (S08). In this step code blocks render as
plain `<pre><code>`, images as their alt text in a placeholder box, links
as inert `<a>` elements.

## 3. Design and tasks

### 3.1 Parser extensions (`src/editor/markdownSupport.ts`)

Add, as Lezer Markdown extensions shared by editor and renderer:

- **Front matter:** a block parser that recognises `---` on the first line,
  up to the next `---` or `...` line, as a `FrontMatter` node. In the editor
  it is highlighted as metadata; in the rendered view it shows as a
  collapsed "Front matter" box that expands on click (FR-MD-03).
- **Footnotes:** `[^id]` references and `[^id]: text` definitions
  (FR-MD-04). Rendered GitHub-style: superscript numbered links, a
  footnotes section at the end with back links. If a full extension turns
  out too large for this step, render definitions in place and record an
  open issue.

### 3.2 Renderer (`src/render/`)

- Port `render.ts`: walk the syntax tree (from `ensureSyntaxTree` /
  `syntaxTree(state)`, never a second parse), produce DOM, and set
  `data-from` / `data-to` on every block element and on inline elements
  that S05/S06/S11 need (headings, list items, task markers, links,
  images, code blocks, table cells).
- GFM: tables (alignment, header, wide tables scroll horizontally inside a
  wrapper), task-list items (as disabled checkboxes for now), strikethrough,
  autolinks. Tolerant tables per FR-MD-02, using `spike/samples/tables.md`
  as a fixture; `\|` inside code spans in cells is a literal pipe.
- **Heading anchors:** GitHub's slug rules (lowercase, drop punctuation
  except `-` and `_`, spaces → `-`, duplicates get `-1`, `-2`); `id` on the
  heading element. Accented letters stay (GitHub keeps them).
- **HTML:** inline and block HTML pass through **DOMPurify**
  (`RETURN_DOM_FRAGMENT`), allowing common README tags (`details`,
  `summary`, `br`, `img`, `kbd`, `sub`, `sup`, `div`/`span` with `align`),
  removing scripts, event handlers, `iframe`, `object`, `style` attributes
  with `url(`. HTML comments are not shown.
- **Incremental rendering:** keep the list of rendered top-level blocks
  with their source ranges. On a document change, map the ranges through
  the `ChangeSet`, find the top-level syntax nodes overlapping the changed
  ranges (after re-parse), re-render only those, and splice them into the
  DOM. Fall back to a full render when the change touches more than ~30 %
  of blocks or the block structure can't be matched. Rendering stays
  debounced (spike's adaptive delay, `min(2000, max(150, lastMs×3))`), and
  it is skipped while the rendered view is hidden (Source mode); it catches
  up when shown.
- A Content Security Policy in `index.html`/Tauri config: no inline
  scripts, `img-src` allows `asset:`, `https:`, `http:`, `data:`;
  `connect-src` none except Tauri IPC.

### 3.3 Modes (`src/ui/modeSwitch.ts`)

- A segmented control in the toolbar: **Rendered**, **Source**, **Split**,
  each with an icon and label (label hidden on narrow windows, tooltip with
  shortcut).
- **The active mode button stays visibly activated:** `aria-pressed="true"`,
  accent background, contrasting text, distinct from hover and focus
  styles. Exactly one button is pressed at any time, also after tab
  switches, renderer reloads and keyboard mode changes.
- Shortcuts: **Ctrl+1** Rendered, **Ctrl+2** Source, **Ctrl+3** Split,
  **Ctrl+E** toggles between Rendered and Source.
- Mode is per tab (FR-FILE-06); new tabs open in the setting `defaultMode`
  (default `"rendered"`).
- **Position keeping:** switching modes keeps the source offset at the top
  of the view (`topSourcePos` → `scrollToPos`, binary search over the
  cached blocks, as in the spike).
- **Split:** source left, rendered right, a draggable divider (ratio stored
  in settings `split.ratio`). Scroll sync both ways, throttled to one update
  per animation frame, without feedback loops (spike logic).
- Rendered view typography: readable line length (max width from a CSS
  variable, default ~800 px, centred), clear H1–H6 hierarchy (FR-STYLE-02
  baseline; S08 refines), tables with borders and zebra rows.

## 4. Tests

### 4.1 Unit (Vitest, renderer on an `EditorState`)

- Each element type renders the expected structure; snapshot tests for
  `showcase.md` and `tables.md` (stored next to the test).
- Offsets: for every element with `data-from/to`, the source slice starts
  with the expected marker (`#` for headings, `|` or text for tables, etc.).
- Slugs: `Hello, World!` → `hello-world`; duplicates; `Árvíztűrő tükör` →
  `árvíztűrő-tükör`; `4.3 Foo` → `43-foo`.
- Sanitising: `<script>`, `onerror=`, `javascript:` links,
  `<iframe>` are removed; `<details><summary>` stays.
- Front matter recognised only at the very start; a `---` later is a rule.
- Incremental: an edit inside paragraph 50 of 200 re-renders exactly one
  block (count renders via a test hook); inserting a new heading re-renders
  the affected blocks only; result equals a full render (compare HTML).

### 4.2 End to end (`tests/e2e/s04-rendered-view.test.mjs`)

1. Open `showcase.md` → Rendered mode by default, the Rendered button is
   pressed (`aria-pressed`, and its computed background differs from the
   others).
2. Ctrl+2 / Ctrl+3 / Ctrl+1 / Ctrl+E switch modes; after each, exactly one
   button is pressed and it matches the visible mode.
3. Per-tab mode: tab A in Source, tab B in Rendered; switching tabs restores
   each and updates the pressed button.
4. Position keeping: scroll Rendered to a heading in the middle, switch to
   Source → that heading's line is within the top 20 % of the editor; and
   back.
5. Split: typing in the source updates the rendered side within 1 s;
   scrolling either side moves the other to the matching block.
6. Malformed tables from `tables.md` render as tables (count `<table>`
   elements).
7. Sanitising in the real app: a fixture with `<img src=x onerror=...>` and
   `<script>` → nothing runs (a global flag stays unset), log has no error
   dialog.
8. Split mode, 2 MB document: typing p90 < 50 ms; rendered side catches up
   within 2 s after typing stops.
9. Renderer reload (S01) keeps each tab's mode.
10. Earlier suites still pass.

### 4.3 Manual

- Reading `showcase.md` and a few real AI-generated documents looks clean:
  headings clearly distinct, tables readable, front matter tucked away.
- The pressed mode button is obvious at a glance, also with keyboard focus
  on another button.

## 5. Done when

All tests pass with `npm run check`, manual checks done, open issues listed.

## 6. Implementation notes

<!-- Written by the implementing session. -->

## 7. Open issues

| ID | Issue | Proposal |
|---|---|---|
| | | |
