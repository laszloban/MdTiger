// Syntax highlighting for code blocks in the rendered view, using the same
// Lezer language packages CodeMirror uses in the source editor. Languages are
// loaded on demand, and blocks are highlighted only when they come near the
// visible area, so a document with thousands of code blocks never blocks the
// page (S8).

import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import type { Parser } from "@lezer/common";

const parsers = new Map<string, Promise<Parser | null>>();

function parserFor(lang: string): Promise<Parser | null> {
  let p = parsers.get(lang);
  if (!p) {
    const desc = LanguageDescription.matchLanguageName(languages, lang, true);
    p = desc ? desc.load().then((s) => s.language.parser).catch(() => null) : Promise.resolve(null);
    parsers.set(lang, p);
  }
  return p;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function highlightOne(pre: HTMLPreElement): Promise<void> {
  if (pre.dataset.hl) return;
  pre.dataset.hl = "1";
  const parser = await parserFor(pre.dataset.lang!);
  if (!parser || !pre.isConnected) return;
  const code = pre.textContent ?? "";
  let html = "";
  highlightCode(
    code,
    parser.parse(code),
    classHighlighter,
    (text, classes) => (html += classes ? `<span class="${classes}">${esc(text)}</span>` : esc(text)),
    () => (html += "\n"),
  );
  pre.firstElementChild!.innerHTML = html;
}

let observer: IntersectionObserver | null = null;

/** Highlights code blocks in `root` as they come within ~1000px of `scroller`'s viewport. */
export function highlightWhenVisible(root: HTMLElement, scroller: HTMLElement): void {
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer?.unobserve(e.target);
        void highlightOne(e.target as HTMLPreElement);
      }
    },
    { root: scroller, rootMargin: "1000px 0px" },
  );
  root.querySelectorAll<HTMLPreElement>("pre[data-lang]:not([data-hl])").forEach((p) => observer!.observe(p));
}
