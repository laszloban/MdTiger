// Renders Markdown to HTML from the same Lezer parser CodeMirror uses in the
// editor (NFR-09 b: one parser). Every block element carries data-from /
// data-to source offsets so the rendered view can be mapped back to the source
// (outline jumps, scroll sync, checkbox toggling, later live preview).

import { markdownLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export interface HeadingInfo {
  level: number;
  /** Heading text exactly as written (inline markup stripped). */
  text: string;
  id: string;
  from: number;
  to: number;
}

export interface RenderResult {
  html: string;
  headings: HeadingInfo[];
  hasMermaid: boolean;
  hasRawHtml: boolean;
  frontMatter: string | null;
}

export interface RenderOptions {
  /** Turns an image/link target that isn't http(s) into a loadable URL. */
  resolveLocal: (rel: string) => string;
}

const parser = markdownLanguage.parser;

/**
 * Headings only, from the editor's own incremental syntax tree: cheap enough
 * to run on every edit, so Source mode never needs a full render (S8).
 * Inline markup is stripped with a simple pattern here; the full renderer
 * strips it exactly.
 */
export function headingsFromState(state: EditorState): HeadingInfo[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const out: HeadingInfo[] = [];
  const slugCount = new Map<string, number>();
  tree.iterate({
    enter(n) {
      const m = /^(ATX|Setext)Heading(\d)$/.exec(n.name);
      if (m) {
        let raw = state.sliceDoc(n.from, n.to);
        raw = m[1] === "ATX" ? raw.replace(/^#+[ \t]*/, "").replace(/[ \t]+#+[ \t]*$/, "") : raw.split("\n")[0];
        const text = raw
          .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/(\*\*|__|\*|_|~~|`)/g, "")
          .trim();
        let id = slugify(text);
        const seen = slugCount.get(id);
        slugCount.set(id, (seen ?? -1) + 1);
        if (seen !== undefined) id = `${id}-${seen + 1}`;
        out.push({ level: +m[2], text, id, from: n.from, to: n.to });
        return false;
      }
      // Only descend into containers that can hold headings.
      return n.name === "Document" || n.name === "Blockquote" || n.name === "BulletList" || n.name === "OrderedList" || n.name === "ListItem";
    },
  });
  return out;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** GitHub-style heading anchor. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Detects YAML front matter and blanks it out (keeping offsets) for the parser. */
function splitFrontMatter(text: string): { parseText: string; frontMatter: string | null } {
  const m = /^---\r?\n([\s\S]*?)\r?\n(---|\.\.\.)\r?\n?/.exec(text);
  if (!m) return { parseText: text, frontMatter: null };
  const blanked = m[0].replace(/[^\n]/g, " ");
  return { parseText: blanked + text.slice(m[0].length), frontMatter: m[1] };
}

export function renderMarkdown(text: string, opts: RenderOptions): RenderResult {
  const { parseText, frontMatter } = splitFrontMatter(text);
  const tree = parser.parse(parseText);
  const src = parseText;
  const headings: HeadingInfo[] = [];
  const slugCount = new Map<string, number>();
  const refs = new Map<string, { url: string; title?: string }>();
  let hasMermaid = false;
  let hasRawHtml = false;

  const slice = (n: { from: number; to: number }) => src.slice(n.from, n.to);
  const pos = (n: SyntaxNode) => ` data-from="${n.from}" data-to="${n.to}"`;

  // Pass 1: link reference definitions.
  tree.iterate({
    enter(n) {
      if (n.name !== "LinkReference") return;
      const node = n.node;
      const label = node.getChild("LinkLabel");
      const url = node.getChild("URL");
      const title = node.getChild("LinkTitle");
      if (label && url) {
        const key = slice(label).slice(1, -1).trim().toLowerCase();
        refs.set(key, { url: slice(url).replace(/^<|>$/g, ""), title: title ? slice(title).slice(1, -1) : undefined });
      }
      return false;
    },
  });

  function href(url: string): string {
    if (/^(https?:|mailto:|#)/i.test(url)) return url;
    return opts.resolveLocal(url);
  }

  // ---------- inline ----------

  /** Renders the inline content of `node` between `from` and `to`. */
  function inline(node: SyntaxNode, from = node.from, to = node.to): string {
    let out = "";
    let at = from;
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.to <= from || c.from >= to) continue;
      if (c.from > at) out += escText(src.slice(at, c.from));
      out += inlineNode(c);
      at = Math.max(at, c.to);
    }
    if (at < to) out += escText(src.slice(at, to));
    return out;
  }

  /** Plain text: escape; inside paragraphs newlines become soft breaks. */
  function escText(s: string): string {
    return esc(s);
  }

  function marksOf(n: SyntaxNode, name: string): SyntaxNode[] {
    const r: SyntaxNode[] = [];
    for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === name) r.push(c);
    return r;
  }

  function linkParts(n: SyntaxNode) {
    const marks = marksOf(n, "LinkMark");
    const labelFrom = marks[0]?.to ?? n.from;
    const labelTo = marks[1]?.from ?? n.to;
    const urlNode = n.getChild("URL");
    const titleNode = n.getChild("LinkTitle");
    let url: string | null = urlNode ? slice(urlNode).replace(/^<|>$/g, "") : null;
    let title: string | undefined = titleNode ? slice(titleNode).slice(1, -1) : undefined;
    if (url === null) {
      // Reference link: [text][label], [text][] or [text]
      const lbl = n.getChild("LinkLabel");
      const key = (lbl ? slice(lbl).slice(1, -1) : src.slice(labelFrom, labelTo)).trim().toLowerCase();
      const ref = refs.get(key || src.slice(labelFrom, labelTo).trim().toLowerCase());
      if (ref) {
        url = ref.url;
        title = ref.title;
      }
    }
    return { labelFrom, labelTo, url, title };
  }

  function inlineNode(n: SyntaxNode): string {
    switch (n.name) {
      case "Emphasis":
        return `<em>${inline(n, n.firstChild!.to, n.lastChild!.from)}</em>`;
      case "StrongEmphasis":
        return `<strong>${inline(n, n.firstChild!.to, n.lastChild!.from)}</strong>`;
      case "Strikethrough":
        return `<del>${inline(n, n.firstChild!.to, n.lastChild!.from)}</del>`;
      case "InlineCode": {
        const marks = marksOf(n, "CodeMark");
        const inner = src.slice(marks[0]?.to ?? n.from, marks[1]?.from ?? n.to);
        let trimmed = /^ .* $/.test(inner) && inner.trim() ? inner.slice(1, -1) : inner;
        // GFM: inside a table cell, \| in a code span is a literal pipe.
        if (n.parent?.name === "TableCell") trimmed = trimmed.replace(/\\\|/g, "|");
        return `<code>${esc(trimmed.replace(/\n/g, " "))}</code>`;
      }
      case "Link": {
        const p = linkParts(n);
        const label = inline(n, p.labelFrom, p.labelTo);
        if (p.url === null) return esc(slice(n));
        return `<a href="${esc(href(p.url))}"${p.title ? ` title="${esc(p.title)}"` : ""}>${label}</a>`;
      }
      case "Image": {
        const p = linkParts(n);
        if (p.url === null) return esc(slice(n));
        const alt = src.slice(p.labelFrom, p.labelTo);
        const remote = /^https?:/i.test(p.url);
        return `<img src="${esc(href(p.url))}" alt="${esc(alt)}"${p.title ? ` title="${esc(p.title)}"` : ""}${remote ? ' data-remote="1"' : ""} loading="lazy">`;
      }
      case "Autolink": {
        const u = n.getChild("URL");
        const url = u ? slice(u) : slice(n).slice(1, -1);
        const full = /^[^@\s]+@[^@\s]+$/.test(url) && !/^mailto:/i.test(url) ? "mailto:" + url : url;
        return `<a href="${esc(full)}">${esc(url)}</a>`;
      }
      case "URL": {
        // GFM bare URL
        const url = slice(n);
        const full = /^www\./i.test(url) ? "http://" + url : url;
        return `<a href="${esc(full)}">${esc(url)}</a>`;
      }
      case "Escape":
        return esc(slice(n).slice(1));
      case "Entity":
        return slice(n);
      case "HardBreak":
        return "<br>";
      case "HTMLTag":
      case "Comment":
        hasRawHtml = true;
        return slice(n);
      case "QuoteMark":
      case "ListMark":
      case "HeaderMark":
      case "EmphasisMark":
      case "CodeMark":
      case "LinkMark":
        return "";
      default:
        return inline(n);
    }
  }

  function plainText(n: SyntaxNode, from = n.from, to = n.to): string {
    const tmp = document.createElement("div");
    tmp.innerHTML = inline(n, from, to);
    return tmp.textContent ?? "";
  }

  // ---------- blocks ----------

  function children(n: SyntaxNode): string {
    let out = "";
    for (let c = n.firstChild; c; c = c.nextSibling) out += block(c);
    return out;
  }

  function heading(n: SyntaxNode, level: number): string {
    const marks = marksOf(n, "HeaderMark");
    let from = n.from;
    let to = n.to;
    if (n.name.startsWith("ATX")) {
      if (marks[0]) from = marks[0].to;
      if (marks.length > 1) to = marks[marks.length - 1].from;
    } else if (marks.length) {
      to = marks[marks.length - 1].from; // setext underline
    }
    const inner = inline(n, from, to).trim();
    const plain = plainText(n, from, to).trim();
    let id = slugify(plain);
    const seen = slugCount.get(id);
    slugCount.set(id, (seen ?? -1) + 1);
    if (seen !== undefined) id = `${id}-${seen + 1}`;
    headings.push({ level, text: plain, id, from: n.from, to: n.to });
    return `<h${level} id="${esc(id)}"${pos(n)}>${inner}</h${level}>\n`;
  }

  function codeBlock(n: SyntaxNode): string {
    const info = n.getChild("CodeInfo");
    const lang = info ? slice(info).trim().split(/\s+/)[0].toLowerCase() : "";
    let code = "";
    if (n.name === "FencedCode") {
      const texts = marksOf(n, "CodeText");
      if (texts.length) {
        // CodeText spans from the first to the last content line, including
        // any indentation/quote prefixes in between; take it verbatim.
        code = src.slice(texts[0].from, texts[texts.length - 1].to);
      }
    } else {
      code = slice(n)
        .split("\n")
        .map((l) => l.replace(/^( {4}|\t)/, ""))
        .join("\n");
    }
    if (lang === "mermaid") {
      hasMermaid = true;
      return `<div class="mermaid-block"${pos(n)} data-state="pending"><pre class="mermaid-src"><code>${esc(code)}</code></pre></div>\n`;
    }
    return `<div class="code-block"${pos(n)}>${lang ? `<span class="code-lang">${esc(lang)}</span>` : ""}<button class="copy-btn" type="button" tabindex="-1" title="Copy code">Copy</button><pre${lang ? ` data-lang="${esc(lang)}"` : ""}><code>${esc(code)}</code></pre></div>\n`;
  }

  function list(n: SyntaxNode): string {
    const ordered = n.name === "OrderedList";
    let start = "";
    if (ordered) {
      const first = n.firstChild?.getChild("ListMark");
      const num = first ? parseInt(slice(first), 10) : 1;
      if (num !== 1) start = ` start="${num}"`;
    }
    // Tight list: no blank line between items.
    const tight = !/\n[ \t\r]*\n[ \t\r]*\S/.test(src.slice(n.from, n.to).replace(/\n+$/, ""));
    let out = `<${ordered ? "ol" : "ul"}${start}${pos(n)}>\n`;
    for (let li = n.firstChild; li; li = li.nextSibling) {
      if (li.name !== "ListItem") continue;
      let body = "";
      let isTask = false;
      for (let c = li.firstChild; c; c = c.nextSibling) {
        if (c.name === "ListMark") continue;
        if (c.name === "Task") {
          isTask = true;
          const tm = c.getChild("TaskMarker")!;
          const checked = /\[[xX]\]/.test(slice(tm));
          body += `<input type="checkbox" class="task-box" data-pos="${tm.from + 1}"${checked ? " checked" : ""}> ${inline(c, tm.to, c.to).trim()}`;
        } else if (c.name === "Paragraph" && tight) {
          body += inline(c).trim();
        } else {
          body += block(c);
        }
      }
      out += `<li${isTask ? ' class="task"' : ""}${pos(li)}>${body}</li>\n`;
    }
    return out + `</${ordered ? "ol" : "ul"}>\n`;
  }

  function table(n: SyntaxNode): string {
    const header = n.getChild("TableHeader");
    // Alignment from the delimiter row: the line right after the header.
    const afterHeader = header ? src.indexOf("\n", header.to) : -1;
    const delimEnd = afterHeader >= 0 ? src.indexOf("\n", afterHeader + 1) : -1;
    const delimLine = afterHeader >= 0 ? src.slice(afterHeader + 1, delimEnd < 0 ? undefined : delimEnd) : "";
    const aligns = delimLine
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => {
        const t = c.trim();
        if (t.startsWith(":") && t.endsWith(":")) return "center";
        if (t.endsWith(":")) return "right";
        if (t.startsWith(":")) return "left";
        return "";
      });
    const cols = aligns.length;
    const row = (r: SyntaxNode, tag: "th" | "td") => {
      const cells = marksOf(r, "TableCell");
      let out = "<tr>";
      for (let i = 0; i < Math.max(cols, 1); i++) {
        const c = cells[i];
        const a = aligns[i] ? ` style="text-align:${aligns[i]}"` : "";
        out += `<${tag}${a}>${c ? inline(c).trim() : ""}</${tag}>`;
      }
      return out + "</tr>\n";
    };
    let out = `<div class="table-wrap"${pos(n)}><table>\n`;
    if (header) out += `<thead>${row(header, "th")}</thead>\n`;
    const rows = marksOf(n, "TableRow");
    if (rows.length) out += `<tbody>\n${rows.map((r) => row(r, "td")).join("")}</tbody>\n`;
    return out + "</table></div>\n";
  }

  function block(n: SyntaxNode): string {
    const m = /^(ATX|Setext)Heading(\d)$/.exec(n.name);
    if (m) return heading(n, +m[2]);
    switch (n.name) {
      case "Paragraph":
        return `<p${pos(n)}>${inline(n).trim()}</p>\n`;
      case "FencedCode":
      case "CodeBlock":
        return codeBlock(n);
      case "BulletList":
      case "OrderedList":
        return list(n);
      case "Blockquote":
        return `<blockquote${pos(n)}>\n${children(n)}</blockquote>\n`;
      case "HorizontalRule":
        return `<hr${pos(n)}>\n`;
      case "Table":
        return table(n);
      case "HTMLBlock":
        hasRawHtml = true;
        return `<div class="html-block"${pos(n)}>${slice(n)}</div>\n`;
      case "CommentBlock":
      case "ProcessingInstructionBlock":
      case "LinkReference":
      case "QuoteMark":
        return "";
      default:
        // Unknown container: render its children, or its text.
        return n.firstChild ? children(n) : `<p${pos(n)}>${esc(slice(n))}</p>\n`;
    }
  }

  let html = children(tree.topNode);
  if (frontMatter !== null) {
    html = `<details class="front-matter"><summary>Front matter</summary><pre><code>${esc(frontMatter)}</code></pre></details>\n` + html;
  }
  return { html, headings, hasMermaid, hasRawHtml, frontMatter };
}
