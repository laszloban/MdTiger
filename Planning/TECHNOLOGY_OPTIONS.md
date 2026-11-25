# MdTiger – Technology Options

| | |
|---|---|
| **Status** | Decided: Tauri 2 (2026-11-25) |
| **Date** | 2026-11-25 |
| **Input** | [FUNCTIONAL_REQUIREMENTS.md](FUNCTIONAL_REQUIREMENTS.md), Draft 0.4 |
| **Output** | A shortlist and a spike plan (§6). The final choice comes after the spike. |

## 1. What drives the choice

Most requirements (tabs, find/replace, settings, …) can be met with any
stack. These are the ones that separate the options:

| # | Driver | Requirements |
|---|---|---|
| D1 | **Startup:** ≤ 1 s warm, ≤ 2 s cold | NFR-01 |
| D2 | **Room for live preview:** an editor that can draw rendered content inline over the source text, keeping the source as the master copy | NFR-09, FR-EDIT-04 |
| D3 | **Mermaid:** Mermaid is a JavaScript library. Every stack needs a JS engine and a browser-style layout engine to render it | FR-MERMAID-01..04 |
| D4 | **Continuous selection across blocks:** a selection that runs from normal text into a code block, plus a hover copy button and plain-text-only copying | FR-CODE-02/03/08 |
| D5 | **Source fidelity:** byte-exact round trips, with edits limited to what changed | FR-FILE-03, FR-EDIT-10 |
| D6 | **Styling:** visually distinct headings, several built-in styles, custom styles that can be shared | FR-STYLE-02..04 |
| D7 | **Windows integration:** being the default `.md` app, single instance, watching files for outside changes, per-user/portable install | FR-APP-05, FR-FILE-04/10, NFR-04/05 |
| D8 | **Cross-platform:** nice to have, only if cheap | NFR-07 |
| D9 | **Team fit:** the team's main stack is C#/.NET (WPF, Blazor/MudBlazor) | — |

**Key observation:** D3 alone means MdTiger will embed a web engine whatever we
choose, because Mermaid can't be rendered without one. Once a web engine is
in the app anyway, it also handles D4 (selection across blocks is built into
the browser), D6 (CSS) and remote images (FR-LINK-05). A fully native renderer
would have to rebuild all of that and still embed a WebView for Mermaid.
In practice, the question is **which shell hosts a web-based editor**, not
whether to use one.

## 2. Candidates

| ID | Stack | Shell / host language | Editor and renderer |
|---|---|---|---|
| **A** | **Tauri 2** + system WebView (WebView2 on Windows) | Rust (a thin layer) | TypeScript: CodeMirror 6 + Markdown renderer + Mermaid |
| **B** | **WPF + WebView2** | C# / .NET | Same TypeScript front end as A |
| **C** | **Electron** | Node.js / TypeScript | Same TypeScript front end as A (Zettlr's and Obsidian's stack) |
| **D** | **Avalonia (native)** + AvaloniaEdit + Markdig, with a WebView only for Mermaid | C# / .NET | Native controls, custom Markdown rendering |
| **E** | **WPF (native)** + AvalonEdit + Markdig, with WebView2 only for Mermaid | C# / .NET | Native controls, custom Markdown rendering |

Considered and rejected without a full evaluation:

- **Blazor Hybrid / MAUI:** this would still be a web UI in a WebView, but with
  MAUI's heavier startup. It has B's benefits without being better than B, and
  CodeMirror 6 would still be TypeScript.
- **Qt:** a new language and toolchain for the team, and it still needs a web
  engine for Mermaid.
- **Forking Zettlr or using MarkText:** the reasons for leaving Zettlr are in
  FR §1. MarkText is no longer actively maintained.
- **VS Code plus extensions:** not a dedicated viewer, it starts as slowly as
  Electron apps do, and we can't control its look.

### Why CodeMirror 6 for options A, B and C

- It is the editor behind Zettlr, Obsidian and several other live-preview
  Markdown editors. Its *decorations and widgets* API is designed for drawing
  rendered content over source text while the document itself stays plain
  text. That is NFR-09 (a) and (c) exactly, so phase 2 is a proven path, not
  research.
- It includes an incremental Markdown parser (Lezer, with GFM extensions) that
  tracks source positions. That parser can drive the outline, folding,
  checkbox toggling and the mapping back from rendered elements (NFR-09 b).
- It has built-in search/replace, folding, multiple cursors and language
  highlighting for code fences.

Zettlr's problems (slow startup, no selection in code blocks) come from how
Zettlr itself is built, not from CodeMirror. The Rendered view is an ordinary
HTML document, so selecting text inside code blocks just works there.

## 3. Comparison

Ratings: ++ very good, + good, o acceptable, – weak, –– blocker or high risk.

| Driver | A Tauri 2 | B WPF + WebView2 | C Electron | D Avalonia native | E WPF native |
|---|---|---|---|---|---|
| D1 Startup | **++** small native shell. WebView2 is part of Windows and shared with other apps | **+** .NET start plus WebView2 start. Needs ReadyToRun/trimming and must be measured | **–** bundles its own Chromium (~150 MB+). Zettlr shows the risk | **+** native, but the Mermaid WebView loads on demand | **+** like D |
| D2 Live preview | **++** CodeMirror 6 | **++** CodeMirror 6 | **++** CodeMirror 6 | **–** AvaloniaEdit can show inline elements, but a polished live preview means building it ourselves | **–** like D |
| D3 Mermaid | **++** native in the WebView | **++** | **++** | **–** needs a second rendering path (WebView or offline SVG) and its layout clashes with native controls | **–** like D |
| D4 Selection / copy | **++** standard browser selection, CSS hover button, clipboard handler sets plain text only | **++** | **++** | **––** selection across separately rendered blocks is hard, the same kind of gap we have with Zettlr today | **––** like D |
| D5 Source fidelity | **++** CodeMirror edits the source text directly | **++** | **++** | **+** AvalonEdit/AvaloniaEdit also edit text | **+** |
| D6 Styling | **++** CSS. Custom styles are CSS files (answers FR Q7) | **++** | **++** | **o** XAML styles. A simple theme file is possible, but less flexible | **o** |
| D7 Windows integration | **+** plugins for single instance, file watching, dialogs and file associations; a little Rust for the default-app check | **++** all directly in C#, which we know well | **+** Node APIs, plus native modules where needed | **+** C# | **++** C# |
| D8 Cross-platform | **++** included (WebView2 / WKWebView / WebKitGTK), with small rendering differences to test | **––** WPF is Windows-only. Porting means changing the shell, though the front end can be reused | **++** included | **+** Avalonia is cross-platform, but a WebView for Mermaid on Linux/macOS adds work | **––** Windows only |
| D9 Team fit | **o** TypeScript front end is new territory; Rust only for a thin layer | **+** C# shell; TypeScript front end is new territory | **o** TypeScript and Node only | **++** C# only | **++** C# only |
| Size / memory | **++** a few MB installer | **+** .NET runtime (or self-contained), WebView2 shared | **––** largest | **+** | **+** |
| **Overall** | **Recommended** | **Strong alternative** | Fallback | Rejected | Rejected |

### Why the native options (D, E) are out

They do well on team fit, but they lose on D2, D3 and D4. Those three
requirements are the main reasons for building MdTiger at all (live preview
later, Mermaid, code-block selection and copy). A native renderer would need
custom-built selection across blocks and a second rendering path for Mermaid.
Phase 2 would mean building our own live-preview engine. That makes MdTiger much
bigger and moves it toward the same kind of rough edges we're leaving Zettlr
over.

### Error dialogs after waking from hibernation

Zettlr shows connection-error dialogs after the laptop resumes. The likely
mechanism has two parts:

1. **The app** makes background network calls that fail while the network
   is still coming back after resume. For Zettlr, the update check is the
   prime suspect.
2. **Electron's default behavior** turns an uncaught exception in the main
   process into a modal "A JavaScript error occurred in the main process"
   dialog.

So it's a combination: application code plus an Electron default that
surfaces the failure. We haven't confirmed the exact cause for Zettlr; the
text of the dialog would tell.

**Tauri 2** has no equivalent default. Errors in the Rust shell are returned
as values and logged, and nothing pops up unless the app shows a dialog
itself. A failed `fetch` or image load in the WebView is just a rejected
promise or a broken image, never a system dialog. **WPF (B)** sits in
between: .NET only shows its unhandled-exception crash box if the app has no
global handler, so with one in place it behaves like Tauri.

The risk that remains in every stack: the WebView2 process (or a network
call) can fail around resume. We cover that with requirements, not with the
stack choice: NFR-10/11 (no modal dialogs, retry, re-check files on resume,
restart a lost web engine) and spike check S9. MdTiger also makes almost no
network calls (only remote images, no update check in phase 1), so there's
very little that could fail in the first place.

### Why Electron (C) is only a fallback

Functionally it matches A and B, but it carries the startup and size risk
that NFR-01 explicitly targets. Keep it only in case WebView2 turns out to
have a blocking limitation.

## 4. A vs. B: the real decision

A and B share **the same TypeScript front end**: CodeMirror 6, the Markdown
renderer, Mermaid, the outline, tabs and find/replace. That is roughly 80–90%
of the code. The difference is only the thin shell around it: window, file
I/O, file watching, single instance, file association and default-app check,
and settings storage.

| | A Tauri 2 | B WPF + WebView2 |
|---|---|---|
| Shell language | Rust: small and mostly plugin configuration, but new to the team | C#: well known |
| Cross-platform later | Included | Would need a different shell (e.g. Tauri, or Avalonia with a WebView) |
| Startup risk | Low | Medium: needs measuring |
| Packaging | MSI / NSIS from the Tauri bundler, per-user install possible | MSIX/MSI, self-contained or framework-dependent .NET |
| Debugging | WebView2 DevTools plus the Rust toolchain | WebView2 DevTools plus Visual Studio |

**Recommendation:** design the front end so it **doesn't depend on its
shell**. It talks to the shell only through a small, typed interface:
open/save/watch file, settings, clipboard, the default-app check. Then
choose **A (Tauri 2)** if the spike confirms the startup targets and the team
is fine with a thin Rust layer, because cross-platform support (NFR-07) then
comes for free. Otherwise use **B**. Thanks to that interface, switching
shells later stays a bounded piece of work, not a rewrite.

## 5. Front-end building blocks (for A or B)

These are candidates to confirm in the spike, not commitments.

| Concern | Candidate | Notes |
|---|---|---|
| Source editor | CodeMirror 6 (`@codemirror/*`) | Search/replace, folding and history are built in |
| Markdown parser | Lezer markdown + GFM extensions (already part of CodeMirror) | The single parser NFR-09 (b) asks for, see the open point below |
| Rendered view | HTML built from the parsed document, with source line ranges kept on each block | Needed for synchronized scrolling, clicking checkboxes and jumping from the outline |
| Code highlighting | Lezer language packages, or a highlighter such as Shiki/Prism for the rendered view | Check FR-CODE-01's language list and the effect on startup |
| Mermaid | `mermaid` (loaded lazily, only when a document has a diagram) | Keeps its cost out of startup (D1) |
| HTML sanitizing | DOMPurify | NFR-06 / FR-MD-05 |
| UI around the editor | Plain TypeScript, or a light framework (e.g. Svelte, Lit) | Keep it small for startup. No heavy SPA framework is needed |

**Open design point for the spike:** NFR-09 (b) asks for *one* parser. One
way is to render the read view from the Lezer tree as well, which means one
parser and exact positions but our own HTML renderer. The other is a
mainstream renderer (e.g. markdown-it, which keeps line maps) for the read
view, with Lezer used only in the editor. That has a mature renderer but two
parsers that could disagree on edge cases. The spike should try the Lezer-only
approach first and fall back only if it costs too much.

## 6. Spike plan

The goal is to prove the risky parts with throwaway code before committing.
Build **one** TypeScript front end and run it in **two** thin shells (A and B).

| # | Check | Pass criterion |
|---|---|---|
| S1 | Cold and warm startup with a 100 KB document, on a standard office laptop, for each shell | NFR-01: ≤ 2 s cold, ≤ 1 s warm, until the window is usable |
| S2 | Rendered view: select from a paragraph into a code block; hover copy button; plain-text-only clipboard (check by pasting into Outlook and Word) | FR-CODE-02/03/08 |
| S3 | Outline: foldable tree with no numbering, click to jump, highlight follows scrolling | FR-NAV-01..06 |
| S4 | A Mermaid diagram that loads lazily, plus one with an error | FR-MERMAID-01/02, no effect on S1 |
| S5 | Clicking a task checkbox changes exactly one character; unchanged files save byte-identical (compare hashes) | FR-EDIT-10, FR-FILE-03 |
| S6 | **Live-preview groundwork:** in the source editor, show one heading styled and one image inline using CodeMirror decorations, with the raw text appearing when the cursor enters that line | NFR-09 (a)–(c) |
| S7 | Shell integration: single instance (a second launch opens a tab in the first window), file watcher reload, default-app check plus the Windows settings dialog | FR-FILE-04/10, FR-APP-05 |
| S8 | A 2 MB document: scrolling and typing | NFR-02 |
| S9 | Open several tabs (one with a remote image and one with unsaved edits). Hibernate the laptop, then resume, with the network still offline at first. Separately, kill the WebView2 process while the app is running | NFR-10/11: no dialogs; the image reloads once the network is back; files changed during sleep are detected; edits survive the web engine restart |

**Decision after the spike:** A or B, based on S1 and S7 plus the team's view
on the Rust layer. Also settle the parser approach (§5) and the CSS style
format (FR Q7, expected to be CSS).

**Spike done (2026-11-25):** see [spike/RESULTS.md](../spike/RESULTS.md).
Both shells pass all automated checks. Tauri starts in 0.44 s vs. 0.84 s for
WPF, and the Lezer-only parser approach works. Both recovered from a real
hibernate and resume.

**Decision (2026-11-25): A, Tauri 2.** Implementation follows
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
