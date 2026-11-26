// The one place where the editor's extensions are assembled.

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, rectangularSelection } from "@codemirror/view";
import { classHighlighter, tags as t } from "@lezer/highlight";
import type { LineSeparator } from "../core/doc";
import { findExtension } from "./find";
import { listShiftTab, listTab } from "./lists";
import { livePreview } from "./livePreview";
import { markdownSupport } from "./markdownSupport";

export interface EditorOptions {
  /** `editor.lineNumbers` */
  lineNumbers: boolean;
  /** `experimental.livePreview` */
  livePreview: boolean;
}

export const DEFAULT_EDITOR_OPTIONS: EditorOptions = { lineNumbers: false, livePreview: false };

/** Heading levels get their own class so the source can size them (subtly). */
const headingLevels = HighlightStyle.define([
  { tag: t.heading1, class: "tok-h1" },
  { tag: t.heading2, class: "tok-h2" },
  { tag: t.heading3, class: "tok-h3" },
  { tag: t.heading4, class: "tok-h4" },
  { tag: t.heading5, class: "tok-h5" },
  { tag: t.heading6, class: "tok-h6" },
]);

/** A state whose lines are split on `lineSeparator` only. A lone CR or LF
 *  inside a file with the other separator stays in the line, so such a file
 *  round-trips byte for byte. `extra` carries per-document extensions such as
 *  the update listener. */
export function createEditorState(
  text: string,
  lineSeparator: LineSeparator,
  extra: Extension[] = [],
  options: EditorOptions = DEFAULT_EDITOR_OPTIONS,
): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      EditorState.lineSeparator.of(lineSeparator),
      EditorState.allowMultipleSelections.of(true),
      history(),
      // Tab never moves focus out of the editor; the Markdown keymap (Enter,
      // Backspace) comes with markdownSupport() at high precedence.
      keymap.of([
        { key: "Tab", run: listTab, shift: listShiftTab },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      markdownSupport(),
      syntaxHighlighting(classHighlighter),
      syntaxHighlighting(headingLevels),
      EditorView.lineWrapping,
      EditorView.clickAddsSelectionRange.of((e) => e.altKey && !e.shiftKey),
      drawSelection(),
      rectangularSelection({ eventFilter: (e) => e.altKey && e.shiftKey }),
      highlightActiveLine(),
      bracketMatching(),
      findExtension(),
      options.lineNumbers ? lineNumbers() : [],
      options.livePreview ? livePreview((u) => u) : [],
      ...extra,
    ],
  });
}

export function createEditorView(state: EditorState): EditorView {
  return new EditorView({ state });
}
