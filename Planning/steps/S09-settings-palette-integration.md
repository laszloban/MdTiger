# S09 – Settings, command palette, window and default app

| | |
|---|---|
| **Depends on** | S08 |
| **Requirements** | FR-APP-01, FR-APP-02 (UI), FR-APP-03, FR-APP-04, FR-APP-05 (the prompt; registration is S12), FR-FILE-07 |
| **Spike reference** | `spike/frontend/src/main.ts` section *default app* (`checkDefaultApp`); `spike/tauri/src-tauri/src/main.rs` `default_app_status`, `open_default_apps_settings` |

## 1. Goal

Make MdTiger feel like a finished app: every command findable in a palette,
settings editable in a panel, shortcuts customisable, window and layout
remembered, recent files, an About box, and the polite "make MdTiger your
default Markdown app?" question.

## 2. Scope

**In:** command palette, settings panel, shortcut customisation, window
state, recent files, reopen-last-session option, default-app check and
prompt, About.

**Out:** installer-side file association (S12).

## 3. Design and tasks

### 3.1 Command palette (FR-APP-01) (`src/ui/palette.ts`)

- **Ctrl+Shift+P** (and F1) opens a centred overlay: input + list of all
  enabled commands with their current shortcuts. Fuzzy match on label
  (and id), recent commands first when the input is empty. Up/Down,
  Enter runs, Escape closes and returns focus.
- Disabled commands (e.g. formatting in Rendered mode) are listed greyed
  with the reason, not hidden.

### 3.2 Settings panel (FR-APP-02) (`src/ui/settingsPanel.ts`)

- Opened by **Ctrl+,** and from the app menu. An in-app overlay panel
  (not a tab, not a separate window), grouped: *Appearance* (theme, style,
  fonts, size, content width, zoom), *Editor* (default mode, line numbers,
  code wrap), *Files* (reopen last session, recent files count),
  *Keyboard shortcuts* (§3.3), *System* (default-app check, open settings
  file, open styles folder, open log folder).
- Every control writes through `settings.set` and applies live.
- *Open settings file* opens `settings.json` with the OS default editor
  (opener). When the file changes on disk, settings reload live (watch it).
- Invalid values in the file fall back to defaults per key and log a
  warning; the file isn't rewritten until the user changes something.

### 3.3 Shortcut customisation (FR-APP-03)

- In the panel: a searchable table of commands with their shortcut; click a
  shortcut cell, press the new combination, Enter to keep, Escape to
  cancel, a reset button per row and *Reset all*.
- Conflicts are shown inline ("Already used by Bold") and must be resolved
  before saving (replace or cancel).
- Stored in settings as overrides only: `{"keys": {"format.bold": "Mod-b"}}`;
  `null` unbinds.
- Recording follows the keyboard-layout rule (physical key codes, no
  Ctrl+Alt: refuse it with a hint).

### 3.4 Window and layout state (FR-APP-04)

- Rust saves window position, size and maximised state on move/resize
  (debounced) and on close, and restores them at startup **before showing
  the window**. If the saved position is off every current monitor, center
  on the primary monitor. Use `tauri-plugin-window-state` if it fits these
  rules, otherwise ~50 lines of own code.
- Sidebar visibility/width (S06), split ratio (S04) and last used mode
  (new tabs open in the last used mode when `defaultMode` is `"last"`) are
  already settings; make sure they survive restarts.

### 3.5 Recent files and last session (FR-FILE-07)

- The app menu gets *Open recent* with the last 10 files (setting
  `recent.max`), most recent first, with *Clear list*. Missing files are
  shown greyed and removed when clicked (status hint).
- Setting `session.reopen` (default **true**): on app start without file
  arguments, reopen the tabs of the last session (paths, order, active
  tab, modes). Files that no longer exist are skipped silently (logged).
  With file arguments, open only those.
- Keep startup within budget: open the active tab first, the others lazily
  when first activated.

### 3.6 Default Markdown app (FR-APP-05)

- 3 s after startup (never delaying the first paint), check
  `default_app_status` for `.md` (and `.markdown`). If MdTiger isn't the
  default and `defaultApp.ask` is true, show a **non-blocking banner**:
  "MdTiger isn't your default app for Markdown files." with *Make default…*,
  *Not now*, *Don't ask again*.
- *Make default…* opens Windows' Default apps page for MdTiger
  (`ms-settings:defaultapps?registeredAppUser=MdTiger` if supported, else
  the general page) and shows a hint on what to pick.
- *Not now* hides it until the next start; *Don't ask again* sets
  `defaultApp.ask = false` (re-enable in Settings → System).
- Detection must recognise MdTiger's ProgId as registered by the S12
  installer (`MdTiger.md` or whatever S12 defines: keep the ProgId in one
  constant in Rust and reference it in S12).

### 3.7 About

App menu → *About MdTiger*: icon, version, licence, link to the GitHub
repo (opens in the browser), WebView2 version, log folder link.

## 4. Tests

### 4.1 Unit

- Fuzzy matcher ranking.
- Shortcut overrides: merge with defaults, unbinding, conflict detection,
  Ctrl+Alt refused.
- Recent list: dedupe (case-insensitive paths), max length, order.
- Window position sanity: off-screen rectangles are corrected.

### 4.2 End to end (`tests/e2e/s09-settings.test.mjs`)

1. Ctrl+Shift+P → palette lists commands with shortcuts; type `bold` →
   *Bold* first; Enter runs it (in Source mode).
2. Ctrl+, → panel; change theme and font size → applied live and present in
   `settings.json`.
3. Rebind *Bold* to Ctrl+Shift+B → the new combination works, Ctrl+B no
   longer does; conflict with an existing shortcut is reported; reset
   restores Ctrl+B.
4. Edit `settings.json` on disk (theme dark) → app switches without restart.
5. Recent files: open three files, restart with no arguments and
   `session.reopen=false` → *Open recent* lists them in order.
6. Session reopen: with `session.reopen=true`, restart with no arguments →
   same tabs, order, active tab and modes.
7. Window state: move/resize via Tauri API in test mode, restart → same
   bounds.
8. Default-app banner appears when the test profile says it isn't default
   (in test mode `default_app_status` can be forced via
   `MDTIGER_TEST_DEFAULT_APP=0|1`); *Don't ask again* persists across a
   restart.
9. Earlier suites still pass.

### 4.3 Manual

- *Make default…* opens the Windows Default apps page (open from the spike's
  manual list).
- Window restore on a two-monitor setup, then with the second monitor
  unplugged.

## 5. Done when

All tests pass with `npm run check`, manual checks done, open issues listed.

## 6. Implementation notes

<!-- Written by the implementing session. -->

## 7. Open issues

| ID | Issue | Proposal |
|---|---|---|
| S09-01 | `session.reopen` default. | **Decided:** true. |
