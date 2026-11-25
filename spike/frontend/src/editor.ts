import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, bracketMatching } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { livePreview } from "./livePreview";

export const livePreviewSlot = new Compartment();

/** Ctrl+H: open the search panel and put the cursor in the replace field. */
function openReplace(view: EditorView): boolean {
  openSearchPanel(view);
  requestAnimationFrame(() => {
    const field = view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]");
    field?.focus();
    field?.select();
  });
  return true;
}

export function createEditorState(
  text: string,
  lineSeparator: string,
  onChange: (view: EditorView) => void,
  resolve: (url: string) => string,
): EditorState {
  const extensions: Extension[] = [
    // Keep the file's own line endings: CodeMirror joins lines with this
    // separator in sliceDoc(), which is what gets saved (FR-FILE-03/05).
    EditorState.lineSeparator.of(lineSeparator),
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(classHighlighter),
    EditorView.lineWrapping,
    keymap.of([
      { key: "Mod-h", run: openReplace, preventDefault: true },
      ...searchKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    livePreviewSlot.of([]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u.view);
    }),
  ];
  void resolve;
  return EditorState.create({ doc: text, extensions });
}

export function setLivePreview(view: EditorView, on: boolean, resolve: (url: string) => string) {
  view.dispatch({ effects: livePreviewSlot.reconfigure(on ? livePreview(resolve) : []) });
}

/** Detects the dominant line separator, so saving keeps it. */
export function detectLineSeparator(text: string): string {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  return crlf > lf ? "\r\n" : "\n";
}
