// The rendered pane of one document: owns its DOM, keeps the list of rendered
// top-level blocks with their source ranges, and re-renders incrementally.
//
// Incremental rendering (NFR-02): the editor's changes are collected as one
// ChangeSet. On the next render the old blocks that overlap a changed range are
// dropped, every other block is matched to a node of the new syntax tree by its
// mapped range, and only the unmatched nodes are rendered and spliced in.
// Anything that depends on the whole document (link references, footnotes,
// heading ids) falls back to a full render, or to a pass over the headings.

import type { ChangeSet, EditorState, Text } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import DOMPurify from "dompurify";
import { assignHeadingIds, fullTree, renderFootnotes, renderTop, RenderContext, topLevelBlocks, type BlockOut, type TopBlock } from "./render";

/** Edits touching more than this share of the blocks are rendered from scratch. */
export const FULL_RENDER_SHARE = 0.3;

interface Entry {
  from: number;
  to: number;
  name: string;
  /** Top-level elements of the block (none for link references and the like). */
  els: HTMLElement[];
  global: boolean;
  heading: boolean;
}

/** Counters for tests and the performance checks. */
export interface RenderStats {
  full: number;
  incremental: number;
  /** Blocks rendered since the view was created (a full render counts all of them). */
  blocks: number;
  lastMs: number;
  /** Duration of the last incremental render (0 until there was one). */
  lastIncrementalMs: number;
}

const PURIFY = {
  RETURN_DOM_FRAGMENT: true as const,
  FORBID_TAGS: ["script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "textarea", "select", "button", "link", "meta", "base", "template"],
  // `align` and `class`/`id` stay: READMEs use them.
  ADD_ATTR: ["align"],
  ALLOW_DATA_ATTR: true,
};

let hooked = false;
function installPurifyHooks(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof Element)) return;
    const style = node.getAttribute("style");
    if (style && /url\s*\(|expression\s*\(|@import|javascript:/i.test(style)) node.removeAttribute("style");
    // Links and forms inside the document can't open or post anywhere by themselves.
    if (node.tagName === "A") node.removeAttribute("target");
  });
}

function shift(el: Element, delta: number): void {
  const one = (e: Element) => {
    const f = e.getAttribute("data-from");
    if (f !== null) {
      e.setAttribute("data-from", String(+f + delta));
      e.setAttribute("data-to", String(+e.getAttribute("data-to")! + delta));
    }
  };
  one(el);
  for (const e of el.querySelectorAll("[data-from]")) one(e);
}

export class RenderedView {
  /** The scroll container. */
  readonly el: HTMLElement;
  /** The reading column inside it. */
  readonly doc: HTMLElement;
  /** Called after every successful render (Split mode re-aligns the panes here). */
  onRender?: () => void;
  readonly stats: RenderStats = { full: 0, incremental: 0, blocks: 0, lastMs: 0, lastIncrementalMs: 0 };

  private entries: Entry[] = [];
  /** `entries` that have elements, for position lookups. */
  private blocks: Entry[] = [];
  private footnotes: HTMLElement | null = null;
  private ctx: RenderContext | null = null;
  private renderedDoc: Text | null = null;
  private pending: ChangeSet | null = null;
  private forceFull = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private template = document.createElement("template");

  constructor(private readonly getState: () => EditorState) {
    installPurifyHooks();
    this.el = document.createElement("div");
    this.el.className = "rendered-pane";
    this.el.tabIndex = -1;
    this.doc = document.createElement("div");
    this.doc.className = "rendered-doc";
    this.el.append(this.doc);
    // Links in the document never navigate the window; anchors scroll within it.
    this.el.addEventListener("click", (e) => {
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute("href");
      if (href?.startsWith("#") && href.length > 1) {
        const id = decodeURIComponent(href.slice(1));
        const target = this.doc.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
        if (target) this.scrollElementToTop(target);
      }
    });
  }

  // ------------------------------------------------------------ scheduling

  /** The owner shows the pane (true) or hides it (false). Showing renders at once if the pane is behind. */
  setActive(active: boolean): void {
    this.active = active;
    if (active) this.renderNow();
    else this.cancelTimer();
  }

  /** Records an editor change; schedules a render when the pane is visible. */
  notify(changes: ChangeSet): void {
    this.pending = this.pending ? this.pending.compose(changes) : changes;
    if (this.active) this.schedule();
  }

  /** The document was replaced without a change set (setState): render from scratch next time. */
  invalidate(): void {
    this.forceFull = true;
    this.pending = null;
    if (this.active) this.schedule();
  }

  /** Debounced with the spike's adaptive delay. */
  private schedule(): void {
    this.cancelTimer();
    // The spike's adaptive delay, from what the next render will probably cost:
    // an incremental one (a full render is several times dearer).
    const cost = this.stats.lastIncrementalMs || this.stats.lastMs / 6;
    const delay = Math.min(2000, Math.max(150, cost * 3));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.renderNow();
    }, delay);
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get upToDate(): boolean {
    return !this.forceFull && this.pending === null && this.renderedDoc === this.getState().doc;
  }

  /** Brings the DOM up to date now. Returns false if the parse isn't finished (a retry is scheduled). */
  renderNow(): boolean {
    this.cancelTimer();
    const state = this.getState();
    if (!this.forceFull && this.renderedDoc === state.doc) {
      this.pending = null;
      return true;
    }
    const t0 = performance.now();
    const tree = fullTree(state);
    if (!tree) {
      if (this.active) this.timer = setTimeout(() => this.renderNow(), 100);
      return false;
    }
    const src = state.sliceDoc();
    const nodes = topLevelBlocks(tree, src);
    const incremental = !this.forceFull && this.pending !== null && this.ctx !== null && this.tryIncremental(src, tree, nodes);
    if (!incremental) this.renderFull(src, tree, nodes);
    this.renderedDoc = state.doc;
    this.pending = null;
    this.forceFull = false;
    this.stats.lastMs = performance.now() - t0;
    if (incremental) this.stats.lastIncrementalMs = this.stats.lastMs;
    this.onRender?.();
    return true;
  }

  // -------------------------------------------------------------- rendering

  private toElements(out: BlockOut): HTMLElement[] {
    let nodes: ArrayLike<Node>;
    if (out.raw) {
      nodes = DOMPurify.sanitize(out.html, PURIFY).childNodes;
    } else {
      this.template.innerHTML = out.html;
      nodes = this.template.content.childNodes;
    }
    const els: HTMLElement[] = [];
    for (const n of Array.from(nodes)) if (n instanceof HTMLElement) els.push(n);
    return els;
  }

  private entryFor(from: number, to: number, name: string, out: BlockOut): Entry {
    const els = this.toElements(out);
    if (out.range) {
      for (const el of els) {
        el.setAttribute("data-from", String(out.range.from));
        el.setAttribute("data-to", String(out.range.to));
      }
    }
    return { from, to, name, els, global: out.global, heading: out.heading };
  }

  private renderFull(src: string, tree: Tree, nodes: TopBlock[]): void {
    const ctx = new RenderContext(src, tree);
    ctx.collect();
    const entries: Entry[] = [];
    const frag = document.createDocumentFragment();
    for (const n of nodes) {
      const e = this.entryFor(n.from, n.to, n.name, renderTop(ctx, n));
      entries.push(e);
      frag.append(...e.els);
    }
    const notes = renderFootnotes(ctx);
    this.footnotes = notes ? (this.toElements(notes)[0] ?? null) : null;
    if (this.footnotes) frag.append(this.footnotes);
    this.doc.replaceChildren(frag);
    assignHeadingIds(this.doc);
    this.ctx = ctx;
    this.setEntries(entries);
    this.stats.full++;
    this.stats.blocks += nodes.length;
  }

  private setEntries(entries: Entry[]): void {
    this.entries = entries;
    this.blocks = entries.filter((e) => e.els.length > 0);
  }

  /** Returns false (and changes nothing) when a full render is needed. */
  private tryIncremental(src: string, tree: Tree, nodes: TopBlock[]): boolean {
    const changes = this.pending!;
    const old = this.entries;
    // Old blocks that overlap a changed range (old coordinates) are dropped.
    const dirty = new Set<Entry>();
    let lo = 0;
    changes.iterChangedRanges((fromA, toA) => {
      // `old` is sorted: find the first block that can overlap.
      let a = lo;
      let b = old.length;
      while (a < b) {
        const mid = (a + b) >> 1;
        if (old[mid].to < fromA) a = mid + 1;
        else b = mid;
      }
      lo = a;
      for (let i = a; i < old.length && old[i].from <= toA; i++) dirty.add(old[i]);
    });
    const kept = new Map<string, Entry>();
    for (const e of old) {
      if (dirty.has(e)) continue;
      kept.set(`${changes.mapPos(e.from, 1)}:${changes.mapPos(e.to, -1)}:${e.name}`, e);
    }
    for (const e of dirty) if (e.global) return false;

    // Match the new nodes; the rest must be rendered.
    const matched: (Entry | null)[] = nodes.map((n) => kept.get(`${n.from}:${n.to}:${n.name}`) ?? null);
    const fresh = matched.filter((m) => m === null).length;
    if (fresh === nodes.length || (nodes.length >= 10 && Math.max(fresh, dirty.size) > nodes.length * FULL_RENDER_SHARE)) return false;
    const used = new Set(matched.filter((m): m is Entry => m !== null));
    if (used.size !== matched.filter((m) => m !== null).length) return false;

    const ctx = new RenderContext(src, tree);
    ctx.refs = this.ctx!.refs;
    ctx.footnoteDefs = this.ctx!.footnoteDefs;
    ctx.footnoteOrder = this.ctx!.footnoteOrder;
    const result: Entry[] = [];
    let headings = false;
    for (let i = 0; i < nodes.length; i++) {
      const m = matched[i];
      if (m) {
        const delta = nodes[i].from - m.from;
        if (delta !== 0) for (const el of m.els) shift(el, delta);
        m.from = nodes[i].from;
        m.to = nodes[i].to;
        result.push(m);
        continue;
      }
      const out = renderTop(ctx, nodes[i]);
      if (out.global) return false;
      headings ||= out.heading;
      result.push(this.entryFor(nodes[i].from, nodes[i].to, nodes[i].name, out));
    }
    // Commit: remove the dropped blocks, insert the new ones in place.
    for (const e of old) {
      if (used.has(e)) continue;
      headings ||= e.heading;
      for (const el of e.els) el.remove();
    }
    let ref: Node | null = this.footnotes;
    for (let i = result.length - 1; i >= 0; i--) {
      const e = result[i];
      if (!e.els.length) continue;
      if (!used.has(e)) for (const el of e.els) this.doc.insertBefore(el, ref);
      ref = e.els[0];
    }
    if (headings) assignHeadingIds(this.doc);
    this.setEntries(result);
    this.stats.incremental++;
    this.stats.blocks += fresh;
    return true;
  }

  // -------------------------------------------------------------- positions

  /** Top-level rendered blocks as `[from, to]` source ranges (for tests and S06). */
  blockRanges(): { from: number; to: number }[] {
    return this.blocks.map((b) => ({ from: b.from, to: b.to }));
  }

  /** Source offset of the block at the top of the pane (binary search: bottoms increase in document order). */
  topSourcePos(): number {
    const b = this.blocks;
    if (!b.length) return 0;
    const top = this.el.getBoundingClientRect().top + 4;
    let lo = 0;
    let hi = b.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const last = b[mid].els[b[mid].els.length - 1];
      if (last.getBoundingClientRect().bottom > top) {
        found = mid;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    return found >= 0 ? b[found].from : b[b.length - 1].from;
  }

  /** The deepest rendered element whose source range contains `pos` (or the next block when `pos` is in a gap). */
  elementAt(pos: number): HTMLElement | null {
    const b = this.blocks;
    if (!b.length) return null;
    let lo = 0;
    let hi = b.length - 1;
    let i = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (b[mid].from <= pos) {
        i = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (pos > b[i].to && b[i + 1]) return b[i + 1].els[0];
    let best: HTMLElement = b[i].els[0];
    for (;;) {
      const inner = Array.from(best.querySelectorAll<HTMLElement>(":scope > [data-from], :scope > * > [data-from], :scope > * > * > [data-from]")).find(
        (el) => +el.dataset.from! <= pos && pos <= +el.dataset.to!,
      );
      if (!inner) return best;
      best = inner;
    }
  }

  scrollElementToTop(el: HTMLElement): void {
    this.el.scrollTop += el.getBoundingClientRect().top - this.el.getBoundingClientRect().top - 8;
  }

  /** Scrolls so that source offset `pos` is at the top. Returns false if nothing is rendered there. */
  scrollToPos(pos: number): boolean {
    if (pos <= 0) {
      this.el.scrollTop = 0;
      return true;
    }
    const el = this.elementAt(pos);
    if (!el) return false;
    this.scrollElementToTop(el);
    return true;
  }
}
