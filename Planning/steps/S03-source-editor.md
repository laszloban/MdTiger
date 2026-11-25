# S03 – Source editor, find and replace

| | |
|---|---|
| **Depends on** | S02 |
| **Requirements** | FR-EDIT-02, FR-EDIT-06, FR-EDIT-08, FR-SEARCH-01 and FR-SEARCH-03 (in Source mode; Rendered mode is S11), NFR-02 (typing latency), NFR-09 (a, c) |
| **Spike reference** | `spike/frontend/src/editor.ts`, `spike/frontend/src/livePreview.ts`, `spike/tests/profile-typing.mjs` |

## 1. Goal

A good Markdown source editor: highlighted Markdown and fenced code, a find
and replace bar that meets FR-SEARCH-01/03 exactly, go to line, and list
editing that feels natural. The live-preview groundwork from the spike is
kept alive behind an experimental setting.

## 2. Scope

**In:** Markdown language (GFM) with nested code-language highlighting,
editor look (monospace, line wrapping, active line), the find bar,
replace, go to line, list continuation and indentation, undo/redo
shortcuts, the experimental live-preview extension.

**Out:** the formatting toolbar and its shortcuts (S07), the outline (S06),
the find bar in Rendered mode (S11; but design for it, §3.3).

## 3. Design and tasks

### 3.1 Markdown language

- `markdown({ base: markdownLanguage, codeLanguages: languages })` from
  `@codemirror/lang-markdown` and `@codemirror/language-data`. Code-language
  parsers load lazily, only when a block of that language is visible.
- The front-matter extension from S04 isn't there yet. Leave a single place
  (`src/editor/markdownSupport.ts`) where Lezer Markdown extensions are
  listed, so S04 adds it once and both editor and renderer get it.
- Highlighting via `@lezer/highlight`'s `classHighlighter` plus CSS classes
  (`.tok-*`) whose colors come from CSS custom properties, so S08 can theme
  them. Headings in the source get size/weight differences (subtle).

### 3.2 Editor setup

Line wrapping on, active-line highlight, bracket matching, multiple
selections (Alt+click), rectangular selection, `drawSelection`, a
monospace font from a CSS variable. No line numbers (setting
`editor.lineNumbers`, default off). Copying from the editor is plain text
only (CodeMirror's default; verify it).

### 3.3 Find bar (`src/ui/findBar.ts`)

A custom bar (not CodeMirror's default panel), docked at the top of the
content area, with: search field, replace field (shown with Ctrl+H or the
toggle), match case, whole word, regex toggles, match counter
(`3 of 17`, `No results`, `Invalid regex`), Previous / Next, Replace,
Replace all, close.

- The bar talks to a **`FindBackend` interface** (`setQuery`, `next`,
  `prev`, `replaceCurrent`, `replaceAll`, `count`, `currentIndex`, `clear`).
  This step implements the **source backend** on CodeMirror's
  `SearchQuery` / `setSearchQuery` / `findNext` / `replaceAll`. S11 adds a
  rendered backend for the same bar.
- Ctrl+F opens the bar and focuses the search field; if text is selected
  (single line), it becomes the search term. Ctrl+H does the same with the
  replace row open.
- F3 / Shift+F3 and, in the search field, Enter / Shift+Enter move to the
  next / previous match. Escape closes the bar and returns focus to the
  editor with the current match selected.
- All matches are highlighted; the current one differently.
- Regex replacement supports `$1`…`$9`, `$&`, `$$` (check CodeMirror's
  behavior; implement it if missing).
- **Replace all** is one transaction (one undo step) and reports
  "Replaced 12 occurrences" in the status bar.
- The counter updates as the document changes, debounced for big
  documents (count at most every 150 ms; above 10,000 matches show
  `10000+`).

### 3.4 Other editing commands

| Command | Shortcut |
|---|---|
| Undo / Redo | Ctrl+Z / Ctrl+Y, Ctrl+Shift+Z |
| Go to line | Ctrl+G (small input in the find-bar position, `line` or `line:col`) |
| List continuation | Enter (`insertNewlineContinueMarkup`); Enter on an empty item ends the list. Backspace at a marker (`deleteMarkupBackward`). |
| Indent / outdent list item | Tab / Shift+Tab inside lists. Outside lists Tab inserts the indent unit, so Tab never moves focus out of the editor. |
| Select all, copy, cut, paste | standard |

Register them all in the command registry (S01) so S09's palette lists
them.

### 3.5 Experimental live preview (NFR-09)

Port `spike/frontend/src/livePreview.ts` as an editor extension, enabled
only when the setting `experimental.livePreview` is `true` (default
`false`, no UI). It proves on every build that decorations still work with
the real editor setup. It is not a feature yet.

## 4. Tests

### 4.1 Unit (on `EditorState`, no DOM needed)

- List continuation: `- a|` + Enter → `- a\n- |`; `1. a|` → `2. `;
  `- [ ] a|` → `- [ ] `; empty item + Enter ends the list.
- Tab / Shift+Tab indent and outdent a list item and its children.
- Source find backend: counts with case, whole word, regex; invalid regex
  reports an error and doesn't throw; replace all with `$1` gives the
  expected text and is a single transaction.

### 4.2 End to end (`tests/e2e/s03-source-editor.test.mjs`)

1. Fenced code with `csharp`, `powershell`, `json`, `yaml`: tokens in the
   blocks get language-specific classes (lazy load done within 2 s).
2. Select a word, Ctrl+F → the field has the word, counter shows `1 of N`.
3. F3 / Shift+F3 / Enter / Shift+Enter move the current match and the
   counter.
4. Ctrl+H → replace row visible; *Replace all* with regex `(\w+)@x` →
   `$1@y`: document correct, status says the count, a single Ctrl+Z
   restores the original text exactly.
5. Escape closes the bar; the editor has focus and the match is selected.
6. Ctrl+G `120` → the cursor is on line 120 and it is visible.
7. Copy a selection in the editor → the clipboard has `text/plain` only.
8. `experimental.livePreview = true` (via settings, then reload) → a
   heading line shows without `#` when the cursor is elsewhere.
9. Typing latency on the 2 MB document (`tests/fixtures/big.md`, generated
   by `tools/make-big.mjs` from S01): p90
   < 50 ms over 200 keystrokes in the middle of the document (method from
   `spike/tests/profile-typing.mjs`).
10. Earlier suites still pass.

### 4.3 Manual

- Typing, list editing and find/replace feel normal; nothing jumps.
- IME / dead keys for Hungarian accents (`ő`, `ű`) work.

## 5. Done when

All tests pass with `npm run check`, manual checks done, open issues listed.

## 6. Implementation notes

<!-- Written by the implementing session. -->

## 7. Open issues

| ID | Issue | Proposal |
|---|---|---|
| | | |
