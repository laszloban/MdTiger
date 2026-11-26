# MdTiger – Implementation Plan

| | |
|---|---|
| **Status** | v1.0 – S03 verified |
| **Date** | 2026-11-25 |
| **What to build** | [FUNCTIONAL_REQUIREMENTS.md](FUNCTIONAL_REQUIREMENTS.md) (Draft 0.5) |
| **Technology** | Tauri 2 + one TypeScript front end, decided after the [spike](../spike/RESULTS.md) |
| **Scope** | Phase 1: every **M** and **S** requirement. **C** items and live preview (phase 2) are out, but NFR-09 keeps live preview possible. |

## 1. Status

Each step is one document in [steps/](steps/) and is sized for one
implementation session. Steps run in order: each depends on the one before. A step is **Verified** only after the user has
checked it; then it is committed and pushed.

| Step | Title | Status | Commit | Open issues raised |
|---|---|---|---|---|
| [S01](steps/S01-foundation.md) | Foundation: project, shell, test harness | Verified | a511c3a | 5 (S01-1 to S01-5), all decided |
| [S02](steps/S02-files-and-tabs.md) | Files and tabs | Verified | 97ea27f | 8 (S02-01 to S02-08), all decided |
| [S03](steps/S03-source-editor.md) | Source editor, find and replace | Verified | | 4 (S03-01, -02, -04, -05; S03-03 resolved), all decided |
| [S04](steps/S04-rendered-view-and-modes.md) | Rendered view and modes | Not started | | |
| [S05](steps/S05-rich-content.md) | Rich content: code blocks, Mermaid, images, links, checkboxes | Not started | | |
| [S06](steps/S06-outline.md) | Outline sidebar and heading folding | Not started | | |
| [S07](steps/S07-formatting-toolbar.md) | Formatting toolbar and table tools | Not started | | |
| [S08](steps/S08-themes-and-styles.md) | Themes (light, dark, follow system) and styles | Not started | | |
| [S09](steps/S09-settings-palette-integration.md) | Settings, command palette, window and default app | Not started | | |
| [S10](steps/S10-resilience-and-performance.md) | External changes, resilience, performance | Not started | | |
| [S11](steps/S11-rendered-find-history-print.md) | Find in Rendered view, link history, print | Not started | | |
| [S12](steps/S12-packaging-and-release.md) | Packaging and release | Not started | | |

Status values: *Not started* → *In progress* → *Done, awaiting verification*
→ *Verified*. Only the user sets *Verified*.

## 2. Session protocol (read first in every implementation session)

1. **Read** this file (§2–§6 in full), your step document, and the
   requirements it lists in [FUNCTIONAL_REQUIREMENTS.md](FUNCTIONAL_REQUIREMENTS.md).
   Earlier step documents are worth skimming for their *Implementation notes*.
2. **Do only your step.** If you find a defect from an earlier step, fix it
   and say so in your implementation notes.
3. **Don't change requirements or decisions.** If something looks wrong or
   impossible, add it to your step's *Open issues* and choose the most
   conservative option, or stop and ask if it blocks the step.
4. **Set the status** in §1 to *In progress* when you start.
5. **Before finishing:**
   - run every test listed in your step document (unit, end-to-end and the
     earlier steps' end-to-end suites) and report the results honestly,
     including failures;
   - fill in the *Implementation notes* section of your step document with
     lessons a later session needs (surprises, workarounds, things that
     didn't work and why);
   - list anything undecided or deferred under *Open issues*;
   - set the status in §1 to *Done, awaiting verification* and fill in the
     *Open issues raised* column (count or IDs).
6. **Do not commit or push.** The user verifies the step first. After
   verification, the open issues are either decided in the step document or
   moved to §7 of this file, and then the step is committed and pushed
   (message `S<nn>: <title>`).

## 3. Global conventions

| Topic | Rule |
|---|---|
| Layout | Standard Tauri 2 layout at the repo root (§4). `spike/` is frozen reference code: read it, port from it, never change it. |
| Front end | TypeScript (strict), Vite, **no UI framework** (plain DOM, small helper functions). The spike showed this keeps startup at ~150 ms for the front end's own share. |
| Editor and parser | CodeMirror 6 with `@codemirror/lang-markdown` (GFM). **One parser:** the rendered view is built from the same Lezer tree as the editor (`markdownLanguage.parser`), never from a second Markdown library. Every rendered block carries `data-from`/`data-to` source offsets. |
| Source of truth | The editor's document text. All edits (toolbar, checkbox, replace, table tools) are CodeMirror transactions on the source, never DOM edits converted back (NFR-09 c, FR-FILE-03). |
| Shell | Rust, Tauri 2. Everything platform-specific goes through the `Host` interface (`src/host/host.ts`). Windows-only code is behind `#[cfg(windows)]`. |
| Icons | App icon from `assets/icon/Tiger.svg` / `Tiger.png`. UI icons from **Lucide** (ISC licence), imported per icon so only used ones are bundled. |
| Colors | All colors are CSS custom properties on `:root`, with a light and a dark set (S08). The accent color is the tiger orange from the icon (about `#D9731F`; S08 fixes the exact values). No hard-coded colors in components. |
| Errors | No modal error dialogs, ever (NFR-11). Errors are logged via `host.log` to `%LOCALAPPDATA%\MdTiger\logs\` and, at most, shown as a non-blocking status hint. Modal dialogs only when the user must decide. |
| Network | None except remote images in documents (NFR-03). No telemetry, no update checks. |
| Text | UI in English (NFR-08). Sentence case in labels. |
| Keyboard layout | The main user types on a **Hungarian** layout. **No Ctrl+Alt shortcuts** (Ctrl+Alt is AltGr, which types `[ ] { } \ \| @ # & ~` and accents). Digits and punctuation in shortcuts are matched by **physical key** (`KeyboardEvent.code`), because Shift+digit gives other characters on this layout. Avoid keys that aren't plain keys there (`` ` ``, `[`, `]`, `\`). Tests send key events with explicit `code` values. |
| Line endings | `.gitattributes` keeps source files as LF and marks `tests/fixtures/**` as `-text`, so CRLF and BOM fixtures stay byte-exact (this machine has `core.autocrlf=true`). |
| Dependencies | Latest stable versions at S01, pinned in the lockfiles. Add a dependency only when a step needs it, and name it in the implementation notes. |

## 4. Repository layout (created in S01)

```
MdTiger/
├─ .gitattributes  .gitignore  README.md  LICENSE
├─ assets/icon/            Tiger.svg, Tiger.png (source of all app icons)
├─ Planning/               requirements, options, this plan, steps/
├─ spike/                  frozen spike (reference only)
├─ package.json  vite.config.ts  tsconfig.json  index.html
├─ src/                    front end
│  ├─ main.ts              bootstrap only
│  ├─ host/                Host interface + tauri.ts + browser.ts (dev)
│  ├─ core/                commands, settings, events, logging, doc model
│  ├─ editor/              CodeMirror setup, keymaps, find/replace, formatting
│  ├─ render/              Lezer → DOM renderer, code, Mermaid, images
│  ├─ outline/             outline sidebar
│  ├─ ui/                  app layout, toolbar, tabs, banner, dialogs, palette
│  └─ styles/              CSS: base, themes, rendering styles
├─ src-tauri/              Rust shell
└─ tests/
   ├─ e2e/                 end-to-end suites driving the real app (node:test)
   └─ fixtures/            test documents (byte-exact)
```

Unit tests sit next to the code as `*.test.ts` (Vitest).

## 5. Architecture overview

```
 ┌──────────────── Tauri window (WebView2) ────────────────┐
 │ ui/ toolbar · tabs · banner · status bar · palette      │
 │      │ commands (core/commands.ts)                       │
 │ ┌────┴─────┐   ┌───────────┐   ┌──────────┐             │
 │ │ editor/  │──▶│  Lezer    │──▶│ render/  │  outline/   │
 │ │ CM6 view │   │  tree     │   │ DOM +    │◀─ headings  │
 │ └────┬─────┘   └───────────┘   │ offsets  │             │
 │      │ doc model (core/doc.ts) └──────────┘             │
 │      │ settings (core/settings.ts)                      │
 │ ─────┴──────── Host interface (host/host.ts) ─────────── │
 └──────────────────────────┬───────────────────────────────┘
                            │ invoke / events
 ┌──────────────────────────┴───────────────────────────────┐
 │ src-tauri: file I/O · watcher · single instance · logging │
 │ crash recovery (WebView2 ProcessFailed) · default app     │
 └───────────────────────────────────────────────────────────┘
```

- **Commands** (`core/commands.ts`, S01): every user action is a named
  command with an id, a label, an optional default shortcut and an `enabled`
  check. Toolbar buttons, menus, shortcuts and the command palette (S09) all
  run commands. Settings can override shortcuts (S09).
- **Doc model** (`core/doc.ts`, S02): one object per tab holding path, BOM
  flag, line separator, saved text, mtime, mode, scroll position and fold
  state, plus its CodeMirror `EditorState`.
- **Renderer** (`render/`, S04): renders top-level blocks with source
  offsets. Re-renders only the blocks an edit touched (incremental), so big
  documents stay responsive in Split mode.
- **Settings** (`core/settings.ts`, S01 store, S09 UI): one JSON file at
  `%APPDATA%\MdTiger\settings.json`, read and written by the shell, with
  defaults in code and change events.

## 6. Testing strategy

| Level | Tool | What | Run with |
|---|---|---|---|
| Unit (front end) | Vitest + happy-dom | Pure logic: renderer output and offsets, formatting commands on `EditorState`, outline tree, settings merge, table standardizing | `npm test` |
| Unit (shell) | `cargo test` | File I/O (BOM, atomic write), path handling, settings file | `cargo test` in `src-tauri/` |
| End to end | `node --test tests/e2e/` | Drives the real release exe through the WebView2 debugging port (CDP), as `spike/tests/shell-checks.mjs` did. One file per step: `tests/e2e/s<nn>-*.test.mjs` | `npm run e2e` |
| Manual | Checklist in each step | Things CDP can't check: real OS dialogs, paste into Word, hibernate, Explorer double-click | by the user at verification |

- Every step adds its tests and **keeps all earlier suites green**.
- End-to-end tests use only fixtures from `tests/fixtures/` and temp copies
  of them; they never touch files outside a temp folder.
- `npm run check` runs typecheck, unit tests, `cargo test`, the release
  build and all end-to-end suites. A step is done only when it passes.

## 7. Open issues (plan level)

Decided or deferred items from the steps land here after each verification.

| ID | Issue | Raised | Status |
|---|---|---|---|
| OI-01 | Licence for the public repo. | plan | **Decided:** MIT (S01). Copyright holder in `LICENSE`: "MdTiger contributors". |
| OI-02 | Formatting toolbar in Rendered mode. | plan | **Decided:** disabled there, with a tooltip saying to switch to Source or Split (S07). |
| OI-03 | Code signing for the installer and exe. | plan | **Decided:** ship unsigned (SmartScreen warns until the download builds reputation); apply to the SignPath Foundation open-source programme after a few releases and add signing to the S12 release workflow then. |
| OI-04 | Distribution channel (NFR-05). | plan | **Decided:** GitHub Releases and winget (S12). |
| OI-05 | CI. | plan | **Decided:** GitHub Actions on `windows-latest`, running `npm run check` without the end-to-end suites (S01 sets it up; S12 adds the release build). |
| OI-06 | Files with invalid UTF-8 bytes (the shell reads them lossily, bytes become U+FFFD). | S01-4 | **Decided:** when such a document is saved, show a notification that the invalid bytes were replaced (S02). |
| OI-07 | End-to-end tests need every real MdTiger closed (single instance). | S01-5 | **Decided:** accepted; the helper says "close MdTiger first". |

## 8. Requirement coverage

| Requirement | Step |
|---|---|
| FR-FILE-01 (open), -02, -03, -05, -06, -10 | S02 (file association: S12) |
| FR-FILE-04 external changes | S10 |
| FR-FILE-07 recent files | S09 |
| FR-MD-01 … -05 | S04 |
| FR-EDIT-01, -03, -05 (modes, active button) | S04 |
| FR-EDIT-02, -06, -08 | S03 |
| FR-EDIT-07, -11 | S07 |
| FR-EDIT-10 checkboxes | S05 |
| FR-NAV-01 … -10 | S06 |
| FR-CODE-01 … -05, -08 | S05 |
| FR-MERMAID-01 … -03 | S05 |
| FR-MERMAID-04 diagram theme | S08 |
| FR-TABLE-01 | S04 |
| FR-TABLE-02, -03 | S07 |
| FR-LINK-01, -02, -05 | S05 |
| FR-LINK-03 history | S11 |
| FR-STYLE-01 … -05 | S08 |
| FR-SEARCH-01, -03 in Source/Split | S03 |
| FR-SEARCH-01, -03 in Rendered | S11 |
| FR-EXPORT-01 print / PDF | S11 |
| FR-APP-01, -03, -04 | S09 |
| FR-APP-02 settings | S01 (store), S09 (UI) |
| FR-APP-05 default app | S09 (prompt), S12 (registration) |
| FR-APP-06 icon | S01 (window), S12 (installer, association) |
| NFR-01 startup | S01 (budget), S10 (measured), S12 (cold start) |
| NFR-02 big documents | S04 (incremental render), S10 (measured) |
| NFR-03, -08 | all steps |
| NFR-04, -05 | S12 |
| NFR-06 safe rendering | S04 |
| NFR-09 room for live preview | S03, S04 |
| New: active mode button stays activated (FR-EDIT-05) | S04 |
| New: Light / Dark / Follow system (FR-STYLE-01) | S08 |
| New: formatting toolbar, now Must (FR-EDIT-07) | S07 |
| NFR-10 sleep, resume, crash | S01 (crash recovery), S10 |
| NFR-11 no error pop-ups | S01 |
| Later (C / phase 2) | FR-FILE-09, FR-MD-06, -07, FR-EDIT-04, -09, FR-CODE-06, -07, FR-MERMAID-05, FR-TABLE-04, FR-LINK-04, FR-SEARCH-02, FR-EXPORT-02, -03, NFR-07 |
