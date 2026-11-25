# S05 – Rich content: code blocks, Mermaid, images, links, checkboxes

| | |
|---|---|
| **Depends on** | S04 |
| **Requirements** | FR-CODE-01 … FR-CODE-05, FR-CODE-08, FR-MERMAID-01 … FR-MERMAID-04 (theme switching itself is S08), FR-LINK-01, FR-LINK-02, FR-LINK-05, FR-EDIT-10 |
| **Spike reference** | `spike/frontend/src/highlight.ts`, `spike/frontend/src/mermaid.ts`, `spike/frontend/src/main.ts` sections *rendered-view interaction* (`copyPlain`, `followLink`, `retryImages`, checkbox toggle); `spike/tests/shell-checks.mjs` checks S2, S4, S5 |

## 1. Goal

Everything in the rendered view that the user interacts with: code blocks
that highlight, select and copy as plain text; Mermaid diagrams; local and
remote images; working links; and task checkboxes that change exactly one
character of the source.

## 2. Scope

**In:** code-block rendering and highlighting, copy button, plain-text copy
rule, language label, horizontal scrolling; Mermaid rendering, errors and
source toggle; images (relative, absolute, remote) with placeholders; link
handling in Rendered and Source mode; clickable checkboxes.

**Out:** back/forward history (S11), retrying images after resume (S10),
Mermaid dark theme switching (S08: but read the theme from a function S08
can change), print (S11).

## 3. Design and tasks

### 3.1 Code blocks (`src/render/code.ts`)

- Fenced and indented code render as `<pre><code>` with the raw text.
  Highlighting uses the same Lezer parsers as the editor
  (`@codemirror/language-data`, `highlightTree` + `classHighlighter`),
  lazily: only when the block comes within 1000 px of the viewport
  (IntersectionObserver, spike `highlight.ts`). Unknown languages stay
  plain monospace (FR-CODE-01). Check that every language in FR-CODE-01 is
  covered; INI/TOML and Dockerfile may need legacy modes.
- **Language label** (FR-CODE-04): small, top-right, muted.
- **Copy button** (FR-CODE-03): appears on hover and on keyboard focus
  inside the block, in the top-right corner (next to the label), doesn't
  cover text in a way that blocks selection. Copies the raw code (no fence
  lines, no language tag, original line breaks and indentation) as plain
  text, then shows "Copied" for ~1.5 s.
- **Plain-text rule** (FR-CODE-08): a `copy` event handler on the rendered
  view. If the selection lies within one code block, put only `text/plain`
  on the clipboard: the selected text with `\n` line breaks (see S05-01).
  A selection that starts in a paragraph and runs into a code block is
  copied by the browser default for now (FR-EXPORT-03 is later), but must
  still keep the code's line breaks.
- Long lines scroll horizontally inside the block (FR-CODE-05). Setting
  `code.wrap` (default `false`) wraps them instead.
- Selecting text in code blocks works with mouse and keyboard, partially
  and fully (FR-CODE-02); nothing (copy button, label) is included in a
  selection (`user-select: none` on the chrome).

### 3.2 Mermaid (`src/render/mermaid.ts`)

- Load the Mermaid bundle lazily on the first ` ```mermaid ` block, never at
  startup. Render each diagram when it comes near the viewport.
- Theme comes from `currentMermaidTheme()` (returns `"default"` now; S08
  wires it to the app theme and re-renders on change).
- `securityLevel: "strict"`.
- A syntax error shows the error message and the source in a styled box;
  other diagrams and the rest of the document still render
  (FR-MERMAID-02).
- A toggle button (next to copy) switches between diagram and source; the
  copy button copies the Mermaid source (FR-MERMAID-03).
- Diagrams in a re-rendered block (S04 incremental rendering) are only
  re-rendered when their source changed (cache SVG by source text + theme).

### 3.3 Images (`src/render/images.ts`)

- Relative and absolute local paths resolve against the document
  (`resolvePath`) and load through Tauri's asset protocol
  (`convertFileSrc`); the asset scope must allow any local path the user
  opens (as in the spike).
- Remote `http(s)` images load natively (decision Q5). While loading and on
  failure, show a placeholder with the alt text and URL; failures are
  logged at `info`, never shown as errors. Keep a list of failed images so
  S10 can retry them.
- Never block rendering on images; set `loading="lazy"` and
  `decoding="async"`.
- The Markdown source is never changed.

### 3.4 Links (`src/render/links.ts`)

| Target | Action |
|---|---|
| `#anchor` | Scroll to the heading with that id in the active view(s). |
| Relative `.md` / `.markdown` (with optional `#anchor`) | Open in a tab (or switch to it), then jump to the anchor. |
| `http(s)`, `mailto:` | Default browser / mail app via the opener plugin. |
| Other local file | Open with the OS default app (opener plugin). |
| Missing local file | Status hint "File not found: …", no dialog. |

- Rendered mode: plain click follows. Source mode: Ctrl+click on a link in
  the editor follows (FR-LINK-02); the pointer shows a hand while Ctrl is
  held over a link.
- Link targets show in the status bar on hover.

### 3.5 Task checkboxes (`src/render/tasks.ts`)

Port the spike toggle (FR-EDIT-10): the checkbox carries the source offset
of the `[ ]` marker; a click dispatches one transaction replacing exactly
that one character (` ` ↔ `x`, keeping `X` if it was `X` before; untick
`X` → ` `, re-tick → `X` again by remembering the case per position until
the next save, as the spike did). One undo step; the document becomes
dirty; scroll position and outline stay put; the checkbox reflects the new
state immediately (optimistic), before the debounced re-render.

Works in Rendered and Split mode, including nested and numbered task items
(`1. [ ] item`).

## 4. Tests

### 4.1 Unit

- Code copy text for fenced, indented, tilde-fenced and nested-in-list
  blocks equals the raw content (no fences, indentation of the list
  container removed correctly).
- Checkbox toggle transaction: changes exactly one character for `- [ ]`,
  `* [x]`, `1. [X]`, nested items; case handling as described.
- Link classification: anchor, relative md with anchor, http, mailto,
  other file, Windows absolute path, UNC path.

### 4.2 End to end (`tests/e2e/s05-rich-content.test.mjs`)

Port the spike's S2, S4 and S5 checks and add:

1. Select part of a code block with real mouse drag → Ctrl+C (real key
   event) → clipboard has only `text/plain`, with line breaks and
   indentation intact.
2. Select from a paragraph into a code block → copy works, code line breaks
   kept.
3. Copy button: hidden until hover, copies raw code without fences, plain
   text only, shows "Copied".
4. Highlighting: blocks near the top are highlighted within 1 s; a block
   far below is not highlighted until scrolled near.
5. Mermaid: valid diagrams render as SVG; a broken one shows its error and
   the next diagram still renders; the toggle shows the source; Mermaid is
   not loaded for a document without diagrams (check that no Mermaid chunk
   was requested).
6. Images: relative SVG and PNG fixtures show (natural width > 0); a remote
   image URL pointing to an unreachable host shows the placeholder.
7. Links: `#anchor` scrolls; relative `other.md#section` opens a tab at the
   section; `https://example.com` calls the opener (in test mode the opener
   is replaced by a recorder in `window.__mdtiger`, so no browser opens).
8. Checkbox: tick → file bytes after save differ in exactly one byte;
   untick → identical to the original; Ctrl+Z after a tick restores it;
   `[X]` keeps its case.
9. Earlier suites still pass.

### 4.3 Manual

- Paste copied code into **Word, Outlook and Teams**: unformatted, original
  whitespace, no colors or background (carried over from the spike's manual
  list).
- Hover a code block: the copy button doesn't get in the way of selecting
  the first line.

## 5. Done when

All tests pass with `npm run check`, manual checks done, open issues listed.

## 6. Implementation notes

<!-- Written by the implementing session. -->

## 7. Open issues

| ID | Issue | Proposal |
|---|---|---|
| S05-01 | Line breaks in copied code: `\n` or `\r\n` on Windows? | Keep `\n` unless the manual paste test shows a problem. |
