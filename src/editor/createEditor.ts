// The one place where the editor's extensions are assembled. S03 extends it
// (Markdown language, find/replace, list editing).

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { LineSeparator } from "../core/doc";

/** A state whose lines are split on `lineSeparator` only. A lone CR or LF
 *  inside a file with the other separator stays in the line, so such a file
 *  round-trips byte for byte. `extra` carries per-document extensions such as
 *  the update listener. */
export function createEditorState(text: string, lineSeparator: LineSeparator, extra: Extension[] = []): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      EditorState.lineSeparator.of(lineSeparator),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      ...extra,
    ],
  });
}

export function createEditorView(state: EditorState): EditorView {
  return new EditorView({ state });
}
