# S07 – Formatting toolbar and table tools

| | |
|---|---|
| **Depends on** | S06 |
| **Requirements** | FR-EDIT-07 (now M), FR-EDIT-11, FR-TABLE-02, FR-TABLE-03 |
| **Spike reference** | none (new) |

## 1. Goal

Toolbar buttons and shortcuts for the main Markdown formatting (at least
bold, italic, lists, table, as the user asked), each a clean edit of the
source text and a single undo step.

## 2. Scope

**In:** formatting commands as pure functions on `EditorState`, the
formatting group of the toolbar, its overflow menu, heading-level dropdown,
table insert picker, *Standardize table* / *Standardize all tables*, task
toggle in Source mode.

**Out:** rich-text editing in the rendered view (that is live preview,
phase 2), structural table editing (FR-TABLE-04, later).

## 3. Design and tasks

### 3.1 Commands (`src/editor/formatting.ts`)

Each command is `(state: EditorState) => TransactionSpec | null`, so it can
be unit-tested without a DOM, and is registered in the command registry.

| Command | Shortcut | Behavior |
|---|---|---|
| Bold | Ctrl+B | Wrap selection in `**`; if already bold (markers just inside or outside the selection), remove them. Empty selection: insert `****` with the cursor in the middle, or un-bold the word under the cursor if it is bold. |
| Italic | Ctrl+I | Same with `*` (recognise `_` as existing italic when removing). |
| Strikethrough | Ctrl+Shift+X | `~~`. |
| Inline code | Ctrl+Shift+C | `` ` ``; if the selection contains a backtick, use a longer fence. |
| Code block | Ctrl+Shift+K | Wrap the selected lines in ```` ``` ```` fences (cursor after the opening fence to type a language); inside a block: remove the fences. |
| Link | Ctrl+K | `[selection](url)` with `url` selected; if the selection looks like a URL, `[](selection)` with the cursor in the brackets. |
| Heading 1–6 / Paragraph | Ctrl+Shift+1…6, Ctrl+Shift+0 | Set the level of the current line(s); same level again removes it. |
| Bulleted list | Ctrl+Shift+8 | Toggle `- ` on the selected lines (convert from numbered/task). |
| Numbered list | Ctrl+Shift+7 | Toggle `1. `, `2. `, … on the selected lines. |
| Task list | Ctrl+Shift+9 | Toggle `- [ ] `. |
| Toggle task | Ctrl+Enter | FR-EDIT-11: on task lines, tick/untick (`[ ]` ↔ `[x]`, keeping `X`); on plain list items, make them tasks; on other lines, nothing. |
| Quote | Ctrl+Shift+Q | Toggle `> ` on the selected lines. |
| Horizontal rule | none | Insert `---` on its own line with blank lines around it. |
| Insert table | none (button) | §3.3. |
| Standardize table / all | none (button, menu) | §3.4. |

- Multiple selections: apply to each range.
- Each command is **one transaction** (one undo step) and keeps a sensible
  selection afterwards.
- Lines inside code blocks and front matter are left alone by line-based
  commands.
- **Shortcut conflicts:** Ctrl+Shift+O (outline), Ctrl+1/2/3 (modes) and
  Ctrl+E are taken. Follow the keyboard-layout rule in IMPLEMENTATION_PLAN
  §3 (no Ctrl+Alt, digits by physical key). Before finalising, list all
  registered shortcuts and check for duplicates (add a unit test that fails
  on duplicates).

### 3.2 Toolbar group (`src/ui/formatToolbar.ts`)

- After the mode switch: Heading dropdown, Bold, Italic, Strikethrough,
  Inline code, Code block, Link | Bulleted, Numbered, Task list, Quote |
  Table, Rule. Lucide icons, tooltips with name and shortcut.
- **Rendered mode:** the formatting buttons are disabled, with the tooltip
  "Switch to Source or Split to edit" (open issue OI-02 in the plan; keep
  the logic in one function so the decision can change it easily).
- Buttons that reflect state (Bold, Italic, list type, heading level) show
  a pressed look when the cursor is inside such formatting, using the same
  pressed style as the mode switch (S04).
- Narrow windows: buttons that don't fit move into a `…` overflow menu, in
  order from the right. No wrapping to a second row.
- Clicking a button keeps the editor's focus and selection.

### 3.3 Insert table (FR-TABLE-03)

A grid picker (up to 8 × 8, hover to choose, click to insert) plus "Custom…"
(two number fields). Inserts a standardized empty table with a header row
at the start of the next empty line, cursor in the first header cell.

### 3.4 Standardize table (FR-TABLE-02) (`src/editor/tables.ts`)

- Uses the Lezer `Table` node. Rewrites the table under the cursor (or every
  table, for *all*) to canonical GFM: leading and trailing pipes, one space
  padding, columns padded to the widest cell, separator row matching each
  column's alignment (`:---`, `:---:`, `---:`, `---`).
- Escaped pipes (`\|`) and pipes inside code spans are preserved.
- Width = count of code points, with East Asian wide characters counted as
  2 (note in the implementation notes which rule was used).
- Rows with fewer cells get empty cells; extra cells are kept (the column
  count becomes the widest row).
- One transaction for the whole command; a table that is already standard
  produces no change (and no dirty marker).

## 4. Tests

### 4.1 Unit

- Every command in §3.1: apply, apply again (toggles back to the original
  text exactly), empty selection, multi-line, multiple selections, inside a
  code block (no change).
- Shortcut uniqueness across the whole registry.
- Standardize: the cases in `spike/samples/tables.md`; escaped pipes; code
  spans with pipes; alignment rows; uneven rows; idempotence (standardizing
  twice equals once); Hungarian accented text widths.
- Table insert output for 3 × 2.

### 4.2 End to end (`tests/e2e/s07-formatting.test.mjs`)

1. In Source mode, select a word, click Bold → `**word**`; click again →
   original; Ctrl+Z after the first click restores the original (one undo
   step).
2. Ctrl+B / Ctrl+I / Ctrl+Shift+8 / Ctrl+Shift+7 / Ctrl+Enter work with real
   key events.
3. Bold button shows pressed when the cursor is inside bold text.
4. Rendered mode: formatting buttons disabled with the tooltip; Split mode:
   enabled, and the rendered side updates.
5. Insert a 3 × 4 table via the picker → the rendered view shows a table
   with 3 columns and 4 rows (header + 3).
6. *Standardize all tables* on `tables.md` → the file content equals the
   expected fixture `tables.standard.md`; second run changes nothing.
7. Window width 700 px → overflow menu appears and contains the hidden
   buttons; they work from there.
8. Earlier suites still pass.

### 4.3 Manual

- Formatting feels predictable on real documents (selection after the
  command, no surprises at line starts or inside lists).

## 5. Done when

All tests pass with `npm run check`, manual checks done, open issues listed.

## 6. Implementation notes

<!-- Written by the implementing session. -->

## 7. Open issues

| ID | Issue | Proposal |
|---|---|---|
| | | |
