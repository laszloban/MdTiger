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

**Result:** `npm run check` passes: typecheck, 95 Vitest tests (33 new
in `src/render/render.test.ts`, two snapshots next to it), 17 `cargo test`
tests, release build, 43 end-to-end tests (9 S01, 14 S02, 10 S03, 10
S04). The e2e suites were run twice in a row, green each time. The manual
checks (§4.3) are left to the user.

**What was built**
- `src/editor/markdownSupport.ts`: two Lezer Markdown extensions, `FrontMatter`
  (a block parser: `---` on the very first line up to the next `---` or `...`;
  without a closing line it is not front matter) and `Footnotes` (inline
  `FootnoteReference`, block `FootnoteDefinition` with `FootnoteLabel`; a
  definition continues over lines indented by 2 spaces, or 4 after a blank
  line). Both are in `lezerMarkdownExtensions`, so editor and renderer parse
  alike. The editor highlights front matter as metadata and footnote labels as
  links.
- `src/render/render.ts`: pure functions, tree + text in, HTML string per
  top-level block out (`renderBlock`, `renderTop`, `topLevelBlocks`,
  `renderFootnotes`, `RenderContext` for link references and footnotes,
  `slugify`, `assignHeadingIds`, `safeUrl`). Ported from the spike's string
  renderer. `data-from` / `data-to` sit on every block, list item, table cell,
  link, image placeholder, task checkbox and footnote reference/item.
- `src/render/view.ts`: `RenderedView`, one per tab (`doc.rendered`): owns the
  scroll container `.rendered-pane` > `.rendered-doc`, the list of rendered
  blocks, incremental updates, the adaptive debounce, and the position helpers
  `topSourcePos`, `elementAt`, `scrollToPos`. `stats` (`full`, `incremental`,
  `blocks`, `lastMs`, `lastIncrementalMs`) is the test hook.
- `src/ui/modeSwitch.ts` (the segmented control), `src/ui/panes.ts` (the
  content area: source pane, divider, rendered pane, mode changes with position
  keeping, scroll sync, divider drag). `views.ts` now only does banner and
  window title. `Doc.mode` / `Doc.rendered` / `Doc.topPos`; `Workspace.setMode`;
  the mode is stored per tab in the session (survives a renderer restart).
- Commands `view.rendered` (Ctrl+1), `view.source` (Ctrl+2), `view.split`
  (Ctrl+3), `view.toggleSource` (Ctrl+E; from Split it goes to Source). Digits
  match by `code`, so they work on the Hungarian layout.
- Settings: `defaultMode` (`"rendered"` default) and `split.ratio` (0.15 to
  0.85, default 0.5, saved when the divider is released).
- Element ids for tests: `#mode-switch #mode-rendered #mode-source
  #mode-split` (`aria-pressed`), `#workarea` (`data-mode`), `#pane-source
  #split-divider #pane-rendered`, `.rendered-pane .rendered-doc`,
  `details.front-matter`, `.image-placeholder`, `section.footnotes`.
- A Content Security Policy in `tauri.conf.json` (no inline scripts;
  `img-src 'self' asset: http://asset.localhost https: http: data:`;
  `connect-src ipc: http://ipc.localhost`; no frames, objects or forms;
  `style-src` keeps `'unsafe-inline'` because CodeMirror writes style
  attributes and elements). E2E test 10 checks that an inline script and an
  inline handler are refused.

**How incremental rendering works** (`RenderedView.tryIncremental`)
- The editor's `ChangeSet`s are composed until the next render. Old blocks whose
  range touches a changed range (boundaries count) are dropped; every other
  block is matched to a node of the new tree by its mapped range and name and
  kept. Only unmatched nodes are rendered and spliced in; kept blocks get their
  `data-from`/`data-to` (and those of their descendants) shifted.
- Full render instead when: the edit touches more than 30 % of the blocks
  (counted over dropped and new blocks, for documents of 10+ blocks); a
  dropped or new block is a link reference definition, a footnote definition or
  reference (`global` flag: numbering and link targets depend on the whole
  document); nothing could be matched; the document was replaced by `setState`
  (`invalidate()`, called by "Use draft"); or the parse isn't finished yet (a
  retry is scheduled). Heading ids are reassigned over all headings only when a
  dropped or new block holds a heading.
- Measured on the 2 MB `big.md` (28,900 blocks) in Split mode: first full
  render about 650 ms; one incremental render about 95 ms (most of it
  shifting the offsets of all later blocks); typing p90 32 ms (the Event Timing
  floor), the rendered side up to date about 0.4 s after the last key.
- The debounce is the spike's `min(2000, max(150, cost × 3))`, but `cost` is the
  last *incremental* render (a sixth of the last full one before there was
  one): using the full render's time made the first catch-up after a big
  document take 1.9 s.
- The rendered pane is not rendered while hidden (Source mode); `setActive(true)`
  catches up at once.

**Deviations and decisions**
- **`contain: strict` on `#pane-rendered`.** With a 2 MB document in the rendered
  pane, typing in the source took p90 56 ms (24 ms with the pane hidden): the
  layout of the big sibling subtree was paid on every frame. Containment fixes it
  (p90 32 ms). Keep it.
- **HTML spanning blocks.** A `<details>` or `<div>` (also `center`, `section`)
  that is opened in one HTML block and closed in another, with Markdown between,
  is rendered as one `HTMLGroup` block (`topLevelBlocks`), sanitised as one
  piece. Without this the element closed early and its content spilled out
  (README `<div align="center">` with a logo, collapsed `<details>`).
  Unclosed openers stay single blocks. This goes beyond the spec's list.
- **Split alignment (found at verification).** The rendered side is aligned so the
  source line being worked on (the caret if the editor has focus and it is in
  view, else the top line) is at the same screen height, with a line-fraction
  estimate inside tall blocks (`alignRendered` in `panes.ts`); it re-runs on
  source scroll, key-up, mouse-up and after each render (`RenderedView.onRender`).
  Rendered-to-source scrolling still matches top lines. Not covered by an
  automated test; check by hand.
- **Links are inert but never navigate.** The pane prevents the default of every
  click on an `<a>` (a navigation would replace the whole app page); `#anchor`
  links scroll to the heading. S05 owns real link behaviour and replaces this
  handler. `href`s with schemes other than http, https, mailto, tel are dropped.
- **Images** are a dashed placeholder box with the alt text (`data-src` holds
  the target) as the spec says; a raw `<img>` from HTML is a real element.
- **Table width.** Tables are `width: max-content` with cells capped at 28 em, so
  a table with long text scrolls inside its `.table-wrap` instead of squeezing
  every column (FR-TABLE-01); short tables look the same as before.
- **Tolerant tables** are what Lezer's GFM table parser accepts, which is what
  GitHub accepts: a delimiter row with the same number of cells as the header.
  Missing outer pipes, uneven padding, short and long rows work (short rows are
  padded, extra cells cut). A delimiter row with a different cell count is
  not a table, as on GitHub.
- **Earlier suites** (S02, S03) start the app with `defaultMode: "source"` in
  the test profile's `settings.json` (new option `settings` of `launchApp`):
  they test the editor, and the default is now Rendered. S01 needs no change.
- **jsdom** is a new dev dependency: DOMPurify does not run on happy-dom's HTML
  parser (it returns scripts untouched), so `render.test.ts` uses
  `// @vitest-environment jsdom`. The other unit tests stay on happy-dom.
- **Footnote definitions** are plain text with inline markup, multi-paragraph
  definitions become one paragraph. Footnote references to undefined
  definitions stay as text (as on GitHub).
- A `Mod-1` pressed with the focus in the find bar still switches the mode
  (the dispatcher is global, as for the other commands).

**Gotchas for later steps**
- The rendered pane of every tab stays in memory (`doc.rendered`); its DOM is
  detached when the tab is not active. A detached scroller loses its scroll
  position: `panes.ts` stores the source offset at the top (`doc.topPos`) and
  restores it with `scrollToPos`.
- `RenderedView.blockRanges()`, `elementAt(pos)`, `topSourcePos()`,
  `scrollToPos(pos)` are what S05 (checkbox, link jumps), S06 (outline jumps,
  highlight of the current heading) and S11 (find in Rendered) build on. Heading
  elements have GitHub ids; `data-from` of a heading is its source offset.
- To know when the rendered DOM changed (S05 decorations such as code
  highlighting, Mermaid, S06 outline), a hook after `renderNow()` is the place;
  there is none yet. Elements that were kept by an incremental render are the
  same DOM nodes, new ones are fresh: post-processing must be idempotent.
- Task checkboxes are `disabled` for now (S05). Code blocks are `pre[data-lang]
  > code`, Mermaid blocks are `pre[data-lang=mermaid]`: S05 replaces them.
- `renderBlock` output for a block with raw HTML goes through DOMPurify
  (`PURIFY` in `view.ts`: forbids script, style, iframe, object, embed, form,
  textarea, select, button, link, meta, base, template; a hook removes `style`
  attributes with `url(`). Everything else is built from escaped text and
  `safeUrl`. Any new element a step adds from Markdown text must escape too.
- `Doc.mode` is set in `Workspace.makeView` from `deps.defaultMode`; the session
  restores it per tab (`SessionTab.mode`).
- This session's shell tooling turned backslash-n inside Python and heredoc
  strings into real newlines again (see S03 notes); several files had to be
  repaired with the editor tool. Write such files with the editor tools.
- `big.md` (gitignored, made by `tools/make-big.mjs`) is needed by e2e test 8.

**Dependencies added**
- npm runtime: `dompurify` (3.5, ships its own types). Dev: `jsdom`.
- Lucide icons used: `BookOpen`, `Code`, `Columns2`.

## 7. Open issues

| ID | Issue | Proposal |
|---|---|---|
| S04-01 | Every incremental render rewrites `data-from`/`data-to` of all blocks after the edit (about 95 ms on the 2 MB document, 28,900 blocks). Fine for typing, but it grows with the document. | Accept for now; S10 measures. If needed, keep offsets relative to a per-block base and add the delta lazily where they are read. |
| S04-02 | After a full render (large edit, footnote or link-reference edit) the rendered pane keeps its pixel scroll position, so the content under the reader can move. | Accept; S10 can restore the position through `topSourcePos` / `scrollToPos` around full renders if it bothers. |
| S04-03 | Footnote definitions render as one paragraph (no block content inside a footnote, no nesting in lists or quotes). | Accept: rare in the documents this app targets. |
| S04-04 | Split mode does not scroll the rendered side to the cursor while typing, only on scrolling. | Accept; S11/S06 may add "follow the cursor" if wanted. |
| S04-05 | HTML grouping covers `details`, `div`, `center`, `section` only, and only when the tags sit in HTML blocks of their own. Other tags (`table` with blank lines inside, `p align`) behave as separate blocks. | Accept; extend the list in `WRAPPER` if a real document needs it. |
| S04-06 | The first render of a big document in Split/Rendered mode blocks the page for about 650 ms (2 MB). | Accept for phase 1 (NFR-02 measures typing and catch-up); S10 may render in time slices. |
| S04-07 | The mode switch sits next to the menu button at the left of the toolbar; S07 puts the formatting toolbar in the same bar. | Decide the final toolbar layout in S07 (proposal: mode switch stays left, formatting buttons follow it). |
