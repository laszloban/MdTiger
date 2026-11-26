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

**Result:** `npm run check` passes: typecheck, 62 Vitest tests (21 new), 17 `cargo test` tests, release build, 33 end-to-end tests (9 S01, 14 S02, 10 S03). The e2e suites were run twice in a row (plus the S03 suite twice alone), green each time. The manual checks (§4.3) are left to the user.

**What was built**
- `src/editor/markdownSupport.ts`: the one place for Lezer Markdown extensions
  (`lezerMarkdownExtensions`, empty until S04 adds front matter) and the
  `markdown()` language with `codeLanguages: languages` (lazy loading). The
  Markdown keymap is added here too (see deviations).
- `src/editor/createEditor.ts`: `createEditorState(text, sep, extra, options)`
  now assembles everything: Markdown, `classHighlighter` (plus a second style
  that adds `tok-h1` to `tok-h6` to headings), wrapping, `drawSelection`,
  active line, bracket matching, multiple selections, find, optional line
  numbers and live preview. `options` (`EditorOptions`) come from the new
  `editorOptions` dependency of `Workspace`, which `main.ts` fills from the
  settings, so a per-document state is re-created correctly (also by "Use
  draft").
- `src/editor/lists.ts`: Tab / Shift+Tab (`listTab`, `listShiftTab`).
- `src/editor/find.ts`: the `FindBackend` interface, `SourceFindBackend`, and
  `findExtension()` (query state, match highlighting, change notification).
- `src/ui/findBar.ts` (the bar, backend-agnostic), `src/ui/gotoLine.ts`
  (`parseLineSpec` and the bar), `src/editor/livePreview.ts` (ported from the
  spike).
- `Layout.dock` (`#dock`, between banner and content) holds both bars; opening
  one closes the other. Element ids for tests: `#find-bar #find-input
  #replace-input #find-replace-row #find-count #find-case #find-word
  #find-regex #find-prev #find-next #find-close #replace-one #replace-all
  #find-toggle-replace #goto-bar #goto-input`; match classes `.cm-find-match`
  and `.cm-find-current`.
- Commands: `find.open` (Ctrl+F), `find.replace` (Ctrl+H), `find.next` (F3),
  `find.prev` (Shift+F3), `edit.goToLine` (Ctrl+G), `edit.undo`, `edit.redo`.
- Settings keys added: `editor.lineNumbers` (default false) and
  `experimental.livePreview` (default false). Both are read when a document's
  editor is created, so a change needs the document to be reopened (live
  preview: reload); there is no UI until S09.

**Deviations and decisions**
- **No CodeMirror search panel.** CodeMirror highlights matches only while its
  own panel is open, so the bar keeps the query in the editor state
  (`setSearchQuery`) and the highlighting is ours (`cm-find-match`). `findNext`,
  `findPrevious`, `replaceNext` and `replaceAll` are CodeMirror's own.
- **Plain searches are literal** (`SearchQuery.literal` is true unless the
  regex toggle is on). CodeMirror's default would turn a typed backslash-n into
  a newline. `$1` to `$9`, `$&` and `$$` work out of the box in regex mode
  (tested).
- **Enter on an empty list item ends the list, also in a two-item list.**
  CodeMirror's default Enter makes a tight two-item list loose instead (it
  inserts a blank line and keeps the marker). The Markdown keymap is therefore
  registered by us (`insertNewlineContinueMarkupCommand({ nonTightLists:
  false })` and `deleteMarkupBackward`) with `addKeymap: false`.
- **Tab outside a list inserts the indent unit** (two spaces), not a tab
  character (CodeMirror's `insertTab` would insert a tab); with a selection it
  indents the lines. In a list the whole item with its children moves; an item
  is indented by its marker width (`- ` 2, `1. ` 3) so that it really nests.
  The first item of a list cannot be indented (nothing to nest under), the key
  does nothing there. Shift+Tab on a top-level item does nothing.
- **Undo/redo have no registered shortcuts.** CodeMirror owns Ctrl+Z, Ctrl+Y
  and Ctrl+Shift+Z while the editor has focus; a global shortcut would also
  fire in the find bar's text fields and undo the document instead of the
  field. The commands exist for the palette (S09).
- **Alt+click** adds a cursor; **Alt+Shift+drag** makes a rectangular
  selection (plain Alt+drag would clash with Alt+click).
- The counter shows `k of N` when the selection is a match, `N results` when
  it is not, `No results`, `Invalid regex`; above 10,000 matches `10000+`
  (e.g. `3 of 10000+`). When the document changes, counting is throttled to
  once per 150 ms; explicit actions (typing in the field, next/previous)
  refresh at once.
- Typing in the search field selects the first match at or after the cursor
  (incremental search). A change of the active tab re-applies the query to the
  new editor (`findBar.retarget()`); the old editor keeps its highlight until
  it is shown again.
- Ctrl+H does not move focus to the replace field; it opens the row and
  focuses the search field.
- Copying is CodeMirror's default (`text/plain` only); test 7 checks the real
  clipboard formats.

**Gotchas for later steps**
- `FindBackend` (`src/editor/find.ts`) is what S11 implements for the rendered
  view. `mountFindBar(dock, { backend, ... })` takes one backend, so S11 needs
  a backend that switches on the active mode (or a wrapper).
- Unit tests that call CodeMirror's search commands need a real `EditorView`
  (happy-dom is enough): `findNext` and friends read the view's plugins.
  Commands that only use `state` and `dispatch` (the list commands) work on a
  plain `{ state, dispatch }` holder; see `editing.test.ts`.
- `syntaxTree(state)` is parsed lazily; unit tests call
  `ensureSyntaxTree(state, state.doc.length, ms)` after creating a state.
- `@codemirror/language-data` makes one JS chunk per language in `dist/`
  (about 40 files); only the chunks a visible block needs are fetched.
- This suite's `start()` calls `app.focusWindow()` after the launch: without
  it, the first key press of the first test after a relaunch was lost once
  (seen in test 2).
- Typing latency (test 9, 2 MB document, 200 keystrokes 25 ms apart): p90 =
  32 ms, max 32 ms. The Event Timing API reports multiples of 8 ms and only
  events of 16 ms or more, so these values are at the floor of what it can
  report. The test pads the unreported events with zeros.
- The live-preview extension is created without image resolving
  (`livePreview((u) => u)`): relative image paths are not resolved against the
  document yet (S05).
- Writing source files from a shell heredoc through the agent tooling turned
  backslash sequences such as backslash-n into real newlines; use the editor
  tools for files with escapes.

**Dependencies added** (npm; latest at the time, pinned in the lockfile):
`@codemirror/lang-markdown`, `@codemirror/language`, `@codemirror/language-data`,
`@codemirror/search`, `@lezer/highlight`, `@lezer/markdown`, `@lezer/common`
(types only; already a transitive dependency). Lucide icons used:
`CaseSensitive`, `ChevronDown`, `ChevronRight`, `ChevronUp`, `Regex`,
`WholeWord`, `X`.

## 7. Open issues

| ID | Issue | Proposal |
|---|---|---|
| S03-01 | `editor.lineNumbers` and `experimental.livePreview` are read when a document's editor is created; changing them in `settings.json` while documents are open has no effect until they are reopened. | Accept for now; S09 (settings UI) reconfigures open editors through a `Compartment`. |
| S03-02 | No shortcut is registered for Undo/Redo (see notes), so the palette (S09) would list them without a key. Ctrl+Z / Ctrl+Y themselves work (CodeMirror's keymap; confirmed at verification). | S09 shows Ctrl+Z / Ctrl+Y as static text for these two commands. |
| S03-03 | Ctrl+H opens the replace row but leaves focus in the search field. | **Resolved at verification:** focus in the search field is right; a single Tab now moves to the replace field (Shift+Tab back), see e2e test 4. |
| S03-04 | The highlight in a tab you left stays until the tab is shown again. | Accept. |
| S03-05 | Indenting the first item of a list does nothing, and so does Shift+Tab on a top-level item. | Accept (what most Markdown editors do). |
