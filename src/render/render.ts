// Markdown → HTML for one top-level block at a time, from the editor's own
// Lezer tree (plan §3: one parser). Every block element carries `data-from` /
// `data-to` source offsets, and so do the inline elements later steps need
// (links, images, task markers, table cells).
//
// The functions here are pure (a tree and the text in, an HTML string out).
// `view.ts` turns the strings into DOM (through DOMPurify when the block
// contains raw HTML) and splices them in incrementally.

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** GitHub-style heading anchor: lower case, punctuation dropped except `-` and `_`, spaces → `-`. Letters keep their accents. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Gives the headings of `root` GitHub-style ids: duplicates get `-1`, `-2`, … */
export function assignHeadingIds(root: ParentNode): void {
  const seen = new Map<string, number>();
  for (const h of root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")) {
    const base = slugify(h.textContent ?? "");
    const n = seen.get(base);
    seen.set(base, (n ?? -1) + 1);
    h.id = n === undefined ? base : `${base}-${n + 1}`;
  }
}

/** What a link or image target may be: web links, mail, anchors and relative paths. Anything else has no `href`. */
export function safeUrl(url: string): string | null {
  const u = url.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^(https?:|mailto:|tel:)/i.test(u)) return null;
  return u;
}

/** Per-render state shared by all blocks: link references and footnotes. */
export class RenderContext {
  refs = new Map<string, { url: string; title?: string }>();
  /** Footnote definitions by label. */
  footnoteDefs = new Map<string, SyntaxNode>();
  /** Labels in the order of their first reference (the footnote number). */
  footnoteOrder: string[] = [];
  private refCounts = new Map<string, number>();

  constructor(
    readonly src: string,
    readonly tree: Tree,
  ) {}

  /** The footnote's number, and which reference this is (1 for the first). */
  noteRef(label: string): { n: number; k: number } {
    let i = this.footnoteOrder.indexOf(label);
    if (i < 0) i = this.footnoteOrder.push(label) - 1;
    const k = (this.refCounts.get(label) ?? 0) + 1;
    this.refCounts.set(label, k);
    return { n: i + 1, k };
  }

  /** Collects the document-wide things blocks depend on. Run before a full render. */
  collect(): void {
    const { src } = this;
    this.tree.iterate({
      enter: (n) => {
        if (n.name === "LinkReference") {
          const node = n.node;
          const label = node.getChild("LinkLabel");
          const url = node.getChild("URL");
          const title = node.getChild("LinkTitle");
          if (label && url) {
            const key = src.slice(label.from + 1, label.to - 1).trim().toLowerCase();
            if (!this.refs.has(key)) {
              this.refs.set(key, { url: src.slice(url.from, url.to).replace(/^<|>$/g, ""), title: title ? src.slice(title.from + 1, title.to - 1) : undefined });
            }
          }
          return false;
        }
        if (n.name === "FootnoteDefinition") {
          const label = n.node.getChild("FootnoteLabel");
          if (label) {
            const key = src.slice(label.from + 2, label.to - 1);
            if (!this.footnoteDefs.has(key)) this.footnoteDefs.set(key, n.node);
          }
          return false;
        }
        return undefined;
      },
    });
  }
}

export interface BlockOut {
  html: string;
  /** Contains raw HTML from the document: must go through DOMPurify. */
  raw: boolean;
  /** Depends on or defines document-wide state (link references, footnotes): an edit here means a full render. */
  global: boolean;
  /** Contains a heading (ids are reassigned after it changes). */
  heading: boolean;
  /** For a group of blocks: the source range its elements carry (the raw HTML has no offsets of its own). */
  range?: { from: number; to: number };
}

/** The tree of a state, parsed fully (the editor parses lazily); null while the parse is still unfinished. */
export function fullTree(state: EditorState, timeoutMs = 4000): Tree | null {
  const tree = ensureSyntaxTree(state, state.doc.length, timeoutMs);
  if (tree) return tree;
  return null;
}

/** The partially parsed tree, for callers that cannot wait. */
export function currentTree(state: EditorState): Tree {
  return syntaxTree(state);
}

/** The blocks that are rendered as units: the children of the document node. */
export function topLevelNodes(tree: Tree): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = tree.topNode.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

/** A unit of rendering: one top-level node, or a run of nodes that one HTML element spans. */
export interface TopBlock {
  from: number;
  to: number;
  name: string;
  nodes: SyntaxNode[];
}

/** Tags READMEs open in one HTML block and close in another, with Markdown between. */
const WRAPPER = /^<(details|div|center|section)\b/i;
const GROUP_LOOKAHEAD = 500;

/** Net count of `<tag …>` minus `</tag>` in a piece of HTML. */
function tagBalance(html: string, tag: string): number {
  const opens = html.match(new RegExp(`<${tag}\\b[^>]*>`, "gi"))?.length ?? 0;
  const closes = html.match(new RegExp(`</${tag}\\s*>`, "gi"))?.length ?? 0;
  return opens - closes;
}

/**
 * The top-level blocks of a tree. An HTML block that opens `<details>` or
 * `<div>` without closing it, together with everything up to the block that
 * closes it, forms one `HTMLGroup`: it has to be sanitised as one piece, or
 * the element would be closed early and its content would spill out.
 */
export function topLevelBlocks(tree: Tree, src: string): TopBlock[] {
  const nodes = topLevelNodes(tree);
  const out: TopBlock[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const m = n.name === "HTMLBlock" ? WRAPPER.exec(src.slice(n.from, n.to)) : null;
    if (m) {
      const tag = m[1].toLowerCase();
      let balance = tagBalance(src.slice(n.from, n.to), tag);
      let j = i;
      while (balance > 0 && j + 1 < nodes.length && j - i < GROUP_LOOKAHEAD) {
        j++;
        if (nodes[j].name === "HTMLBlock") balance += tagBalance(src.slice(nodes[j].from, nodes[j].to), tag);
      }
      if (j > i && balance <= 0) {
        out.push({ from: n.from, to: nodes[j].to, name: "HTMLGroup", nodes: nodes.slice(i, j + 1) });
        i = j;
        continue;
      }
    }
    out.push({ from: n.from, to: n.to, name: n.name, nodes: [n] });
  }
  return out;
}

/** Renders a top-level block (or group). */
export function renderTop(ctx: RenderContext, tb: TopBlock): BlockOut {
  if (tb.nodes.length === 1 && tb.name !== "HTMLGroup") return renderBlock(ctx, tb.nodes[0]);
  const out: BlockOut = { html: "", raw: true, global: false, heading: false, range: { from: tb.from, to: tb.to } };
  for (const n of tb.nodes) {
    const part = renderBlock(ctx, n, true);
    out.html += part.html;
    out.global ||= part.global;
    out.heading ||= part.heading;
  }
  return out;
}

export function renderBlock(ctx: RenderContext, top: SyntaxNode, bare = false): BlockOut {
  const src = ctx.src;
  const out: BlockOut = { html: "", raw: false, global: false, heading: false };
  const slice = (n: { from: number; to: number }) => src.slice(n.from, n.to);
  const pos = (n: { from: number; to: number }) => ` data-from="${n.from}" data-to="${n.to}"`;

  function marksOf(n: SyntaxNode, name: string): SyntaxNode[] {
    const r: SyntaxNode[] = [];
    for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === name) r.push(c);
    return r;
  }

  // ---------- inline ----------

  /** The inline content of `node` between `from` and `to`. */
  function inline(node: SyntaxNode, from = node.from, to = node.to): string {
    let html = "";
    let at = from;
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.to <= from || c.from >= to) continue;
      if (c.from > at) html += esc(src.slice(at, c.from));
      html += inlineNode(c);
      at = Math.max(at, c.to);
    }
    if (at < to) html += esc(src.slice(at, to));
    return html;
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
      const text = src.slice(labelFrom, labelTo);
      const key = (lbl ? slice(lbl).slice(1, -1) : text).trim().toLowerCase() || text.trim().toLowerCase();
      const ref = ctx.refs.get(key);
      if (ref) {
        url = ref.url;
        title = ref.title;
        out.global = true;
      }
    }
    return { labelFrom, labelTo, url, title };
  }

  function anchor(href: string, label: string, n: { from: number; to: number }, title?: string): string {
    const safe = safeUrl(href);
    return `<a${safe === null ? "" : ` href="${esc(safe)}"`}${pos(n)}${title ? ` title="${esc(title)}"` : ""}>${label}</a>`;
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
        if (p.url === null) return esc(slice(n));
        return anchor(p.url, inline(n, p.labelFrom, p.labelTo), n, p.title);
      }
      case "Image": {
        const p = linkParts(n);
        if (p.url === null) return esc(slice(n));
        const alt = src.slice(p.labelFrom, p.labelTo);
        // S05 replaces the placeholder with the real image.
        return `<span class="image-placeholder"${pos(n)} data-src="${esc(p.url)}" title="${esc(p.url)}">${esc(alt || p.url)}</span>`;
      }
      case "Autolink": {
        const u = n.getChild("URL");
        const url = u ? slice(u) : slice(n).slice(1, -1);
        const full = /^[^@\s]+@[^@\s]+$/.test(url) && !/^mailto:/i.test(url) ? "mailto:" + url : url;
        return anchor(full, esc(url), n);
      }
      case "URL": {
        // GFM bare URL
        const url = slice(n);
        return anchor(/^www\./i.test(url) ? "http://" + url : url, esc(url), n);
      }
      case "FootnoteReference": {
        const label = src.slice(n.from + 2, n.to - 1);
        if (!ctx.footnoteDefs.has(label)) return esc(slice(n));
        out.global = true;
        const { n: num, k } = ctx.noteRef(label);
        const id = k === 1 ? `fnref-${label}` : `fnref-${label}-${k}`;
        return `<sup class="footnote-ref"><a href="#fn-${esc(label)}" id="${esc(id)}"${pos(n)}>${num}</a></sup>`;
      }
      case "Escape":
        return esc(slice(n).slice(1));
      case "Entity":
        return slice(n);
      case "HardBreak":
        return "<br>";
      case "HTMLTag":
        out.raw = true;
        return slice(n);
      case "Comment":
        // An HTML comment is not shown.
        return "";
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

  // ---------- blocks ----------

  function children(n: SyntaxNode): string {
    let html = "";
    for (let c = n.firstChild; c; c = c.nextSibling) html += block(c);
    return html;
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
    out.heading = true;
    // The id is assigned later (assignHeadingIds), when the whole document is known.
    return `<h${level}${pos(n)}>${inline(n, from, to).trim()}</h${level}>\n`;
  }

  function codeText(n: SyntaxNode): string {
    if (n.name === "FencedCode") {
      const texts = marksOf(n, "CodeText");
      if (!texts.length) return "";
      let code = src.slice(texts[0].from, texts[texts.length - 1].to);
      // Quote markers of an enclosing blockquote sit inside the span: cut them out.
      const quotes = marksOf(n, "QuoteMark").filter((q) => q.from >= texts[0].from && q.to <= texts[texts.length - 1].to);
      for (let i = quotes.length - 1; i >= 0; i--) {
        const q = quotes[i];
        const end = src[q.to] === " " ? q.to + 1 : q.to;
        code = code.slice(0, q.from - texts[0].from) + code.slice(end - texts[0].from);
      }
      return code;
    }
    return slice(n)
      .split("\n")
      .map((l) => l.replace(/^( {4}|\t)/, ""))
      .join("\n");
  }

  function codeBlock(n: SyntaxNode): string {
    const info = n.getChild("CodeInfo");
    const lang = info ? slice(info).trim().split(/\s+/)[0].toLowerCase() : "";
    return `<pre${pos(n)}${lang ? ` data-lang="${esc(lang)}"` : ""}><code>${esc(codeText(n))}</code></pre>\n`;
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
    let html = `<${ordered ? "ol" : "ul"}${start}${pos(n)}>\n`;
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
          // Disabled for now: S05 makes the checkbox work.
          body += `<input type="checkbox" class="task-box" disabled${pos(tm)}${checked ? " checked" : ""}> ${inline(c, tm.to, c.to).trim()}`;
        } else if (c.name === "Paragraph" && tight) {
          body += inline(c).trim();
        } else {
          body += block(c);
        }
      }
      html += `<li${isTask ? ' class="task-list-item"' : ""}${pos(li)}>${body}</li>\n`;
    }
    return html + `</${ordered ? "ol" : "ul"}>\n`;
  }

  function table(n: SyntaxNode): string {
    const header = n.getChild("TableHeader");
    // Alignment comes from the delimiter row: the line right after the header.
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
    const cols = Math.max(aligns.length, 1);
    // Tolerant (FR-MD-02, as GitHub): short rows are padded, extra cells dropped.
    const row = (r: SyntaxNode, tag: "th" | "td") => {
      const cells = marksOf(r, "TableCell");
      let html = "<tr>";
      for (let i = 0; i < cols; i++) {
        const c = cells[i];
        const a = aligns[i] ? ` style="text-align:${aligns[i]}"` : "";
        html += `<${tag}${a}${c ? pos(c) : ""}>${c ? inline(c).trim() : ""}</${tag}>`;
      }
      return html + "</tr>\n";
    };
    let html = `<div class="table-wrap"${pos(n)}><table>\n`;
    if (header) html += `<thead>${row(header, "th")}</thead>\n`;
    const rows = marksOf(n, "TableRow");
    if (rows.length) html += `<tbody>\n${rows.map((r) => row(r, "td")).join("")}</tbody>\n`;
    return html + "</table></div>\n";
  }

  function frontMatter(n: SyntaxNode): string {
    const text = slice(n);
    const body = text.replace(/^---[^\n]*\n?/, "").replace(/\n?(---|\.\.\.)[ \t]*$/, "");
    return `<details class="front-matter"${pos(n)}><summary>Front matter</summary><pre><code>${esc(body)}</code></pre></details>\n`;
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
      case "FrontMatter":
        return frontMatter(n);
      case "HTMLBlock":
        out.raw = true;
        // Inside a group the HTML must stay unwrapped, so that its tags pair up across blocks.
        if (bare) return slice(n) + "\n";
        return `<div class="html-block"${pos(n)}>${slice(n)}</div>\n`;
      case "LinkReference":
      case "FootnoteDefinition":
        out.global = true;
        return "";
      case "CommentBlock":
      case "ProcessingInstructionBlock":
      case "QuoteMark":
        return "";
      default:
        // Unknown container: render its children, or its text.
        return n.firstChild ? children(n) : `<p${pos(n)}>${esc(slice(n))}</p>\n`;
    }
  }

  out.html = block(top);
  return out;
}

/** The footnotes section (GitHub style), in order of first reference; null when there is none. */
export function renderFootnotes(ctx: RenderContext): BlockOut | null {
  if (!ctx.footnoteOrder.length) return null;
  const out: BlockOut = { html: `<section class="footnotes"><hr><ol>\n`, raw: false, global: true, heading: false };
  for (const label of ctx.footnoteOrder) {
    const def = ctx.footnoteDefs.get(label)!;
    const labelNode = def.getChild("FootnoteLabel")!;
    // Reuse the block renderer on a paragraph-like view of the definition's text.
    const inner = renderBlock(ctx, fakeParagraph(def, labelNode.to));
    out.raw ||= inner.raw;
    const backs = `<a class="footnote-back" href="#fnref-${esc(label)}">↩</a>`;
    out.html += `<li id="fn-${esc(label)}" data-from="${def.from}" data-to="${def.to}">${inner.html.replace(/<\/p>\n?$/, ` ${backs}</p>`)}</li>\n`;
  }
  out.html += `</ol></section>\n`;
  return out;
}

/** A node-like view of a footnote definition that renders as a paragraph starting after its label. */
function fakeParagraph(def: SyntaxNode, from: number): SyntaxNode {
  const proxy = Object.create(def) as SyntaxNode;
  Object.defineProperty(proxy, "name", { value: "Paragraph" });
  Object.defineProperty(proxy, "from", { value: from });
  return proxy;
}
