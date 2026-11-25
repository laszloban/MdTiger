# S01 – Foundation: project, shell, test harness

| | |
|---|---|
| **Depends on** | nothing |
| **Requirements** | FR-APP-02 (settings store), FR-APP-06 (window icon), NFR-01 (startup budget), NFR-10 (renderer crash recovery), NFR-11 (no error pop-ups) |
| **Spike reference** | `spike/tauri/src-tauri/src/main.rs`, `spike/frontend/src/host/*`, `spike/tests/shell-checks.mjs` (CDP helpers), `spike/tests/renderer-kill.mjs`, `spike/measure-startup.ps1` |

## 1. Goal

A buildable, testable, empty MdTiger: the Tauri app opens a window with the
tiger icon and the final layout regions, the front end talks to the shell
only through the `Host` interface, settings persist, errors are logged and
never shown as pop-ups, a dead renderer recovers, and both test levels (unit
and end to end) run with one command. Every later step builds on this.

## 2. Scope

**In:** project scaffold, icons, Rust shell basics, Host interface, command
registry, settings store, logging, app layout skeleton with an empty state,
unit and end-to-end test harness, startup measurement.

**Out:** opening files and tabs (S02), the editor (S03), anything rendered
(S04), theming beyond a neutral light look (S08), settings UI (S09).

## 3. Design and tasks

### 3.1 Scaffold

- Standard Tauri 2 layout at the repo root, as in IMPLEMENTATION_PLAN §4.
  `package.json` scripts: `dev`, `build` (typecheck + Vite build), `tauri`,
  `typecheck`, `test` (Vitest), `e2e` (`node --test tests/e2e/`), and
  `check` (typecheck, unit tests, `cargo test`, `tauri build --no-bundle`,
  end-to-end), and `check:ci` (the same without end-to-end).
- `.gitattributes`: `* text=auto eol=lf`, `*.png binary`, `*.ico binary`,
  `tests/fixtures/** -text`.
- `.gitignore`: `node_modules/`, `dist/`, `src-tauri/target/`,
  `src-tauri/gen/`, `tests/e2e/.tmp/`, `tests/fixtures/big.md`.
- `LICENSE`: MIT (OI-01). `README.md`: what MdTiger
  is, build and run instructions, link to `Planning/`.
- `.github/workflows/ci.yml` (OI-05): on push and pull request, on
  `windows-latest`: Node LTS, Rust stable, cache, then `npm run check:ci`
  (typecheck, unit tests, `cargo test`, `tauri build --no-bundle`; no
  end-to-end suites, they need a desktop session).
- Rust release profile as in the spike (`lto`, `codegen-units = 1`, `strip`).
- Product name `MdTiger`, bundle identifier `app.mdtiger.desktop`, exe name
  `mdtiger.exe`, version `0.1.0`.

### 3.2 Icons

- Generate `src-tauri/icons/` with `npx tauri icon assets/icon/Tiger.png`
  (the PNG is 512×512; use the SVG if the CLI accepts it at that point).
- Check that the `.ico` contains 16, 24, 32, 48 and 256 px images. The
  stripes may be hard to read at 16 px: note it as an open issue if so, but
  don't redraw the icon.
- Use the icon in the empty state (§3.6) as a small, unobtrusive logo.

### 3.3 Shell (Rust)

Port from the spike's `main.rs`, cleaned up into modules
(`files.rs`, `logging.rs`, `settings.rs`, `recovery.rs`, `main.rs`):

| Command | Behavior |
|---|---|
| `initial_files()` | Paths from the command line, resolved against the working directory. Returns the same list on every call (S02 uses it). |
| `read_file(path)` | `{ text, bom, mtime }`. Text without BOM. Errors as `Err(String)`. |
| `write_file(path, text, bom)` | Atomic: write a temp file in the same folder, then rename over the target. Returns the new mtime. |
| `stat_file(path)` | mtime or `null` if missing. |
| `settings_read()` / `settings_write(json)` | `settings.json` in the profile directory, atomic write. A missing or unparsable file returns `null` and is logged (the unparsable file is kept as `settings.json.bad`). |
| `log_msg(level, message)` | Appends to the log. |
| `app_ready(ms_since_navigation)` | Logs `ready ProcessMs=<n> FrontMs=<n>`, shows the window (§3.4). |

- **Profile directory:** `%APPDATA%\MdTiger\` for settings,
  `%LOCALAPPDATA%\MdTiger\` for logs and WebView data. If the environment
  variable `MDTIGER_PROFILE_DIR` is set, **everything** (settings, logs,
  WebView2 user data folder) goes under that folder instead. End-to-end tests
  rely on this to stay isolated from the user's real profile and drafts.
  Create the window in code (not from `tauri.conf.json`) so the WebView data
  directory can be set.
- **Logging:** `logs\mdtiger.log`, one line per entry
  (`2026-11-25T10:00:00.123Z INFO message`). When the file passes 1 MB,
  rename it to `mdtiger.1.log` (one backup kept).
- **Panic hook:** log the panic message and location; never show a dialog.
- **Single instance:** `tauri-plugin-single-instance`. The second launch
  forwards its resolved paths as an `open` event and exits. (Opening them as
  tabs is S02.)
- **Renderer crash recovery:** port `install_crash_recovery` (WebView2
  `ProcessFailed` → `Reload` when the renderer exited or became
  unresponsive). Log every occurrence.
- **Window:** created hidden, shown by `app_ready`, with a fallback that
  shows it after 2 s anyway (logged as a warning). This avoids a white flash
  and an empty frame.
- **Test-only commands:** when `MDTIGER_TEST=1` is set, register
  `test_panic` (panics on a worker thread) so the panic hook can be tested.
  Without the variable the command doesn't exist.

### 3.4 Front end core

- `src/host/host.ts`: port the spike interface, minus WPF. Add
  `settingsRead`, `settingsWrite`, `ready`. Keep `resolvePath`.
  Implementations: `tauri.ts`, and `browser.ts` for `npm run dev` (files from
  `tests/fixtures/` via Vite's dev server, saving kept in memory, settings in
  `localStorage`).
- `src/core/log.ts`: `log.info/warn/error` → `host.log`. Installs
  `window.onerror` and `unhandledrejection` handlers that log and never
  rethrow to a dialog.
- `src/core/commands.ts`: a registry.
  `register({ id, label, shortcut?, run, enabled? })`, `run(id)`,
  `list()`, and a single `keydown` dispatcher that maps shortcuts (`Mod-o`
  style, as in CodeMirror) to commands. Commands that CodeMirror itself
  handles while the editor has focus are registered later with care (S03).
  Register `app.about` (shows version in the status bar for now) as a sample.
  Shortcut matching follows the keyboard-layout rule in IMPLEMENTATION_PLAN
  §3: letters by `key`, digits and punctuation by physical `code`, and
  Ctrl+Alt combinations are never registered.
- `src/core/settings.ts`: typed defaults, `load()` (merge file over
  defaults, ignore unknown keys but keep them when saving), `get`, `set`
  (debounced save, 300 ms), `onChange(key, handler)`. Initial keys:
  `theme` (`"system"`), `outline.visible` (`true`), `outline.width` (260).
  Later steps add their own keys and document them in their notes.
- `src/main.ts`: bootstrap only: pick host, load settings, build layout,
  call `host.ready`.

### 3.5 Startup budget

- `ready` is sent after the first paint (`requestAnimationFrame` twice).
- Port `spike/measure-startup.ps1` to `tools/measure-startup.ps1` (Tauri only,
  default exe `src-tauri/target/release/mdtiger.exe`, reads `ready` lines from
  the new log location).
- Budget for this step: warm median ≤ 400 ms with no document. Later steps
  must not raise it by more than they need; S10 measures with documents.

### 3.6 Layout skeleton (`src/ui/layout.ts`, `src/styles/base.css`)

Regions, top to bottom: **toolbar** (empty container, S04/S07/S08 fill it),
**tab strip**, then a row with the **outline sidebar** (left, resizable
later) and the **content** area, then a **status bar**. A **banner** slot
sits above the content (S02/S10 use it). With no document open, the content
shows an empty state: the tiger logo, "Open a Markdown file" and the
shortcut hint `Ctrl+O` (the command arrives in S02; show the hint anyway).

Use CSS custom properties for all colors from the start (a single light set
for now; S08 adds dark and the theme switch).

### 3.7 Test harness

- **Vitest** with happy-dom; a first test for `commands.ts` and
  `settings.ts` (merge, unknown keys kept, debounce).
- **`tests/e2e/lib/`**, ported and generalised from
  `spike/tests/shell-checks.mjs`:
  - `launchApp({ files, env })`: picks a free port, creates a fresh
    `tests/e2e/.tmp/<run>/profile` folder, sets `MDTIGER_PROFILE_DIR`,
    `MDTIGER_TEST=1` and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`,
    starts the release exe, connects over CDP, and returns an `app` object.
  - `app.eval(expr)`, `app.waitFor(expr, timeout)`, `app.key(combo)`
    (real `Input.dispatchKeyEvent`), `app.click(selector)`, `app.type(text)`,
    `app.clipboard()` (all formats, as in the spike), `app.log()` (reads the
    profile's log file), `app.close()` (kills the process tree).
  - `fixture(name)`: copies a file from `tests/fixtures/` into the run's temp
    folder and returns its path.
- `tests/fixtures/`: start with `plain.md` (LF), `crlf-bom.md` (CRLF +
  BOM, created byte-exact; check with `git ls-files --eol`), and copies of
  `spike/samples/showcase.md`, `tables.md` and `images/tiger.svg`. Port
  `spike/samples/make-big.mjs` to `tools/make-big.mjs`, writing the 2 MB
  `tests/fixtures/big.md` (gitignored).

## 4. Tests

### 4.1 Unit

- `commands.test.ts`: register, run, `enabled` false blocks `run`,
  shortcut matching (`Mod-o` = Ctrl+O on Windows), unknown id logs a warning.
- `settings.test.ts`: defaults when the file is missing; file values override
  defaults; unknown keys survive a save; several `set` calls in 300 ms cause
  one write; `onChange` fires.
- `cargo test`: `write_file` is atomic and keeps the BOM flag; `read_file` of
  a BOM file returns `bom: true` and text without the BOM; settings read of a
  broken file returns `None` and renames it to `.bad`.

### 4.2 End to end (`tests/e2e/s01-foundation.test.mjs`)

1. App starts, window becomes visible, the empty state is shown, the log has
   a `ready` line.
2. The profile folder from `MDTIGER_PROFILE_DIR` contains the log; the real
   `%APPDATA%\MdTiger` is untouched by the test run (check its mtime if it
   exists).
3. `throw new Error("e2e-boom")` evaluated in the page → the log contains
   `e2e-boom`; the page keeps working.
4. `test_panic` → the log contains the panic message; the app keeps running.
5. Settings round trip: `settings.set("theme","dark")` → after 500 ms the
   file contains it → restart the app with the same profile → `get` returns
   `"dark"`.
6. Renderer crash: kill the WebView2 renderer processes (as
   `spike/tests/renderer-kill.mjs` does) → the page answers again within 3 s,
   and the log has a recovery line.
7. Second instance: launch the exe again with a path → the first instance
   logs the forwarded `open` event; the second process exits within 2 s.

### 4.3 Manual (at verification)

- The exe, window and taskbar show the tiger icon at normal and small sizes.
- `tools/measure-startup.ps1 -Runs 10` reports a warm median ≤ 400 ms.
- No white flash when the window appears.

## 5. Done when

`npm run check` passes, the manual checks are done, and the open issues are
listed below.

## 6. Implementation notes

<!-- Written by the implementing session: lessons learned, surprises,
workarounds, new settings keys, dependencies added. -->

## 7. Open issues

<!-- Anything undecided or deferred. Decided at verification, or moved to
IMPLEMENTATION_PLAN §7. Format: | ID | Issue | Proposal | -->

| ID | Issue | Proposal |
|---|---|---|
| | | |
