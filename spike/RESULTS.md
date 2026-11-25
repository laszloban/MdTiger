# MdTiger spike – results

| | |
|---|---|
| **Date** | 2026-11-25 |
| **Plan** | [TECHNOLOGY_OPTIONS.md §6](../Planning/TECHNOLOGY_OPTIONS.md) (checks S1–S9) |
| **Built** | One TypeScript front end (CodeMirror 6 + Lezer + Mermaid), running in two thin shells: **A: Tauri 2** and **B: WPF + WebView2** (.NET 10) |
| **Machine** | Windows 11 Pro, the developer laptop the spike was built on; WebView2 runtime 158 |

## 1. Summary

- **Both shells pass all 28 automated checks.** The front end is identical in
  both, so features and behavior inside the window don't decide between A and B.
- **Startup is the clear difference:** Tauri is ready in **0.44 s**, WPF in
  **0.84 s**, both median warm values for a typical document. Both meet NFR-01
  (≤ 1 s warm), but only Tauri has a comfortable margin.
- **One real Tauri gap was found and closed:** out of the box, Tauri doesn't
  recover when the WebView2 renderer process dies (the window stays dead until
  a manual refresh). About 30 lines of Rust hooking WebView2's `ProcessFailed`
  event fixed it. WPF needed the same handler, written in C#.
- **The single-parser approach works** (§5 open point in the options
  document): the read view is rendered from the same Lezer tree as the editor,
  with exact source offsets on every block. Outline jumps, checkbox toggling,
  scroll sync and the live-preview groundwork all rely on those offsets, and
  all work.
- **Recommendation: A (Tauri 2).** It starts twice as fast, ships as one
  ~11 MB exe with no runtime to install (WebView2 is part of Windows 11), and
  makes cross-platform support possible later. The Rust layer stayed small
  (~280 lines, mostly plugin glue) and was the least troublesome part of the
  spike. **Decided (2026-11-25): A, Tauri 2.** See §5 for the trade-offs.

## 2. Startup (S1)

Measured with `measure-startup.ps1`. *ProcessMs* runs from process start
(WPF) or `main()` (Tauri) until the first document is painted, and is measured
inside the app. Warm values are the median of 9 runs.

| Document | Tauri 2 | WPF + WebView2 (ReadyToRun) |
|---|---|---|
| `showcase.md` (5 KB, Mermaid, code, tables) | **444 ms** (min 428, max 485) | **835 ms** (min 820, max 860) |
| `big.md` (2 MB, 94 000 lines) | 2.4 s | 2.8 s |
| Front end's own share (navigation → painted) | ~150 ms | ~180 ms |

- **WPF:** a plain build was ~1.05 s; ReadyToRun publishing brought it to
  0.84 s. The rest is .NET + WPF + WebView2 environment start.
- **Cold start** (first launch after a reboot) was **not measured**. Run
  `measure-startup.ps1` right after a reboot to get it.
- **Big documents:** 2 MB takes 2.4–2.8 s to open, which is acceptable for
  NFR-02 (which asks for smooth scrolling, not a startup time). Making this
  faster needs incremental or viewport-only rendering (§4).

## 3. Check results (S2–S9)

Run with `node tests/shell-checks.mjs tauri|wpf`. It drives the real shell
through the WebView2 debugging port. The results are identical for both
shells unless noted.

| Check | Result |
|---|---|
| **S2** Selection inside a code block → clipboard has plain text only (no HTML/RTF formats) | ✅ |
| **S2** Copied code keeps line breaks and indentation | ✅ |
| **S2** Selection from a paragraph into a code block | ✅ |
| **S2** Copy button: raw code without fences, plain text only, "Copied" confirmation, hidden until hover | ✅ |
| **S3** Outline shows headings exactly as written (no numbering added); collapse/expand all; click jumps and highlights | ✅ |
| **S4** Mermaid diagrams render lazily; a broken diagram shows its error and the rest still renders | ✅ |
| **S5** Saving without edits is byte-identical, for LF and for CRLF + BOM | ✅ |
| **S5** Ticking a checkbox changes exactly one byte; unticking restores the original bytes | ✅ |
| **S6** Live-preview groundwork: in the source editor, headings lose their `#` and images show inline, with raw Markdown on the cursor line | ✅ (checked by eye in the browser pane, see the screenshot in the session) |
| **S7** Second launch opens its file as a tab in the first window | ✅ |
| **S7** File changed on disk: reloads silently without local edits, shows a non-blocking banner with them | ✅ |
| **S7** Default-app check reads the current `.md` handler and offers *Make default…* | ✅ banner shown; that the button opens Windows Settings is **manual** |
| **S8** 2 MB document: typing latency | ✅ p90 32–40 ms (target < 50 ms) |
| **S8** 2 MB document: scrolling at wheel speed | ✅ median frame 19–20 ms |
| **S9** Renderer process killed → page comes back by itself, all tabs reopened, unsaved edits restored | ✅ (Tauri only after adding the `ProcessFailed` hook) |
| **NFR-11** No crash dialogs; errors go to `%LOCALAPPDATA%\MdTiger\spike-*.log` | ✅ |
| Local image (relative path) and remote image | ✅ |

**Checked manually (2026-11-25):** a real hibernate and resume (S9): both shells
recovered without any problem.

**Still to check manually:**
- Paste into Word and Outlook (S2). The clipboard formats are verified, but not the paste itself.
- That *Make default…* opens Windows' Default apps page (S7).
- A cold start after a reboot (S1).

## 4. Findings that shape the real implementation

1. **Never re-render the whole document per edit.** At first, every edit
   re-parsed and re-rendered 2 MB (~400 ms), and typing latency hit 448 ms.
   Source mode now builds the outline from CodeMirror's own incremental syntax
   tree. Rendered and Split modes re-render with a delay that grows with
   document size. For Split mode and live preview on big documents, the real
   build needs **incremental rendering** (re-render only changed blocks).
2. **Highlight code lazily.** Highlighting 2,800 code blocks at once blocked
   the page for seconds. Now blocks are highlighted only when they come within
   1000 px of the viewport.
3. **`content-visibility: auto` made scrolling worse** (85 ms vs 19 ms per
   frame) in this layout, so it was removed. Scroll handlers now do a binary
   search over cached blocks, run at most once per frame, and the outline
   updates only when the current heading changes.
4. **Drafts must be tied to the file version.** A draft is restored only if
   the file's modification time still matches. Otherwise a stale draft would
   silently overwrite newer content.
5. **Session restore after a web-engine restart** must come from the front end
   (`sessionStorage`), not only from the shell's startup arguments. Otherwise
   tabs opened later are lost.
6. **GFM detail:** inside table cells, `\|` within a code span is a literal
   pipe. The renderer handles that now.
7. **Line endings:** CodeMirror's `lineSeparator` facet set to the file's own
   separator, plus a recorded BOM flag, gives byte-exact round trips. Files
   with mixed line endings weren't tested.

## 5. A vs. B: the trade-offs that remain

| | A Tauri 2 | B WPF + WebView2 |
|---|---|---|
| Warm startup | **0.44 s** | 0.84 s |
| Delivered as | one 10.7 MB exe | 9.3 MB folder, plus the **.NET 10 Desktop Runtime** installed (self-contained would be much larger) |
| Shell code | ~280 lines of Rust | ~400 lines of C# |
| Crash recovery | needed an explicit WebView2 COM hook (Windows-specific; macOS/Linux would need their own) | the `ProcessFailed` event is directly available |
| Build time | first build 3 min 18 s, release rebuilds ~1.5 min (LTO) | seconds |
| Cross-platform later | possible (WebKit on macOS/Linux, untested) | would need a new shell |
| Team familiarity | Rust is new, but the layer is small | C# well known |

## 6. Running the spike

See [README.md](README.md).
