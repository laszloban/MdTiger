# S11 – Find in Rendered view, link history, print

| | |
|---|---|
| **Depends on** | S10 |
| **Requirements** | FR-SEARCH-01 and FR-SEARCH-03 in Rendered mode, FR-LINK-03, FR-EXPORT-01 |
| **Spike reference** | none |

## 1. Goal

Close the remaining functional gaps: Ctrl+F and Ctrl+H work the same in
Rendered mode as in Source mode, Back/Forward moves through link jumps and
opened documents, and documents print or save as PDF with the active style
and all diagrams.

## 2. Scope

**In:** the rendered find backend, replace from Rendered mode, navigation
history, print and PDF.

**Out:** search across tabs (FR-SEARCH-02), HTML export, rich-text copy
(later).

## 3. Design and tasks

### 3.1 Rendered find backend (`src/render/findRendered.ts`)

- Implements the S03 `FindBackend` for the rendered view: searches the
  **visible text** of the rendered document (text nodes under the content,
  excluding copy buttons, labels and Mermaid SVG internals; Mermaid
  *source* is searchable when the diagram is toggled to source).
- Highlights all matches with the **CSS Custom Highlight API**
  (`CSS.highlights`, supported in WebView2), the current match in a
  different color; no DOM changes, so it survives re-renders by
  recomputing.
- Match case, whole word, regex as in the source backend; counter, F3,
  Enter etc. identical (the bar is shared).
- Matches inside folded sections unfold them when they become current;
  matches in not-yet-highlighted code blocks still count.
- The bar picks the backend from the active view: Rendered → rendered;
  Source → source; **Split → the side that last had focus**.

### 3.2 Replace from Rendered mode (FR-SEARCH-03)

- Replacement always works on the **source text** (source backend), even
  when started in Rendered mode; the rendered view refreshes afterwards
  and the counter recomputes.
- Because rendered text and source text can differ (markup inside a match,
  escaped characters), the replace row shows the source-match count
  (`12 in source`) next to the rendered count when they differ. *Replace*
  (current) replaces the source match whose range contains the current
  rendered match's `data-from` block; if none matches unambiguously, the
  button switches to Split mode and selects the source match.
- *Replace all* is one undo step, reports the count (as in S03).

### 3.3 Navigation history (FR-LINK-03)

- Entries: `{ tabId, path, sourcePos }`. Pushed before following an
  `#anchor` link, opening a linked document, and outline jumps longer than
  one screen.
- **Alt+Left / Alt+Right**, mouse buttons 4/5, and Back/Forward toolbar
  buttons (disabled when empty). Going back to a closed tab reopens its
  file.
- History is per window session, max 100 entries.

### 3.4 Print and PDF (FR-EXPORT-01)

- Command *Print…* (Ctrl+P) prints the **rendered** document of the active
  tab via the WebView2 print dialog (`window.print()`), which also offers
  *Save as PDF*.
- Before printing: force-render everything lazy (all code highlighting, all
  Mermaid diagrams, all images loaded or placeholdered), unfold folded
  sections, then print.
- A print stylesheet: only the rendered content (no toolbar, tabs, outline,
  status bar, copy buttons), the active rendering style, light colors even
  in dark theme, code blocks wrap instead of scrolling, tables and diagrams
  avoid page breaks inside where possible, links show their URL after the
  text for `http(s)` links.
- Works from any mode (switches temporarily to a hidden rendered view if
  needed).

## 4. Tests

### 4.1 Unit

- Rendered text extraction excludes UI chrome; match positions map to the
  right text nodes (happy-dom).
- History stack: push, back, forward, truncation of forward entries,
  max size.

### 4.2 End to end (`tests/e2e/s11-find-history-print.test.mjs`)

1. Rendered mode, Ctrl+F `mermaid` → counter matches the expected count of
   visible occurrences; `CSS.highlights` contains them; F3 scrolls the
   current one into view.
2. Regex and whole word in Rendered mode.
3. Ctrl+H in Rendered mode, *Replace all* `foo` → `bar` → source changed,
   rendered view refreshed, one Ctrl+Z restores.
4. A match whose source contains markup (`**fo**o`) is found in rendered
   text; the counts differ and the replace row says so.
5. Split mode: find follows the focused side.
6. Click `#anchor` link, open `other.md` via link, then Alt+Left twice →
   back at the original position in the first document; Alt+Right forward.
7. Print: in test mode, replace `window.print` with a recorder; Ctrl+P →
   recorder called after all Mermaid diagrams are SVG and all code blocks
   are highlighted; the print stylesheet hides the toolbar
   (`matchMedia('print')` emulation via CDP `Emulation.setEmulatedMedia`).
8. Earlier suites still pass.

### 4.3 Manual

- Print `showcase.md` to PDF in dark theme: light colors, diagrams present,
  no UI chrome, sensible page breaks.
- Mouse back/forward buttons work.

## 5. Done when

All tests pass with `npm run check`, manual checks done, open issues listed.

## 6. Implementation notes

<!-- Written by the implementing session. -->

## 7. Open issues

| ID | Issue | Proposal |
|---|---|---|
| | | |
