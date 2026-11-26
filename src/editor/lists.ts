// List item indentation (Tab / Shift+Tab). Inside a list a whole item moves
// together with its children; outside a list Tab inserts the indent unit, so
// Tab never moves focus out of the editor.

import { indentLess, indentMore } from "@codemirror/commands";
import { indentUnit, syntaxTree } from "@codemirror/language";
import type { ChangeSpec, EditorState, Transaction } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export interface Target {
  readonly state: EditorState;
  dispatch(tr: Transaction): void;
}

function listItemAt(state: EditorState, pos: number): SyntaxNode | null {
  let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (n && n.name !== "ListItem") n = n.parent;
  return n;
}

/** Width of an item's marker plus the following space ("- " = 2, "10. " = 4). */
function markerWidth(item: SyntaxNode, state: EditorState): number {
  const mark = item.getChild("ListMark");
  return mark ? mark.to - mark.from + 1 : state.facet(indentUnit).length;
}

function leadingSpaces(text: string): number {
  return /^ */.exec(text)![0].length;
}

/** The items to move: the item under each selection range, outermost only. */
function itemsFor(state: EditorState): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (const r of state.selection.ranges) {
    for (let pos = r.from; ; ) {
      const line = state.doc.lineAt(pos);
      const item = listItemAt(state, Math.min(line.to, Math.max(line.from, pos)));
      if (item && !out.some((o) => o.from <= item.from && o.to >= item.to)) out.push(item);
      if (line.to >= r.to) break;
      pos = line.to + 1;
    }
  }
  return out.filter((a) => !out.some((b) => b !== a && b.from <= a.from && b.to >= a.to && (b.from < a.from || b.to > a.to)));
}

/** Tab / Shift+Tab on list items. Returns false when the cursor isn't in a list. */
export function indentListItems(target: Target, dir: 1 | -1): boolean {
  const { state } = target;
  const items = itemsFor(state);
  if (!items.length) return false;
  const changes: ChangeSpec[] = [];
  for (const item of items) {
    const first = state.doc.lineAt(item.from);
    const last = state.doc.lineAt(Math.max(item.from, item.to - 1));
    if (dir === 1) {
      // Needs a previous sibling to become its child.
      if (!item.prevSibling || item.prevSibling.name !== "ListItem") continue;
      const pad = " ".repeat(Math.max(markerWidth(item, state), state.facet(indentUnit).length));
      for (let n = first.number; n <= last.number; n++) {
        const line = state.doc.line(n);
        if (line.length > 0) changes.push({ from: line.from, insert: pad });
      }
    } else {
      const parent = item.parent?.parent;
      if (!parent || parent.name !== "ListItem") continue;
      const target0 = parent.from - state.doc.lineAt(parent.from).from;
      const amount = leadingSpaces(first.text) - target0;
      if (amount <= 0) continue;
      for (let n = first.number; n <= last.number; n++) {
        const line = state.doc.line(n);
        const k = Math.min(amount, leadingSpaces(line.text));
        if (k > 0) changes.push({ from: line.from, to: line.from + k });
      }
    }
  }
  if (changes.length) target.dispatch(state.update({ changes, userEvent: dir === 1 ? "input.indent" : "delete.dedent", scrollIntoView: true }));
  return true; // inside a list the key is ours even when nothing moved
}

/** Tab: indent the list item, else insert the indent unit (or indent a selection). */
export function listTab(target: Target): boolean {
  if (indentListItems(target, 1)) return true;
  const { state } = target;
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore(target as never);
  target.dispatch(state.update(state.replaceSelection(state.facet(indentUnit)), { scrollIntoView: true, userEvent: "input" }));
  return true;
}
/** Shift+Tab: outdent the list item, else remove one indent level. */
export const listShiftTab = (view: Target): boolean => indentListItems(view, -1) || indentLess(view as never);
