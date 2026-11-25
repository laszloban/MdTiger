# S06 – Outline sidebar and heading folding

| | |
|---|---|
| **Depends on** | S05 |
| **Requirements** | FR-NAV-01 … FR-NAV-10 |
| **Spike reference** | `spike/frontend/src/main.ts` section *outline* (`buildTree`, `renderOutline`, `rowByFrom`, `highlightCurrentHeading`, `outlineCommand`); `spike/frontend/src/render.ts` `headingsFromState` |

## 1. Goal

The Zettlr-like outline: a foldable tree of the document's headings,
**exactly as written, with no numbering added**, that jumps, follows the
scroll position, survives edits without losing its fold state, and can be
filtered, resized and hidden. Plus folding of whole sections inside the
document.

## 2. Scope

**In:** the outline sidebar and its controls, current-section highlight,
filter, width and visibility, per-tab fold state, section folding in the
editor and in the rendered view.

**Out:** nothing else; this is self-contained.

## 3. Design and tasks

### 3.1 Data (`src/outline/headings.ts`)

- Headings come from the editor's syntax tree in **every** mode
  (`headingsFromState`, incremental, no rendering needed), ATX and Setext,
  H1–H6. Headings inside code blocks, front matter or HTML are not
  headings (the tree already knows).
- Entry text: the heading's source text with the `#` markers / Setext
  underline removed and inline Markdown reduced to plain text (`**b**` →
  `b`, `` `c` `` → `c`, `[t](u)` → `t`) (FR-NAV-10). **Nothing is added**:
  no numbers, no prefixes (FR-NAV-02).
- Tree by level; a jump in levels (H1 → H3) nests the H3 under the H1
  without inventing an H2.
- Rebuild debounced (150 ms) on document changes; diff against the
  previous tree to keep fold state (§3.3).

### 3.2 Sidebar UI (`src/outline/outline.ts`)

- Each node with children has a chevron to fold/unfold (FR-NAV-03). Rows
  are indented by level; long text is truncated with an ellipsis and a
  tooltip with the full text.
- Header controls: *Collapse all*, *Expand all*, *Expand to level*
  (dropdown 1–6), and a filter field (FR-NAV-08): substring,
  case-insensitive, accent-sensitive; matching rows show with their
  ancestors; Escape clears.
- Click (or Enter on a focused row) jumps to the heading in the active
  view(s) and briefly highlights the heading there (FR-NAV-04). In Split
  mode both sides move. Keyboard: Up/Down move, Left/Right fold/unfold.
- **Current section** (FR-NAV-06): the row of the heading at the top of the
  primary view is highlighted and kept scrolled into view (spike: binary
  search, update only when the current heading changes, at most once per
  animation frame).
- Show/hide with **Ctrl+Shift+O** and a toolbar button (whose pressed state
  reflects visibility); width by dragging the sidebar edge (min 160 px,
  max 50 % of the window). Both stored in settings (`outline.visible`,
  `outline.width`) (FR-NAV-07).
- Empty state: "No headings".

### 3.3 Fold state across edits (FR-NAV-05)

- Key each node by its path of heading texts from the root
  (`Intro/Install/Windows`) plus an occurrence index for duplicates. After a
  rebuild, nodes whose key still exists keep their folded flag; new nodes
  start expanded.
- Fold state is per tab (`doc.fold.outline`) and survives tab switches and
  renderer reloads (store it with the session, S02).
- An external reload (S10) is a document change like any other.

### 3.4 Section folding in the document (FR-NAV-09)

- **Source mode:** fold a heading's section (up to the next heading of the
  same or higher level) via CodeMirror folding (`foldService`, or
  lang-markdown's own heading folding if it provides it). Fold markers in a
  narrow gutter; folded sections show a `…` placeholder.
- **Rendered mode:** a chevron appears on hover left of each heading;
  clicking collapses the following content up to the next heading of the
  same or higher level (CSS on the rendered blocks, no re-render).
- Commands `fold.section`, `unfold.section`, `fold.all`, `unfold.all`,
  reachable from the gutter/chevrons and the command palette (S09). **No
  default shortcuts**, and don't install CodeMirror's `foldKeymap`: its
  Ctrl+Shift+[ and Ctrl+Alt+[ don't work on a Hungarian layout (see the
  keyboard-layout rule in IMPLEMENTATION_PLAN §3). Users can bind them in
  S09. In Rendered mode they act on the heading at the top of the view.
- Outline clicks and links into a folded section unfold it first.

## 4. Tests

### 4.1 Unit

- Headings from fixtures: ATX, Setext, headings in code blocks/front matter
  ignored, inline formatting stripped, **`## 4.3 Foo` → `4.3 Foo`** and
  `## Foo` → `Foo` (no numbering).
- Tree building with level jumps.
- Fold-state keys: rename a heading → only that node loses its state;
  insert a new section → others keep theirs; duplicates handled.
- Filter matching includes ancestors.

### 4.2 End to end (`tests/e2e/s06-outline.test.mjs`)

1. Outline rows equal the expected heading texts of `showcase.md`, with no
   digits added (compare text exactly).
2. Fold a node → its children hidden; *Expand all* / *Collapse all* /
   *Expand to level 2* give the expected visible rows.
3. Click a row in Rendered, Source and Split → the heading is at the top of
   the view(s) and highlighted.
4. Scroll the document → the highlighted row follows and stays visible.
5. Fold a node, then type a new paragraph elsewhere → fold state kept; add
   a new heading → it appears, others keep their state.
6. Filter `install` → only matching rows and their ancestors; Escape
   restores.
7. Ctrl+Shift+O hides/shows; width drag persists across an app restart.
8. Section folding: fold a section in Source and in Rendered mode; an
   outline click into it unfolds it.
9. 2 MB document: typing p90 still < 50 ms with the outline visible.
10. Earlier suites still pass.

### 4.3 Manual

- The outline of a long real document is easy to scan; the current
  section highlight doesn't flicker while scrolling.

## 5. Done when

All tests pass with `npm run check`, manual checks done, open issues listed.

## 6. Implementation notes

<!-- Written by the implementing session. -->

## 7. Open issues

| ID | Issue | Proposal |
|---|---|---|
| | | |
