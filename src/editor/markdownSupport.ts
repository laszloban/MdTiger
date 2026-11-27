// The single place where Lezer Markdown extensions are listed. S04 adds the
// front-matter extension here once; the editor (this step) and the renderer
// (S04) both read it, so they always parse the same way.

import { deleteMarkupBackward, insertNewlineContinueMarkupCommand, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { styleTags, tags as t } from "@lezer/highlight";
import type { BlockContext, Line, MarkdownConfig, MarkdownExtension } from "@lezer/markdown";

/**
 * YAML front matter (FR-MD-03): `---` on the very first line up to the next
 * `---` or `...` line becomes one `FrontMatter` block. Without a closing line
 * it is not front matter (the `---` is a rule then).
 */
export const FrontMatter: MarkdownConfig = {
  defineNodes: [{ name: "FrontMatter", block: true }],
  props: [styleTags({ FrontMatter: t.meta })],
  parseBlock: [
    {
      name: "FrontMatter",
      before: "HorizontalRule",
      parse(cx: BlockContext, line: Line) {
        if (cx.lineStart !== 0 || cx.depth > 1 || line.text.trimEnd() !== "---") return false;
        // BlockContext has no look-ahead; its input is there at run time.
        const input = (cx as unknown as { input?: { length: number; read(from: number, to: number): string } }).input;
        if (!input) return false;
        const rest = input.read(0, Math.min(input.length, 65536));
        const m = /^---[ \t]*\n(?:[^\n]*\n)*?(?:---|\.\.\.)[ \t]*(?=\n|$)/.exec(rest);
        if (!m) return false;
        const end = m[0].length;
        while (cx.lineStart + line.text.length < end) if (!cx.nextLine()) break;
        const to = cx.lineStart + line.text.length;
        cx.nextLine();
        cx.addElement(cx.elt("FrontMatter", 0, to));
        return true;
      },
    },
  ],
};

const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:[ \t]*/;

/**
 * Footnotes (FR-MD-04): `[^id]` references and `[^id]: text` definitions. A
 * definition continues over following lines that are indented (two spaces, or
 * four after a blank line).
 */
export const Footnotes: MarkdownConfig = {
  defineNodes: [{ name: "FootnoteDefinition", block: true }, "FootnoteLabel", "FootnoteReference"],
  props: [styleTags({ FootnoteReference: t.link, FootnoteLabel: t.link })],
  parseBlock: [
    {
      name: "FootnoteDefinition",
      before: "LinkReference",
      parse(cx: BlockContext, line: Line) {
        if (line.indent >= 4) return false;
        const m = FOOTNOTE_DEF.exec(line.text.slice(line.pos));
        if (!m) return false;
        const start = cx.lineStart + line.pos;
        const labelEnd = start + m[0].indexOf("]") + 1;
        const textFrom = start + m[0].length;
        let text = line.text.slice(line.pos + m[0].length);
        let end = cx.lineStart + line.text.length;
        const skipped: string[] = [];
        while (cx.nextLine()) {
          if (line.next < 0) {
            skipped.push(line.text);
            continue;
          }
          if (line.indent < (skipped.length ? 4 : 2)) break;
          // Whole lines, so that offsets stay exact (a break counts one).
          text += "\n" + skipped.map((x) => x + "\n").join("") + line.text;
          end = cx.lineStart + line.text.length;
          skipped.length = 0;
        }
        cx.addElement(
          cx.elt("FootnoteDefinition", start, end, [
            cx.elt("FootnoteLabel", start, labelEnd),
            ...cx.parser.parseInline(text, textFrom),
          ]),
        );
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: "FootnoteReference",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== 91 /* [ */ || cx.char(pos + 1) !== 94 /* ^ */) return -1;
        const m = /^\[\^([^\]\s]+)\]/.exec(cx.slice(pos, Math.min(cx.end, pos + 200)));
        if (!m) return -1;
        // `[^id]:` at the start of a block is a definition, handled above.
        return cx.addElement(cx.elt("FootnoteReference", pos, pos + m[0].length));
      },
    },
  ],
};

/** Extra Lezer Markdown extensions (GFM itself comes with `markdownLanguage`). */
export const lezerMarkdownExtensions: MarkdownExtension[] = [FrontMatter, Footnotes];

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
