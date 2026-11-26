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
| Errors | Missing file, no access, invalid UTF-8: a status-bar hint and a log line, no dialog, no tab. |

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
  document's text is written to `localStorage` under its path, with the
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
tükörfúrógép), `latin2.md` (not UTF-8, for the error path).

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
6. `latin2.md` → no tab, status hint, log line, no dialog.
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
  renderer frozen (not killed) the window still closes within ~3 s.

## 5. Done when

All tests above pass with `npm run check`, the manual checks are done, and
open issues are listed below.

## 6. Implementation notes

<!-- Written by the implementing session. -->

## 7. Open issues

| ID | Issue | Proposal |
|---|---|---|
| S02-01 | Files with mixed line endings: CodeMirror splits lines on the one configured separator. Check whether `mixed-eol.md` round-trips byte-exact without edits, and what an edit does to it. | Must be byte-exact without edits. If an edit normalises the other endings, accept it and document it. |
| S02-02 | Should `.txt` (or any text file) open too, or only `.md` / `.markdown`? | Only Markdown for now. |
| S02-03 | Non-UTF-8 files are refused. Open as Windows-1250/1252 read-only instead? | Refuse for now (FR-FILE-05 is UTF-8). |
| S02-04 | From S01-4 (plan OI-06): the shell reads files lossily (invalid bytes become U+FFFD), and the user decided a notification at save time is enough. This overlaps with the "invalid UTF-8 is refused" rule in §3.3 and S02-03. | Decide at the start of S02: either keep refusing (then the shell should fail on invalid UTF-8 instead of replacing bytes, and no notification is needed), or open such files and show the notification when they are saved. The user's S01-4 decision points to the second. |
