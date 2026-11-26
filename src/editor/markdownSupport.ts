// The single place where Lezer Markdown extensions are listed. S04 adds the
// front-matter extension here once; the editor (this step) and the renderer
// (S04) both read it, so they always parse the same way.

import { deleteMarkupBackward, insertNewlineContinueMarkupCommand, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { MarkdownExtension } from "@lezer/markdown";

/** Extra Lezer Markdown extensions (GFM itself comes with `markdownLanguage`). */
export const lezerMarkdownExtensions: MarkdownExtension[] = [];

/** The Markdown language with nested code-language parsers that load lazily:
 *  a language's parser is fetched when a fenced block of that language is
 *  parsed (i.e. visible). */
export function markdownSupport(): Extension {
  return [
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      extensions: lezerMarkdownExtensions,
      addKeymap: false,
    }),
    // Enter continues a list, Enter on an empty item ends it, Backspace at a
    // marker removes it. `nonTightLists: false`: without it, Enter on the empty
    // second item of a two-item list makes the list loose instead of ending it.
    Prec.high(
      keymap.of([
        { key: "Enter", run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
        { key: "Backspace", run: deleteMarkupBackward },
      ]),
    ),
  ];
}
