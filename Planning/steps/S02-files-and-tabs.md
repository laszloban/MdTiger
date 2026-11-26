# S02 – Files and tabs

| | |
|---|---|
| **Depends on** | S01 |
| **Requirements** | FR-FILE-01 (command line, dialog, drag and drop; file association is S12), FR-FILE-02, FR-FILE-03, FR-FILE-05, FR-FILE-06, FR-FILE-10, NFR-10 (unsaved edits survive a renderer restart) |
| **Spike reference** | `spike/frontend/src/main.ts` sections *tabs*, *drafts*, *startup* (`readSession`/`saveSession`); `spike/frontend/src/editor.ts` (`detectLineSeparator`) |

## 1. Goal

Open, edit, save and close Markdown files in tabs, byte-exact, without ever
losing unsaved text: not on close, not on window close, not when the web
engine restarts.

## 2. Scope

**In:** the document model, a minimal CodeMirror editor as the tab's view
(plain text, undo history, correct line separator), opening (command line,
second instance, Open dialog, drag and drop), Save, Save As, dirty markers,
close prompts, tab strip behavior, drafts, session restore after a renderer
reload, the app menu button.

**Out:** Markdown highlighting, find/replace, list editing (S03); rendering
and modes (S04); reacting to outside changes (S10); recent files and
restoring the last session on app start (S09).

## 3. Design and tasks

### 3.1 Document model (`src/core/doc.ts`)

One `Doc` per tab: `id`, `path` (or `null` for a new unsaved document),
`bom`, `lineSeparator` (`"\n"` or `"\r\n"`, detected from the file's first
line break; LF for new documents), `savedDoc` (CodeMirror `Text` at last
save), `mtime` (file's at last read/save), `view` (its own `EditorView`, so
undo history and scroll position stay per tab), and slots later steps fill:
`mode` (S04), `fold` (S06).

- `isDirty = !view.state.doc.eq(savedDoc)`.
- **Saving** writes `view.state.sliceDoc()` (which joins lines with the
  file's own separator, because the editor's `EditorState.lineSeparator`
  facet is set to it) plus the BOM flag. Never normalise anything.
- New document (`Ctrl+N`): an untitled tab, saved via Save As.

### 3.2 Minimal editor (`src/editor/createEditor.ts`)

A CodeMirror `EditorView` with: `lineSeparator` facet, history, default
keymap, line wrapping, and an update listener that notifies the doc model.
S03 extends this same factory; keep it a single place where extensions are
assembled.

### 3.3 Opening

| Path | Behavior |
|---|---|
| Command line | `host.initialFiles()` at start, each as a tab; the last one is active. |
| Second instance | The `open` host event: opens a tab, or **switches to the existing tab** if the path is already open (compare case-insensitively, after normalising separators). Bring the window to the front. |
| `Ctrl+O` | `host.pickFile()` (Tauri dialog, filter `*.md;*.markdown`, multi-select). |
| Drag and drop | Tauri's window drag-drop event. `.md` and `.markdown` open; other files give a status hint "Not a Markdown file: <name>". |
| Errors | Missing file, no access: a status-bar hint and a log line, no dialog, no tab. |
| Invalid UTF-8 | The file opens (the shell has replaced invalid bytes with U+FFFD; `read_file` must report that it did, e.g. `lossy: true`). The doc remembers the flag. On save, the file is written and a non-blocking notification says the invalid bytes were replaced (plan OI-06). No dialog, no read-only mode. |

### 3.4 Saving and closing

- Commands: `file.new` (Ctrl+N), `file.open` (Ctrl+O), `file.save`
  (Ctrl+S), `file.saveAs` (Ctrl+Shift+S), `tab.close` (Ctrl+W, Ctrl+F4),
  `tab.closeAll`, `tab.closeOthers`, `tab.next` / `tab.prev` (Ctrl+Tab,
  Ctrl+Shift+Tab, Ctrl+PgDn, Ctrl+PgUp).
- Closing a dirty tab shows an **in-app modal dialog** (`src/ui/dialog.ts`,
  not a native message box, so it is themed and testable): *Save*,
  *Don't save*, *Cancel*. Closing several dirty tabs asks once per tab, with
  a *Save all* option when more than one is dirty.
- **Window close:** Rust intercepts `CloseRequested`, asks the front end
  (event), and closes only when the front end confirms. If the front end
  doesn't answer within 3 s (dead page), close anyway; drafts (§3.6) keep
  the text.
- Save As: native save dialog, default name from the tab title, `.md`
  appended if no extension was given. The tab takes the new path.
- After saving, the dirty marker clears and the draft is deleted.

### 3.5 Tab strip (`src/ui/tabs.ts`)

- Title = file name; dirty marker `●` before the close button; tooltip =
  full path. Middle-click closes. Reorder by dragging.
- When tabs overflow, the strip scrolls horizontally and the active tab is
  scrolled into view.
- The window title is `<file name> – MdTiger` (with `●` when dirty).

### 3.6 Drafts and session restore

- **Drafts** (`src/core/drafts.ts`): 1 s after the last change, a dirty
  document's text is written to a draft file in the profile folder
  (`<profile>\drafts\`, via the host; decided in S02-05) keyed by its path, with the
  file's `mtime` at the time (`baseMtime`), `bom` and `lineSeparator`.
  Untitled documents use their tab id.
- On opening a file with a draft:
  - same `mtime` → restore the draft into the editor (the document is then
    dirty) and show the banner "Unsaved changes restored" with *Discard*;
  - different `mtime` (the file changed since) → **don't** apply it; show the
    banner "An older unsaved draft exists" with *Use draft* and *Discard*.
- **Session** (`sessionStorage`): open paths, order, active tab, and each
  tab's untitled draft id, written on every tab change. After a renderer
  reload (S01 crash recovery) the app reopens exactly these tabs. A real
  app start ignores it (that is S09's *reopen last session* option).

### 3.7 App menu (`src/ui/menu.ts`)

A menu button at the left of the toolbar (a menu icon) with the file
commands and their shortcuts. A small reusable dropdown component: S07, S08,
S09 and S11 add items or reuse it.

### 3.8 Test hooks

When `MDTIGER_TEST=1`, expose `window.__mdtiger` with `commands`, `docs`
(read-only views of the doc model), and `nextPickPath` / `nextSavePath`
overrides so the Open and Save As dialogs can be bypassed in end-to-end
tests. Nothing of this exists in a normal run.

## 4. Tests

### 4.1 Unit

- `detectLineSeparator`: LF, CRLF, no line break (→ LF), first break wins.
- Drafts: write/read/clear; restore decision for same and different mtime.
- Path comparison: `C:\A\b.md` equals `c:/a/B.md`.

### 4.2 End to end (`tests/e2e/s02-files-and-tabs.test.mjs`)

Fixtures to add: `crlf-bom.md` (from S01), `mixed-eol.md` (both LF and
CRLF), `no-final-newline.md`, `hungarian.md` (accented text: árvíztűrő
tükörfúrógép), `latin2.md` (not UTF-8, for the lossy path).

1. Start with three files → three tabs, the last active, titles and
   tooltips correct.
2. Byte fidelity: for every fixture (except `latin2.md`), open → save →
   SHA-256 unchanged.
3. Edit one character → tab shows `●`, window title too → save → marker
   gone, file contains the change and nothing else changed (compare bytes
   outside the edit).
4. CRLF + BOM file: type a new line in the middle → save → every line break
   in the file is still CRLF, BOM still there.
5. Second instance with an open path → no new tab, that tab becomes active.
   With a new path → new tab.
6. `latin2.md` → opens in a tab, no dialog; save → the notification about replaced bytes appears, and the log has a line. A missing path → no tab, status hint, log line.
7. Close a dirty tab → dialog appears; *Cancel* keeps it; *Don't save*
   closes it and the file is unchanged; *Save* saves and closes.
8. Save As via `nextSavePath` → new file written, tab title changes, old
   file unchanged.
9. Tab reorder by dragging (CDP mouse events) changes the order; Ctrl+Tab
   cycles in the new order.
10. Draft after renderer kill: edit, wait 1.5 s, kill the renderer → the
    same tabs come back, the edited one dirty with the edit, banner shown.
11. Stale draft: edit file A, wait 1.5 s, kill the app; change A on disk;
    start again with A → the disk content is shown, the "older draft" banner
    offers *Use draft*.
12. Earlier suites (S01) still pass.

### 4.3 Manual

- Drag a `.md` file from Explorer onto the window → it opens. A `.txt` file
  → status hint.
- Ctrl+O shows the native dialog with the Markdown filter; multi-select
  opens all.
- Close the window with a dirty tab → the dialog appears; with the
  renderer frozen (not killed) the window still closes within ~3-6 s (e2e
  test 13 covers this too).
- On the real keyboard: Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PgDn/PgUp, Ctrl+W,
  Ctrl+N, Ctrl+S, Ctrl+Shift+S work (S02-06). Type Hungarian text (áéíóöőúüű),
  save: the file stays UTF-8.
- Save As: the native dialog opens with the tab's name; a name without an
  extension gets `.md`.

## 5. Done when

All tests above pass with `npm run check`, the manual checks are done, and
open issues are listed below.

## 6. Implementation notes

**Result:** `npm run check` passes: typecheck, 41 Vitest tests, 17 `cargo test`
tests, release build, 23 end-to-end tests (9 from S01, 14 from S02: the 12
cases of §4.2 plus 4b, 13 and 14). The e2e suites were run twice in a row,
green both times. The manual checks (§4.3) are left to the user.
**Verified by the user (2026-11-26):** all manual checks of §4.3 passed,
including Explorer drag and drop (S02-08) and Ctrl+Tab, Ctrl+Shift+Tab,
Ctrl+W, Ctrl+N on a real keyboard (S02-06).

**What was built**
- `src/core/doc.ts` (`Doc`, `detectLineSeparator`), `workspace.ts` (all tab
  logic: open, activate, reorder, save, save as, close, drafts, session;
  UI-free, dialogs injected), `drafts.ts`, `paths.ts`.
- `src/editor/createEditor.ts`: the one place the editor extensions are
  assembled (line separator facet, history, default keymap, wrapping). S03
  extends it. The update listener is a per-document extension passed in `extra`.
- `src/ui/`: `dialog.ts` (in-app modal), `tabs.ts`, `menu.ts` (reusable
  dropdown, Lucide `Menu` icon), `views.ts` (shows the active editor, banner,
  window title). `layout.ts` got `notify()` (the `#toast`, 10 s) and
  `setStatus` now clears itself after 10 s.
- Shell: `read_file` reports `lossy`; `pick_files` / `pick_save_path` (native
  dialogs, via the Rust side of `tauri-plugin-dialog`, so no JS package and no
  capability entry); `set_title`; `is_test_mode`; the window close handshake;
  the `DragDrop` window event becomes a `drop` host event; `drafts.rs`.
- Element ids for tests: `#app-menu-button #app-menu`, `.tab .tab-title
  .tab-dirty .tab-close`, `#dialog #dialog-save #dialog-saveAll
  #dialog-discard #dialog-cancel`, `#banner-text #banner-use-draft
  #banner-discard`, `#toast`.
- Commands: `file.new/open/save/saveAs`, `tab.close/closeAll/closeOthers/next/prev`.
  `Command` got `altShortcuts` (Ctrl+F4, Ctrl+PgDn/PgUp). All of them are
  disabled while a dialog is open (they still swallow their key).
- `window.__mdtiger` now also has `workspace` and `docs` (a snapshot array).
  With `MDTIGER_TEST=1` it also has `testHooks` (`nextPickPath`,
  `nextSavePath`) and `emitHostEvent` (simulates a drop, which CDP cannot do).
  The overrides do not exist in a normal run.

**Deviations and decisions**
- **Drafts are files, not localStorage** (§3.6 said localStorage). Chromium
  commits localStorage only after about 5 s, so test 11 (edit, wait 1.5 s, kill
  the app) cannot pass with it. Drafts now go through
  `host.draftGet/Set/Remove` to `<profile>\drafts\<fnv64 of key>.json`
  (`drafts.rs`). The browser dev host still uses localStorage. The session
  stays in `sessionStorage` as specified; it survives a renderer kill
  (test 10). See S02-05.
- **Window close handshake:** the shell prevents the close, emits
  `close-requested`, and the page replies `close_ack` at once and **once a
  second while the dialog is open**; `close_response(allow)` ends it. Three
  silent seconds (a frozen page) close the window anyway. A single ack was not
  enough: a page that acked and then froze blocked the close forever (found by
  test 13). Before the first `ready` (window not shown yet) the close goes
  straight through.
- **S02-01 (mixed EOL), tested:** `mixed-eol.md` round-trips byte-exact without
  edits. The first line break decides the separator (CRLF there); the lone LFs
  stay inside the lines as characters. After typing at the start, the file is
  the original plus the typed text only, so an edit does **not** normalise the
  other kind. Pressing Enter inserts the file's own separator (CRLF).
- **S02-02:** only `.md` / `.markdown` by drop and in the dialog filter (the
  dialog offers "All files" as a second filter; Markdown is the default).
  Files named on the command line or by a second instance open whatever they
  are, because the user asked explicitly.
- **S02-04 / OI-06:** `latin2.md` opens lossily; saving shows the toast "Saved
  X. Invalid UTF-8 bytes in the original file were replaced with U+FFFD" and
  logs `WARN saved with invalid UTF-8 bytes replaced by U+FFFD`. The flag
  clears after that save (the file is valid UTF-8 now). No dialog, no
  read-only mode.
- The window title goes through a `set_title` command (and `document.title`),
  because a WebView2 page title does not change the native window title.
- Closing the window with unsaved tabs asks per tab and leaves the tabs open
  if the user cancels. "Don't save" removes that tab's draft right away.
- A failed save (no access) gives a status hint and a log line; the tab stays
  dirty and a close in progress stops.
- Not done on purpose: Save As onto a path that is open in another tab does
  not merge the two tabs.

**Gotchas for later steps**
- **The first mouse press into a window that has no focus is swallowed** (the
  page never sees `pointerdown`). The e2e helper primes the window once per
  launch (`app.focusWindow()`, called by `click` and `drag`). Without it, drag
  and click tests are flaky.
- Tab reordering uses pointer events, not HTML5 drag and drop: Tauri's
  `dragDropEnabled` takes over HTML5 DnD on Windows.
- Each test file must close its app before starting the next one (single
  instance): the S02 `start()` helper does it. S01's tests close in `after`.
- Added to `tests/e2e/lib/app.mjs`: `app.drag()`, `app.cdp()`,
  `app.focusWindow()` and the `PageUp`/`PageDown` keys. The window-close tests
  send WM_CLOSE with PowerShell's `CloseMainWindow()`; a frozen page is
  simulated with CDP `Debugger.pause`.
- `Doc.view` is one `EditorView` per tab, kept alive while the tab is open and
  detached from the DOM while inactive. `views.ts` saves and restores the scroll
  position (a detached scroller loses it). "Use draft" calls `view.setState` with
  a fresh state, so per-document extensions must be re-created there
  (`Workspace.extensionsFor`); S03 should add its extensions in
  `createEditorState`.
- Draft key = normalised path (lower case, backslashes), so two spellings of a
  path share one draft. Untitled documents use their tab id.
- `tests/e2e/.tmp/` is git-ignored test output; the stale runs were deleted.

**Dependencies added**
- npm: `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`,
  `lucide` (vanilla; imported per icon: `Menu`, `X`).
- Rust: `tauri-plugin-dialog` 2 (used from Rust only; pulls in `rfd`).
- Not added: the JS packages of the dialog plugin, `@codemirror/lang-markdown`
  (S03/S04), `notify` (S10).

## 7. Open issues

| ID | Issue | Proposal |
|---|---|---|
| S02-01 | ~~Mixed line endings.~~ | **Resolved by test:** byte-exact without edits; an edit does not normalise the other kind (see §6). |
| S02-02 | ~~Which files open.~~ | **Resolved:** only `.md` / `.markdown` by drop and dialog filter. |
| S02-03 | Non-UTF-8 files are refused. | **Decided:** no codepage detection; they open lossily (S02-04). |
| S02-04 | Lossy read. | **Decided and done:** open, then notify on save (§6). |
| S02-05 | Drafts are files in the profile folder, not localStorage as §3.6 said, because localStorage loses the last ~5 s when the app is killed. | **Decided:** keep the files; §3.6 updated. Cleaning up old drafts is a candidate for S10. |
| S02-06 | Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+W and Ctrl+N are WebView2 browser accelerators. The e2e tests prove our handler gets the keys (CDP), a real keyboard may differ. | **Decided:** check by hand at verification; if WebView2 eats Ctrl+Tab, Ctrl+PgDn/PgUp stay the route. |
| S02-07 | The app menu has no arrow-key navigation. | **Decided:** accepted; S09's command palette is the keyboard route. |
| S02-08 | The OS drag from Explorer cannot be tested over CDP; only the `drop` host event is simulated. | **Decided:** manual check at verification. |
