// Go to line (Ctrl+G): a small input in the find bar's place, `line` or `line:col`.

import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Position for `120` or `120:5` (1-based; clamped to the document), or null if the text is not a position. */
export function parseLineSpec(text: string, state: EditorState): number | null {
  const m = /^\s*(\d+)(?:\s*[:,]\s*(\d+))?\s*$/.exec(text);
  if (!m) return null;
  const line = state.doc.line(Math.min(Math.max(Number(m[1]), 1), state.doc.lines));
  const col = m[2] === undefined ? 1 : Math.max(Number(m[2]), 1);
  return line.from + Math.min(col - 1, line.length);
}

export interface GotoLineBar {
  open(): void;
  /** Hides the bar; returns focus to the editor unless `focusEditor` is false. */
  close(focusEditor?: boolean): void;
  readonly isOpen: boolean;
}

export function mountGotoLine(dock: HTMLElement, getView: () => EditorView | null, onOpen: () => void): GotoLineBar {
  const bar = document.createElement("div");
  bar.id = "goto-bar";
  bar.className = "dock-bar";
  bar.hidden = true;
  const label = document.createElement("label");
  label.htmlFor = "goto-input";
  label.textContent = "Go to line";
  const input = document.createElement("input");
  input.id = "goto-input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "line or line:column";
  const hint = document.createElement("span");
  hint.id = "goto-hint";
  hint.className = "dock-hint";
  bar.append(label, input, hint);
  dock.append(bar);

  const api: GotoLineBar = {
    get isOpen() {
      return !bar.hidden;
    },
    open() {
      const v = getView();
      if (!v) return;
      onOpen();
      bar.hidden = false;
      input.value = "";
      input.classList.remove("invalid");
      hint.textContent = `of ${v.state.doc.lines}`;
      input.focus();
    },
    close(focusEditor = true) {
      if (bar.hidden) return;
      bar.hidden = true;
      if (focusEditor) getView()?.focus();
    },
  };

  const go = () => {
    const v = getView();
    if (!v) return;
    const pos = parseLineSpec(input.value, v.state);
    if (pos === null) {
      input.classList.add("invalid");
      return;
    }
    v.dispatch({ selection: EditorSelection.single(pos), effects: EditorView.scrollIntoView(pos, { y: "center" }), userEvent: "select" });
    api.close();
  };

  input.addEventListener("input", () => input.classList.remove("invalid"));
  bar.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      go();
    } else if (e.key === "Escape") {
      e.preventDefault();
      api.close();
    }
  });
  return api;
}
