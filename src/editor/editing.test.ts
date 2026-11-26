import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createEditorState } from "./createEditor";
import { listShiftTab, listTab, type Target } from "./lists";

/** A holder for a state: `|` in the text marks the cursor. */
function holder(textWithCaret: string): Target & { state: EditorState } {
  const caret = textWithCaret.indexOf("|");
  const text = textWithCaret.replace("|", "");
  let state = createEditorState(text, "\n");
  state = state.update({ selection: EditorSelection.single(caret) }).state;
  ensureSyntaxTree(state, state.doc.length, 5000);
  const h = {
    get state() {
      return state;
    },
    dispatch(tr: Transaction) {
      state = tr.state;
      ensureSyntaxTree(state, state.doc.length, 5000);
    },
  };
  return h;
}

/** The document with `|` at the main cursor. */
function shown(h: Target): string {
  const t = h.state.doc.toString();
  const c = h.state.selection.main.head;
  return t.slice(0, c) + "|" + t.slice(c);
}

const enter = (h: Target) => insertNewlineContinueMarkupCommand({ nonTightLists: false })(h as never);

describe("list continuation (Enter)", () => {
  it("continues a bullet list", () => {
    const h = holder("- a|");
    enter(h);
    expect(shown(h)).toBe("- a\n- |");
  });

  it("numbers an ordered list", () => {
    const h = holder("1. a|");
    enter(h);
    expect(shown(h)).toBe("1. a\n2. |");
  });

  it("continues a task item with an unchecked box", () => {
    const h = holder("- [ ] a|");
    enter(h);
    expect(shown(h)).toBe("- [ ] a\n- [ ] |");
  });

  it("ends the list on an empty item", () => {
    const h = holder("- a\n- |");
    enter(h);
    const text = h.state.doc.toString();
    expect(text.startsWith("- a\n")).toBe(true);
    const line = h.state.doc.lineAt(h.state.selection.main.head);
    expect(line.text).not.toMatch(/^\s*[-*+]/);
  });

  it("Backspace at the marker removes the markup", () => {
    const h = holder("- a\n- |");
    expect(deleteMarkupBackward(h as never)).toBe(true);
    expect(h.state.doc.lineAt(h.state.selection.main.head).text).not.toMatch(/^- /);
  });
});

describe("Tab and Shift+Tab", () => {
  it("indents a list item with its children and outdents them again", () => {
    const h = holder("- a\n- b|\n  - c\n- d");
    expect(listTab(h)).toBe(true);
    expect(shown(h)).toBe("- a\n  - b|\n    - c\n- d");
    expect(listShiftTab(h)).toBe(true);
    expect(shown(h)).toBe("- a\n- b|\n  - c\n- d");
  });

  it("indents an ordered item by its marker width", () => {
    const h = holder("1. a\n2. b|");
    listTab(h);
    expect(shown(h)).toBe("1. a\n   2. b|");
  });

  it("does not indent the first item of a list (nothing to nest under)", () => {
    const h = holder("- a|\n- b");
    expect(listTab(h)).toBe(true);
    expect(shown(h)).toBe("- a|\n- b");
  });

  it("Shift+Tab on a top-level item changes nothing", () => {
    const h = holder("- a|\n- b");
    expect(listShiftTab(h)).toBe(true);
    expect(shown(h)).toBe("- a|\n- b");
  });

  it("outside a list Tab inserts the indent unit and keeps focus in the editor", () => {
    const h = holder("para|");
    expect(listTab(h)).toBe(true);
    expect(shown(h)).toBe("para  |");
  });
});
