# MdTiger – Functional Requirements

| | |
|---|---|
| **Status** | Draft 0.4 – all open questions answered (§7); ready for the technology decision |
| **Date** | 2026-11-25 |
| **Predecessor** | An earlier internal study on extending Zettlr (2026-09/10); not included here |
| **Next step** | Technology decision, once these requirements are accepted |

## 1. Purpose and background

MdTiger is a Markdown viewer/editor for our own team. Most of the Markdown we
handle is generated or edited by AI tools (plans, specs, READMEs, reviews) and
lives in git repositories. We mostly **read and navigate** these documents,
and make **small edits** to them.

Until now we used Zettlr, and the earlier feasibility study planned to extend
it. That plan is now dropped: Zettlr keeps having issues we can't fix from
outside the app. These include:

- Startup has become slow.
- You can't select text inside a code block.
- There is no copy button on code blocks.
- Table editing is glitchy (upstream issues #3553 and #632).
- There's no plugin API, so every fix would mean keeping a fork in sync with
  Zettlr or getting a PR accepted upstream.

This document lists **what** MdTiger has to do. It doesn't choose a technology.

### 1.1 Changes from the feasibility study

| Earlier item | Now |
|---|---|
| Heading auto-numbering written to the source | **Dropped** (§6). Many AI-generated documents already number their headings, so tool-added numbers would be confusing. The outline sidebar (FR-NAV) handles navigation. |
| Outline navigation | Kept and made more specific: a foldable tree with **no numbering** (FR-NAV-02). |
| Code blocks | New: text in code blocks must be selectable, and a copy button appears on hover (FR-CODE). |
| In-document TOC block | **Dropped** (FR-TOC, §6). The outline sidebar makes it unnecessary. |
| Table standardization, Mermaid, folding, styles, toolbar | Kept, see below. |

### 1.2 Priorities

**M** = Must (required for the first usable version), **S** = Should
(expected, but the first version can ship without it), **C** = Could
(nice to have), **W** = Won't (out of scope for now, see §6),
**Phase 2** = planned for after the first release; the phase-1 design
must leave room for it.

## 2. Users and usage context

- Team members (developers, IT operations, project leads) on Windows
  workstations.
- Typical documents are 1–200 KB, with up to a few hundred headings. Many
  contain tables, code blocks and Mermaid diagrams.
- Files are often changed **from outside the app while open** (by AI agents,
  `git pull`, other editors). The app has to handle this gracefully.
- Most of the time is spent reading and navigating. Editing is occasional
  and local.

## 3. Functional requirements

### 3.1 Files and documents (FR-FILE)

| ID | Pri | Requirement |
|---|---|---|
| FR-FILE-01 | M | Open a `.md` / `.markdown` file from the command line, from a file-open dialog, by drag and drop, and by double-click (OS file association). |
| FR-FILE-02 | M | Save, and Save As. Show unsaved changes clearly (e.g. a marker in the title or tab). Ask before closing with unsaved changes. |
| FR-FILE-03 | M | **Source fidelity:** opening and saving without edits must not change the file at all, byte for byte. Saving after an edit changes only the edited parts. No silent reformatting, and no normalizing of line endings, trailing whitespace or list markers. |
| FR-FILE-04 | M | Detect changes made to the open file from outside the app. With no local edits, reload automatically and keep the scroll position as closely as possible. With local edits, ask the user: reload, keep mine, or show a diff (C). |
| FR-FILE-05 | M | Read and write UTF-8, with or without BOM, and keep whatever was there. Keep the existing line endings (LF or CRLF). |
| FR-FILE-06 | M | **Several open documents in tabs.** Each tab keeps its own mode, scroll position, undo history and outline fold state. Tabs can be reordered, and closed individually or all at once. An unsaved-changes marker appears on the tab. A tab's tooltip shows the full path. |
| FR-FILE-07 | S | A list of recent files. Optionally reopen the last session's tabs on startup. |
| FR-FILE-08 | W | ~~Open a folder or workspace with a file-tree sidebar~~. Decided against, see §7.1 Q3. A relative `.md` link still opens the target in a new tab (FR-LINK-02). |
| FR-FILE-09 | C | Autosave (off by default). |
| FR-FILE-10 | S | A single instance: opening a file while the app is running (from Explorer, the command line or a file association) adds a tab to the existing window instead of starting a second process. If the file is already open, the app switches to its tab. |

### 3.2 Markdown support (FR-MD)

| ID | Pri | Requirement |
|---|---|---|
| FR-MD-01 | M | CommonMark plus GitHub Flavored Markdown: tables, task lists, strikethrough, autolinks, fenced code. |
| FR-MD-02 | M | Tolerant table parsing: render the slightly malformed pipe tables typical of AI output, as long as GitHub would render them too (missing leading/trailing pipes, uneven padding, short separator rows). |
| FR-MD-03 | M | YAML front matter is recognized. It isn't rendered as body text; it is shown collapsed or styled as metadata. |
| FR-MD-04 | S | Footnotes, and heading anchors generated the GitHub way, so `[x](#some-heading)` links work. |
| FR-MD-05 | S | Inline and block HTML that is common in READMEs (`<br>`, `<details>`, `<img>`, comments) renders safely: no script execution. |
| FR-MD-06 | C | Math (`$…$`, `$$…$$`). |
| FR-MD-07 | C | GitHub alert blocks (`> [!NOTE]`, `> [!WARNING]`, …). |

### 3.3 Viewing and editing modes (FR-EDIT)

| ID | Pri | Requirement |
|---|---|---|
| FR-EDIT-01 | M | **Rendered (read) mode**: fully rendered document, with comfortable reading typography. |
| FR-EDIT-02 | M | **Source mode**: plain Markdown with syntax highlighting. |
| FR-EDIT-03 | S | **Side-by-side mode**: source and rendered views next to each other, with synchronized scrolling. |
| FR-EDIT-04 | Phase 2 | **Live preview / WYSIWYG mode**: edit directly in the rendered view, the way Zettlr does (the current line shows raw Markdown, other lines are rendered). It isn't part of phase 1, but **the phase-1 architecture must not rule it out**. See NFR-09 and §7.1 Q2. |
| FR-EDIT-05 | M | Switch between modes with one click or keystroke, keeping the position in the document. |
| FR-EDIT-06 | M | Standard editing: undo/redo (multi-level), clipboard, find (FR-SEARCH-01), replace (FR-SEARCH-03), go to line. |
| FR-EDIT-07 | S | A formatting toolbar: heading level, bold, italic, inline code, code block, link, bulleted/numbered/task list, quote, table, horizontal rule. Every action also has a keyboard shortcut. |
| FR-EDIT-08 | S | Smart list continuation: pressing Enter in a list continues it, and Tab/Shift+Tab indents and outdents. |
| FR-EDIT-09 | C | Spell checking (English and Hungarian), off by default. |
| FR-EDIT-10 | M | **Clickable task-list checkboxes:** GitHub-style task items (`- [ ] item`, `- [x] item`, including nested and numbered ones such as `1. [ ] item`) are shown as real checkboxes in Rendered, Side-by-side and (later) Live preview modes. Clicking one ticks or unticks it, and only the `[ ]` ↔ `[x]` character changes in the source (FR-FILE-03). Each click is one undo step, the document is marked as having unsaved changes, and the outline and scroll position stay put. Both `[x]` and `[X]` count as ticked, and the existing case is kept when unticking and ticking again. |
| FR-EDIT-11 | S | In Source mode, a keyboard shortcut (e.g. Ctrl+Enter) and a toolbar button toggle the task checkbox on the current line or the selected lines. On a plain list item, the shortcut turns it into a task item. |

### 3.4 Heading navigation and folding (FR-NAV)

| ID | Pri | Requirement |
|---|---|---|
| FR-NAV-01 | M | An **outline sidebar** that lists all of the document's headings (H1–H6) as a tree, based on heading level. |
| FR-NAV-02 | M | The outline shows heading text **exactly as written**. It adds **no numbering** of its own: if the source says `## 4.3 Foo`, the entry reads `4.3 Foo`. If the source says `## Foo`, it reads `Foo`. |
| FR-NAV-03 | M | Each tree node with children can be **folded and unfolded** on its own. There are also *Collapse all*, *Expand all* and *Expand to level N* controls. |
| FR-NAV-04 | M | Clicking an entry jumps to that heading in the active view (rendered, source or both). |
| FR-NAV-05 | M | The outline updates as the document changes (edits, external reload), without losing its fold state for headings that still exist. |
| FR-NAV-06 | S | The entry for the section currently in view is highlighted, and stays visible as you scroll. |
| FR-NAV-07 | S | The outline can be shown or hidden, and its width can be adjusted. Both settings are remembered. |
| FR-NAV-08 | S | Filter the outline by typing (substring match on heading text). |
| FR-NAV-09 | S | **Heading folding in the document**: collapse or expand a section (a heading plus its content) in the editor or rendered view, with fold-all and unfold-all commands. |
| FR-NAV-10 | C | Inline formatting in headings (`**bold**`, `` `code` ``, links) is shown as plain text in the outline. |

### 3.5 Code blocks (FR-CODE)

| ID | Pri | Requirement |
|---|---|---|
| FR-CODE-01 | M | Syntax highlighting for fenced code blocks, covering at least: C#, PowerShell, Bash/sh, Python, JavaScript/TypeScript, JSON, YAML, XML/HTML, CSS, SQL, Dockerfile, INI/TOML, diff, Markdown. Unknown languages are shown as plain monospace text. |
| FR-CODE-02 | M | **Text inside code blocks can be selected** with the mouse and keyboard in every mode, both partially and fully. A selection can also start in normal text and run into or across a code block. |
| FR-CODE-08 | M | **Copying from a code block always gives plain text.** A selection inside a single code block, and anything copied with the copy button (FR-CODE-03), goes to the clipboard as plain text only, with no HTML or RTF format alongside. So pasting into Outlook, Teams or Word gives unformatted code, without syntax colors or background, and with the original whitespace. This holds even when rich-text copy (FR-EXPORT-03) is turned on. |
| FR-CODE-03 | M | **Copy button on hover**: when the mouse is over a code block, a copy button appears in its top-right corner. Clicking it copies the block's full content: the raw code, without the fence lines or language tag, and with its original line breaks and indentation. A short confirmation appears (e.g. the icon changes to "Copied" for about 1.5 s). The button doesn't cover code text in a way that blocks selection. |
| FR-CODE-04 | S | The language tag (e.g. `powershell`) is shown as a small label on the block. |
| FR-CODE-05 | S | Long lines scroll horizontally inside the block, without breaking the page layout. Wrapping can optionally be turned on. |
| FR-CODE-06 | C | Line numbers for code blocks (off by default). |
| FR-CODE-07 | C | A copy button for inline code spans, or a click-to-copy option. |

### 3.6 Mermaid diagrams (FR-MERMAID)

| ID | Pri | Requirement |
|---|---|---|
| FR-MERMAID-01 | M | Render ` ```mermaid ` fenced blocks as diagrams in rendered and side-by-side modes. Support at least: flowchart, sequence, class, state, ER, Gantt, pie, mindmap and timeline. |
| FR-MERMAID-02 | M | If a diagram has a syntax error, show the error message and the source instead of the diagram. The rest of the document keeps rendering. |
| FR-MERMAID-03 | S | Each diagram can be toggled between the rendered diagram and its source. The copy button (FR-CODE-03) copies the Mermaid source. |
| FR-MERMAID-04 | S | Diagram colors follow the active theme (light/dark). |
| FR-MERMAID-05 | C | Zoom or pan for large diagrams. Export one diagram as SVG or PNG. |

### 3.7 Tables (FR-TABLE)

| ID | Pri | Requirement |
|---|---|---|
| FR-TABLE-01 | M | Render GFM tables with column alignment, header styling and horizontal scrolling for wide tables. |
| FR-TABLE-02 | S | A **Standardize table** command (on the toolbar and in the context menu) for the table under the cursor, plus **Standardize all tables** for the whole document. Each rewrites the table source as canonical GFM: leading and trailing pipes, uniform cell padding, columns aligned to their widest cell, and a separator row matching each column's alignment (`:---`, `:---:`, `---:`). Escaped pipes (`\|`) and inline code are preserved. It runs as one undo step. |
| FR-TABLE-03 | S | Insert a table using a rows × columns picker. |
| FR-TABLE-04 | C | Simple structural table edits in the editor: add or remove a row or column, move a column, set alignment. |

### 3.8 In-document table of contents (FR-TOC)

| ID | Pri | Requirement |
|---|---|---|
| FR-TOC-01 | W | ~~An Insert / refresh TOC command that writes a link list into the source.~~ Dropped: the outline sidebar (FR-NAV) makes it unnecessary (§7 Q8). An existing TOC already in a document is still rendered as normal Markdown, and its `#anchor` links work (FR-LINK-02). |

### 3.9 Links and images (FR-LINK)

| ID | Pri | Requirement |
|---|---|---|
| FR-LINK-01 | M | Show images given by relative or absolute local paths, resolved relative to the document. |
| FR-LINK-05 | M | Show remote (`http(s)`) images automatically. How depends on the technology: with a web-based renderer, it loads them directly. Otherwise, the app downloads them in the background, caches them locally and shows the cached copy. A failed or slow download shows a placeholder with the URL and never blocks rendering or startup. The Markdown source is never changed (no rewritten URLs). |
| FR-LINK-02 | M | Ctrl+clicking a link (or clicking it in rendered mode) opens it: `#anchor` jumps within the document, a relative `.md` link opens that file in MdTiger (at its anchor, if one is given), `http(s)` links open in the default browser, and other local files open with the OS default application. |
| FR-LINK-03 | S | Navigation history: Back and Forward (Alt+←/→) across anchor jumps and opened linked documents. |
| FR-LINK-04 | C | Paste an image from the clipboard: save it next to the document (e.g. in `./images/`) and insert a relative link. |

### 3.10 Appearance and styles (FR-STYLE)

| ID | Pri | Requirement |
|---|---|---|
| FR-STYLE-01 | M | Built-in light and dark themes, which can follow the OS setting. |
| FR-STYLE-02 | M | Headings H1–H6 look clearly different from each other (size, weight, spacing, optionally rule lines). This is the original complaint about Zettlr's flat heading styling. |
| FR-STYLE-03 | S | Several built-in rendering styles to choose from, e.g. "GitHub-like", "Document/print-like" and "Compact". |
| FR-STYLE-04 | S | User-defined custom styles that override the built-in ones, and can be shared across the team as files. The format (CSS, or a theme file for colors, fonts, sizes and spacing) follows the chosen technology (§7 Q7). Either way, a style must at least be able to set heading appearance (FR-STYLE-02), fonts, colors, and the look of code blocks and tables. |
| FR-STYLE-05 | S | Adjustable fonts, font size and content width. Zoom in and out with Ctrl+wheel or Ctrl+±. |

### 3.11 Search (FR-SEARCH)

| ID | Pri | Requirement |
|---|---|---|
| FR-SEARCH-01 | M | **Find (Ctrl+F)** in the current document, in every mode. All matches are highlighted, with a match counter ("3 of 17"), Next/Previous (F3 / Shift+F3, Enter / Shift+Enter) and options for match case, whole word and regex. If text is selected, Ctrl+F starts with it as the search term. |
| FR-SEARCH-03 | M | **Replace (Ctrl+H)** opens the find bar with a replace field. Replace current, Replace all and Undo are available. Regex replacements can use capture groups (`$1`). *Replace all* is a single undo step and reports how many replacements it made. Replacement always works on the **source text**, also when started from Rendered mode, and the rendered view refreshes afterwards. |
| FR-SEARCH-02 | C | Search across all open tabs. (Folder-wide search was dropped along with FR-FILE-08.) |

### 3.12 Export and print (FR-EXPORT)

| ID | Pri | Requirement |
|---|---|---|
| FR-EXPORT-01 | S | Print, or export to PDF, using the active rendering style, with Mermaid diagrams included. |
| FR-EXPORT-02 | C | Export to a self-contained HTML file. |
| FR-EXPORT-03 | C | Copy the selection as rich text (HTML), so it pastes formatted into Outlook, Teams or Word. Exception: code-block content is always plain text (FR-CODE-08). In a selection that mixes normal text and a code block, the code part goes in as unformatted monospace text. |

### 3.13 Application (FR-APP)

| ID | Pri | Requirement |
|---|---|---|
| FR-APP-01 | M | A command palette (e.g. Ctrl+Shift+P) that lists every command with its shortcut. |
| FR-APP-02 | M | Settings persist per user, in a human-readable file. |
| FR-APP-03 | S | Keyboard shortcuts can be customized. |
| FR-APP-04 | S | The app remembers window size and position, sidebar state and the last mode used. |
| FR-APP-05 | M | **Default Markdown application:** the installer registers MdTiger for `.md` and `.markdown`. On startup, if MdTiger isn't the default handler, it asks whether to become the default. Answers are *Yes*, *Not now* and *Don't ask again*, and the check can be turned back on in Settings. Because Windows doesn't let apps set the default silently, *Yes* opens the system's default-app dialog for those extensions. |

## 4. Non-functional requirements

These lie outside the functional scope, but they are the main reasons for
leaving Zettlr, so they belong in this document.

| ID | Pri | Requirement |
|---|---|---|
| NFR-01 | M | **Fast startup:** with a typical 100 KB document, a usable window appears within **≤ 1 s** of a warm start and **≤ 2 s** of a cold start on a standard office laptop. |
| NFR-02 | M | Responsive with large documents: a 2 MB / 20 000-line file opens and scrolls smoothly, and typing latency stays below 50 ms. |
| NFR-03 | M | Works fully offline. No telemetry. The only network traffic is fetching remote images that documents refer to (FR-LINK-05). Without a connection, these just show placeholders. |
| NFR-04 | M | Runs on Windows 10/11 x64. It can be installed per user, without admin rights, or used as a portable app. |
| NFR-05 | S | Can be deployed company-wide, e.g. with an MSI or winget package, or by copying a folder. |
| NFR-06 | S | Rendering is safe: raw HTML is sanitized, and Markdown can never run scripts. |
| NFR-07 | C | Runs on Linux and macOS too. This is nice to have, and is only worth it if the chosen technology makes it cheap. Weigh the added complexity during the technology decision. See §7.1 Q1. |
| NFR-08 | S | User interface in English. Content in any language, including full Hungarian character support. |
| NFR-10 | M | **Survives sleep, hibernate and network changes:** after the laptop wakes from sleep or hibernation, or after the network drops, comes back or switches, MdTiger carries on quietly. **No modal error dialogs** for background failures. A failed remote image keeps its placeholder and is retried once the network is back (FR-LINK-05). Errors go to a log file and, at most, a non-blocking status hint. On resume, the app re-checks every open file for changes made outside it (FR-FILE-04), because file-watcher events can be missed while the machine sleeps. If the embedded web engine's process is lost, it restarts and restores the tabs without losing unsaved edits. |
| NFR-11 | M | **No unexpected error pop-ups in general:** unhandled errors are caught and logged, never shown as framework-default crash dialogs. A modal dialog is used only when the user must decide something (e.g. unsaved changes, or the file changed on disk while also edited here). |
| NFR-09 | M | **Room for live preview later:** the phase-1 design must make it possible to add the live preview mode (FR-EDIT-04) without a rewrite. In practice: (a) the source editor component can render widgets and decorations inline, so headings, images, code blocks, Mermaid and tables can be drawn in place while the source text stays the single source of truth; (b) one parser, aware of positions in the source, feeds the outline, the rendering and the editor, so a rendered element can always be mapped back to its source range; (c) the edit model works on the source text, not on an HTML/DOM copy that gets converted back (keeping FR-FILE-03). The technology choice must show (a)–(c) with a small proof of concept. |

## 5. Known Zettlr pain points and where they are covered

| Zettlr issue | Covered by |
|---|---|
| Slow startup | NFR-01 |
| Connection error dialogs to click away after waking from hibernation | NFR-10, NFR-11 |
| Can't select text inside a code block | FR-CODE-02 |
| No copy button on code blocks | FR-CODE-03 |
| Flat heading styling | FR-STYLE-02 |
| Glitchy table editing, no table normalization | FR-TABLE-02 / -04 |
| No plugin API; fork or upstream PR the only way in | Not applicable: our own codebase |
| Workspace/Zettelkasten-centric model, more than we need | FR-FILE-01 / -06 (open single files directly, in tabs). No workspace concept. |

## 6. Out of scope (Won't, for now)

- **Heading auto-numbering**, in the source or as a visual overlay. AI-made
  documents often number their headings already, and tool-added numbers would
  collide with them. The outline sidebar (FR-NAV) covers navigation.
- Workspace or folder mode: a file-tree sidebar, project files, search across a folder.
- Generating an in-document table of contents. The outline sidebar covers this.
- Zettelkasten features: note IDs, backlinks, tag management.
- Citations and bibliography (Zotero/CSL), and Pandoc-based export to
  DOCX/LaTeX.
- Real-time collaboration, cloud sync, accounts.
- Git integration: commit, diff and history views. Users keep their usual
  git tools.
- Editing in other formats (AsciiDoc, reStructuredText).

## 7. Decisions and open questions

### 7.1 Decided (2026-11-25)

Q1–Q8 are all answered.

| # | Question | Decision |
|---|---|---|
| Q1 | Platforms? | **Windows is a must.** Cross-platform is nice to have (NFR-07). Whether to go for it is decided together with the technology, depending on how much complexity it adds. |
| Q2 | Live preview editing? | **Phase 2** (FR-EDIT-04). Phase 1 delivers Rendered, Source and Side-by-side modes. The architecture must keep live preview possible from day one (NFR-09). |
| Q3 | Workspace or single file? | **No workspace.** Single files, with several open at once in **tabs** (FR-FILE-06, now Must). Folder mode is Won't (FR-FILE-08). |

| Q4 | Should MdTiger be the default `.md` handler? | **Yes.** If it isn't the default, the app asks (FR-APP-05). |
| Q5 | How should remote images be handled? | **Shown automatically.** The mechanism depends on the technology: a web-based renderer loads them natively, otherwise they are fetched and shown as cached local images (FR-LINK-05). |
| Q6 | Are the startup targets right? | **Yes:** ≤ 1 s warm, ≤ 2 s cold (NFR-01). |
| Q7 | CSS or a simple theme file for custom styles? | **Depends on the technology** (FR-STYLE-04). |
| Q8 | Is an in-document TOC still needed? | **No.** The outline sidebar makes it obsolete (FR-TOC is now Won't). |

### 7.2 Decided together with the technology

- Whether to go cross-platform (NFR-07): weigh the added complexity.
- How remote images are loaded (FR-LINK-05).
- The custom style format (FR-STYLE-04).

## 8. Next steps

1. Final review of the priorities in this document.
2. Collect test fixtures: real AI-generated Markdown files covering tables,
   Mermaid, long code blocks, pre-numbered headings, front matter and large
   documents.
3. Technology decision (see [TECHNOLOGY_OPTIONS.md](TECHNOLOGY_OPTIONS.md)): evaluate candidate stacks against the M requirements
   and the NFRs (startup time in particular), ideally with a small spike that
   covers FR-CODE-02/03, FR-NAV-01–05, FR-MERMAID-01, NFR-01 and the
   live-preview groundwork in NFR-09 (one inline widget drawn in the source
   editor, such as a rendered heading or an image). For each candidate, also
   note what Linux/macOS support would cost (NFR-07).
