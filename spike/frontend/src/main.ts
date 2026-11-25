import "./styles.css";
import DOMPurify from "dompurify";
import { EditorView } from "@codemirror/view";
import { EditorSelection, Text } from "@codemirror/state";
import { createEditorState, detectLineSeparator, setLivePreview } from "./editor";
import { headingsFromState, renderMarkdown, type HeadingInfo } from "./render";
import { highlightWhenVisible } from "./highlight";
import { renderMermaidBlocks } from "./mermaid";
import { detectHost } from "./host";
import { resolvePath, type Host } from "./host/host";

type Mode = "rendered" | "source" | "split";

interface Tab {
  id: number;
  path: string;
  name: string;
  view: EditorView;
  savedDoc: Text;
  bom: boolean;
  mtime: number;
  mode: Mode;
  livePreview: boolean;
  headings: HeadingInfo[];
  collapsed: Set<string>;
  renderedScroll: number;
  renderTimer: number;
  /** Duration of the last full render; big documents re-render less often. */
  lastRenderMs: number;
  draftTimer: number;
  /** Remembers 'X' vs 'x' per checkbox so the original case survives toggling. */
  tickCase: Map<number, string>;
  banner: string | null;
}

// ---------------------------------------------------------------- layout

const app = document.getElementById("app")!;
app.innerHTML = `
  <header class="toolbar">
    <button data-cmd="open" title="Open (Ctrl+O)">Open</button>
    <button data-cmd="save" title="Save (Ctrl+S)">Save</button>
    <span class="sep"></span>
    <div class="modes" role="group">
      <button data-mode="rendered" title="Rendered (Ctrl+1)">Rendered</button>
      <button data-mode="source" title="Source (Ctrl+2)">Source</button>
      <button data-mode="split" title="Side by side (Ctrl+3)">Side by side</button>
    </div>
    <label class="lp-toggle" title="Experimental live-preview groundwork (S6)"><input type="checkbox" id="lp"> Live preview (S6)</label>
    <span class="spacer"></span>
    <button data-cmd="outline" title="Toggle outline">Outline</button>
  </header>
  <nav class="tabs" id="tabs"></nav>
  <div class="banner" id="banner" hidden></div>
  <main class="body">
    <aside class="outline" id="outline">
      <div class="outline-tools">
        <input id="outline-filter" type="search" placeholder="Filter headings">
        <div class="outline-buttons">
          <button data-ol="collapse" title="Collapse all">−</button>
          <button data-ol="expand" title="Expand all">+</button>
          <button data-ol="1" title="Expand to level 1">1</button>
          <button data-ol="2" title="Expand to level 2">2</button>
          <button data-ol="3" title="Expand to level 3">3</button>
        </div>
      </div>
      <div class="outline-tree" id="outline-tree"></div>
    </aside>
    <div class="splitter" id="splitter"></div>
    <section class="content" id="content">
      <div class="source-pane" id="source-pane"></div>
      <div class="rendered-pane" id="rendered-pane"><article class="markdown-body" id="rendered"></article></div>
    </section>
  </main>
  <footer class="status" id="status"></footer>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tabsEl = $("tabs");
const bannerEl = $("banner");
const outlineEl = $("outline");
const outlineTree = $("outline-tree");
const outlineFilter = $<HTMLInputElement>("outline-filter");
const contentEl = $("content");
const sourcePane = $("source-pane");
const renderedPane = $("rendered-pane");
const renderedEl = $("rendered");
const statusEl = $("status");
const lpToggle = $<HTMLInputElement>("lp");

let host: Host;
const tabs: Tab[] = [];
let active: Tab | null = null;
let nextTabId = 1;
let readyInfo = "";

function status(msg: string) {
  statusEl.textContent = `${host?.name ?? "?"} host${readyInfo ? " · " + readyInfo : ""} · ${msg}`;
}

// NFR-11: never pop up errors; log them and show them in the status bar.
window.addEventListener("error", (e) => {
  host?.log("error", `${e.message} @ ${e.filename}:${e.lineno}`);
  status(`Error: ${e.message}`);
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
  host?.log("error", `Unhandled: ${msg}`);
  status(`Error: ${msg}`);
  e.preventDefault();
});

// ---------------------------------------------------------------- tabs

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
const isDirty = (t: Tab) => !t.view.state.doc.eq(t.savedDoc);

function renderTabs() {
  saveSession(); // runs on every open/close/switch
  tabsEl.innerHTML = "";
  for (const t of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t === active ? " active" : "");
    el.title = t.path;
    el.innerHTML = `<span class="tab-name"></span><span class="tab-dirty">${isDirty(t) ? "●" : ""}</span><button class="tab-close" title="Close">×</button>`;
    el.querySelector(".tab-name")!.textContent = t.name;
    el.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).classList.contains("tab-close")) return;
      activate(t);
    });
    el.querySelector(".tab-close")!.addEventListener("click", () => closeTab(t));
    tabsEl.appendChild(el);
  }
}

async function openFile(path: string): Promise<void> {
  const existing = tabs.find((t) => t.path.toLowerCase() === path.toLowerCase());
  if (existing) {
    activate(existing);
    return;
  }
  const data = await host.readFile(path);
  const sep = detectLineSeparator(data.text);
  const resolve = (rel: string) => host.fileUrl(resolvePath(path, decodeURIComponent(rel)));
  let tab: Tab;
  const state = createEditorState(data.text, sep, () => onDocChanged(tab), resolve);
  const view = new EditorView({ state });
  tab = {
    id: nextTabId++,
    path,
    name: baseName(path),
    view,
    savedDoc: state.doc,
    bom: data.bom,
    mtime: data.mtime,
    mode: (localStorage.getItem("mdtiger.mode") as Mode) || "rendered",
    livePreview: false,
    headings: [],
    collapsed: new Set(),
    renderedScroll: 0,
    renderTimer: 0,
    lastRenderMs: 0,
    draftTimer: 0,
    tickCase: new Map(),
    banner: null,
  };
  tabs.push(tab);

  // Crash/resume recovery: restore unsaved edits kept as a draft (NFR-10).
  // Only if the file is still the one the draft was based on: if it changed
  // on disk since, a silent restore would overwrite newer content.
  const draft = readDraft(path);
  if (draft && draft.baseMtime === data.mtime && draft.text !== state.sliceDoc()) {
    replaceDoc(tab, draft.text, false);
    tab.banner = "Restored unsaved edits from the previous session.";
  } else if (draft) {
    host.log("warn", `discarded a stale draft for ${path} (file changed since the draft was taken)`);
    clearDraft(path);
  }

  await host.watch(path).catch((e) => host.log("warn", `watch failed: ${e}`));
  activate(tab);
}

function activate(t: Tab) {
  if (active && active !== t) active.renderedScroll = renderedPane.scrollTop;
  active = t;
  sourcePane.replaceChildren(t.view.dom);
  lpToggle.checked = t.livePreview;
  applyMode();
  renderNow(t);
  renderedPane.scrollTop = t.renderedScroll;
  renderTabs();
  showBanner(t.banner);
  status(t.path);
}

function closeTab(t: Tab) {
  if (isDirty(t) && !confirm(`${t.name} has unsaved changes. Close anyway?`)) return;
  clearDraft(t.path);
  void host.unwatch(t.path);
  t.view.destroy();
  const i = tabs.indexOf(t);
  tabs.splice(i, 1);
  if (active === t) {
    active = null;
    const next = tabs[Math.min(i, tabs.length - 1)];
    if (next) activate(next);
    else {
      sourcePane.replaceChildren();
      renderedEl.innerHTML = "";
      outlineTree.innerHTML = "";
      renderTabs();
    }
  } else renderTabs();
}

async function save(t: Tab) {
  const text = t.view.state.sliceDoc(); // joined with the file's own separator
  const r = await host.writeFile(t.path, text, t.bom);
  t.mtime = r.mtime;
  t.savedDoc = t.view.state.doc;
  clearDraft(t.path);
  renderTabs();
  status(`Saved ${t.path}`);
}

function replaceDoc(t: Tab, text: string, markSaved: boolean) {
  const v = t.view;
  const scroll = v.scrollDOM.scrollTop;
  // The tab's own separator is fixed in its state; normalise incoming text to it.
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: v.state.toText(text) } });
  if (markSaved) t.savedDoc = v.state.doc;
  v.scrollDOM.scrollTop = scroll;
}

// ---------------------------------------------------------------- drafts

const draftKey = (p: string) => "mdtiger.draft:" + p.toLowerCase();
interface Draft {
  text: string;
  /** mtime of the file on disk when the edits started. */
  baseMtime: number;
}
function readDraft(p: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(p));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return typeof d?.text === "string" && typeof d.baseMtime === "number" ? d : null;
  } catch {
    return null; // unreadable or old-format draft
  }
}
function clearDraft(p: string) {
  try {
    localStorage.removeItem(draftKey(p));
  } catch {
    /* ignore */
  }
}

function onDocChanged(t: Tab) {
  renderTabs();
  clearTimeout(t.renderTimer);
  // Wait longer before re-rendering when rendering is slow (big documents).
  const delay = Math.min(2000, Math.max(150, t.lastRenderMs * 3));
  t.renderTimer = window.setTimeout(() => t === active && renderNow(t), t.mode === "source" ? 150 : delay);
  clearTimeout(t.draftTimer);
  t.draftTimer = window.setTimeout(() => writeDraft(t), 500);
}

function writeDraft(t: Tab) {
  try {
    if (isDirty(t)) localStorage.setItem(draftKey(t.path), JSON.stringify({ text: t.view.state.sliceDoc(), baseMtime: t.mtime } satisfies Draft));
    else clearDraft(t.path);
  } catch {
    /* storage full or unavailable: drafts are best-effort */
  }
}

// ---------------------------------------------------------------- modes

function applyMode() {
  if (!active) return;
  contentEl.dataset.mode = active.mode;
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === active!.mode));
  lpToggle.parentElement!.hidden = active.mode === "rendered";
  if (active.mode !== "rendered") requestAnimationFrame(() => active!.view.requestMeasure());
}

function setMode(m: Mode) {
  if (!active) return;
  // Keep the reading position across mode switches (FR-EDIT-05).
  const pos = topSourcePos();
  active.mode = m;
  try {
    localStorage.setItem("mdtiger.mode", m);
  } catch {
    /* ignore */
  }
  applyMode();
  renderNow(active);
  requestAnimationFrame(() => scrollToPos(pos, false));
}

/** Source offset at the top of whichever view is primary right now. */
function topSourcePos(): number {
  if (!active) return 0;
  if (active.mode === "source") {
    const v = active.view;
    return v.lineBlockAtHeight(v.scrollDOM.scrollTop).from;
  }
  // Binary search over the top-level blocks: their bottoms increase in
  // document order. Linear scans were too slow for 2 MB documents (S8).
  const top = renderedPane.getBoundingClientRect().top + 4;
  let lo = 0;
  let hi = blocks.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].getBoundingClientRect().bottom > top) {
      found = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return found >= 0 ? +blocks[found].dataset.from! : 0;
}

/** Top-level rendered blocks with source offsets, refreshed on every render. */
let blocks: HTMLElement[] = [];

/** Scrolls the visible view(s) so that source offset `pos` is at the top. */
function scrollToPos(pos: number, moveCursor: boolean) {
  if (!active) return;
  const v = active.view;
  if (active.mode !== "rendered") {
    v.dispatch({
      selection: moveCursor ? EditorSelection.cursor(pos) : undefined,
      effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 8 }),
    });
    if (moveCursor && active.mode === "source") v.focus();
  }
  if (active.mode !== "source") {
    const el = renderedElementAt(pos);
    if (el) renderedPane.scrollTop += el.getBoundingClientRect().top - renderedPane.getBoundingClientRect().top - 8;
  }
}

/** The deepest rendered element whose source range starts at or before pos. */
function renderedElementAt(pos: number): HTMLElement | null {
  if (!blocks.length) return null;
  // Last top-level block starting at or before pos (binary search)...
  let lo = 0;
  let hi = blocks.length - 1;
  let i = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (+blocks[mid].dataset.from! <= pos) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  let best = blocks[i];
  if (pos > +best.dataset.to! && blocks[i + 1]) return blocks[i + 1]; // pos is in a gap: next block
  // ...then the deepest nested element (list item, etc.) containing pos.
  for (;;) {
    const inner = Array.from(best.querySelectorAll<HTMLElement>(":scope > [data-from], :scope > * > [data-from]")).find(
      (el) => +el.dataset.from! <= pos && pos <= +el.dataset.to!,
    );
    if (!inner) return best;
    best = inner;
  }
}

// ---------------------------------------------------------------- rendering

function renderNow(t: Tab) {
  const t0 = performance.now();
  if (t.mode === "source") {
    // Source mode only needs the outline: take it from the editor's own
    // incremental syntax tree instead of a full render (S8).
    t.headings = headingsFromState(t.view.state);
    if (t === active) renderOutline(t);
    host.log("info", `outline ${t.name}: ${(performance.now() - t0).toFixed(1)} ms`);
    return;
  }
  const text = t.view.state.doc.toString(); // '\n'-joined: offsets match CodeMirror positions
  const res = renderMarkdown(text, {
    resolveLocal: (rel) => host.fileUrl(resolvePath(t.path, decodeURIComponent(rel))),
  });
  t.headings = res.headings;
  if (t === active) {
    const scroll = renderedPane.scrollTop;
    if (res.hasRawHtml) {
      // A DOM fragment avoids serializing and re-parsing the sanitized HTML.
      const frag = DOMPurify.sanitize(res.html, {
        RETURN_DOM_FRAGMENT: true,
        ADD_ATTR: ["data-from", "data-to", "data-pos", "data-lang", "data-state", "data-remote", "target"],
      });
      renderedEl.replaceChildren(frag);
    } else {
      renderedEl.innerHTML = res.html;
    }
    blocks = Array.from(renderedEl.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el.dataset.from !== undefined);
    renderedPane.scrollTop = scroll;
    // Highlighting (only near the viewport) and diagrams run after the first paint.
    requestAnimationFrame(() => {
      highlightWhenVisible(renderedEl, renderedPane);
      if (res.hasMermaid) void renderMermaidBlocks(renderedEl);
    });
    renderOutline(t);
  }
  t.lastRenderMs = performance.now() - t0;
  host.log("info", `render ${t.name}: ${t.lastRenderMs.toFixed(1)} ms`);
}

// ---------------------------------------------------------------- outline

interface OutlineNode {
  h: HeadingInfo;
  children: OutlineNode[];
}

function buildTree(hs: HeadingInfo[]): OutlineNode[] {
  const root: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const h of hs) {
    const node = { h, children: [] };
    while (stack.length && stack[stack.length - 1].h.level >= h.level) stack.pop();
    (stack.length ? stack[stack.length - 1].children : root).push(node);
    stack.push(node);
  }
  return root;
}

function renderOutline(t: Tab) {
  const filter = outlineFilter.value.trim().toLowerCase();
  const tree = buildTree(t.headings);
  // Drop fold state of headings that no longer exist (FR-NAV-05).
  const ids = new Set(t.headings.map((h) => h.id));
  for (const id of t.collapsed) if (!ids.has(id)) t.collapsed.delete(id);

  const ul = (nodes: OutlineNode[]): HTMLUListElement | null => {
    const list = document.createElement("ul");
    for (const n of nodes) {
      const sub = n.children.length ? ul(n.children) : null;
      const matches = !filter || n.h.text.toLowerCase().includes(filter);
      if (!matches && !sub) continue;
      const li = document.createElement("li");
      const row = document.createElement("div");
      row.className = "ol-row";
      row.dataset.from = String(n.h.from);
      const twisty = document.createElement("span");
      twisty.className = "twisty";
      const folded = !filter && t.collapsed.has(n.h.id);
      twisty.textContent = sub ? (folded ? "▸" : "▾") : "";
      if (sub)
        twisty.addEventListener("click", (e) => {
          e.stopPropagation();
          if (t.collapsed.has(n.h.id)) t.collapsed.delete(n.h.id);
          else t.collapsed.add(n.h.id);
          renderOutline(t);
        });
      const label = document.createElement("span");
      label.className = "ol-label" + (matches ? "" : " dim");
      label.textContent = n.h.text; // exactly as written, no numbering (FR-NAV-02)
      row.append(twisty, label);
      row.addEventListener("click", () => scrollToPos(n.h.from, true));
      rowByFrom.set(n.h.from, row);
      li.appendChild(row);
      if (sub && !folded) li.appendChild(sub);
      list.appendChild(li);
    }
    return list.children.length ? list : null;
  };
  rowByFrom.clear();
  currentRow = null;
  outlineTree.replaceChildren(ul(tree) ?? document.createTextNode(""));
  highlightCurrentHeading();
}

/** Outline rows by heading offset, so the scroll handler needs no DOM search. */
const rowByFrom = new Map<number, HTMLElement>();
let currentRow: HTMLElement | null = null;

function outlineCommand(cmd: string) {
  if (!active) return;
  const t = active;
  const tree = buildTree(t.headings);
  t.collapsed.clear();
  const walk = (nodes: OutlineNode[], depth: number) => {
    for (const n of nodes) {
      if (n.children.length) {
        if (cmd === "collapse" || (cmd !== "expand" && depth >= +cmd)) t.collapsed.add(n.h.id);
        walk(n.children, depth + 1);
      }
    }
  };
  walk(tree, 1);
  renderOutline(t);
}

/** FR-NAV-06: highlight the section currently in view. */
function highlightCurrentHeading() {
  if (!active) return;
  const pos = topSourcePos() + 1;
  // Last heading at or before pos (headings are sorted by offset).
  const hs = active.headings;
  let lo = 0;
  let hi = hs.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (hs[mid].from <= pos) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const row = idx >= 0 ? rowByFrom.get(hs[idx].from) ?? null : null;
  if (row === currentRow) return; // nothing changed: no DOM work at all
  currentRow?.classList.remove("current");
  currentRow = row;
  if (!row) return;
  row.classList.add("current");
  const r = row.getBoundingClientRect();
  const o = outlineTree.getBoundingClientRect();
  if (r.top < o.top || r.bottom > o.bottom) row.scrollIntoView({ block: "nearest" });
}

// ---------------------------------------------------------------- rendered-view interaction

renderedEl.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;

  // FR-CODE-03: copy button copies the raw code as plain text.
  const btn = target.closest<HTMLButtonElement>(".copy-btn");
  if (btn) {
    const mm = btn.closest<HTMLElement>(".mermaid-block");
    const code = mm ? mm.dataset.source ?? "" : btn.parentElement!.querySelector("pre")!.textContent ?? "";
    void copyPlain(code).then(() => {
      btn.textContent = "Copied";
      btn.classList.add("done");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("done");
      }, 1500);
    });
    return;
  }

  const toggle = target.closest<HTMLButtonElement>(".mermaid-toggle");
  if (toggle) {
    const block = toggle.closest<HTMLElement>(".mermaid-block")!;
    const svg = block.querySelector<HTMLElement>(".mermaid-svg");
    const src = block.querySelector<HTMLElement>(".mermaid-source")!;
    if (svg) {
      const showSrc = src.hidden;
      src.hidden = !showSrc;
      svg.hidden = showSrc;
      toggle.textContent = showSrc ? "Diagram" : "Source";
    }
    return;
  }

  const a = target.closest<HTMLAnchorElement>("a[href]");
  if (a) {
    e.preventDefault();
    void followLink(a.getAttribute("href")!);
  }
});

// FR-EDIT-10: ticking a checkbox changes exactly one character in the source.
renderedEl.addEventListener("change", (e) => {
  const box = e.target as HTMLInputElement;
  if (!box.classList.contains("task-box") || !active) return;
  const t = active;
  const p = +box.dataset.pos!;
  const cur = t.view.state.sliceDoc(p, p + 1);
  if (cur === "x" || cur === "X") t.tickCase.set(p, cur);
  const next = box.checked ? t.tickCase.get(p) ?? "x" : " ";
  t.view.dispatch({ changes: { from: p, to: p + 1, insert: next }, userEvent: "input.toggle-task" });
});

// FR-CODE-08: a selection inside a code block is copied as plain text only.
document.addEventListener("copy", (e) => {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !e.clipboardData) return;
  const range = sel.getRangeAt(0);
  const pre = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest("pre") ?? null;
  const a = pre(range.startContainer);
  if (a && a === pre(range.endContainer)) {
    e.clipboardData.setData("text/plain", sel.toString());
    e.preventDefault();
  }
});

async function copyPlain(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

async function followLink(href: string) {
  if (!active) return;
  if (href.startsWith("#")) {
    const id = decodeURIComponent(href.slice(1));
    const h = active.headings.find((x) => x.id === id);
    if (h) scrollToPos(h.from, false);
    return;
  }
  if (/^(https?:|mailto:)/i.test(href)) {
    await host.openExternal(href);
    return;
  }
  // Local link: the renderer turned it into a host file URL; recover the path.
  const m = /[?&]path=([^&#]+)/.exec(href);
  let path = m ? decodeURIComponent(m[1]) : href;
  if (!m && host.name === "tauri") {
    // asset URLs look like http://asset.localhost/<encoded path>
    path = decodeURIComponent(href.replace(/^https?:\/\/asset\.localhost\//, ""));
  }
  const [file, anchor] = path.split("#");
  if (/\.(md|markdown)$/i.test(file)) {
    await openFile(file);
    if (anchor) await followLink("#" + anchor);
  } else {
    await host.openExternal(file);
  }
}

// Remote images: placeholder on failure, retry when the network is back (FR-LINK-05, NFR-10).
renderedEl.addEventListener(
  "error",
  (e) => {
    const img = e.target as HTMLImageElement;
    if (img.tagName !== "IMG") return;
    img.classList.add("broken");
    img.title = `Image not available: ${img.getAttribute("src")}`;
  },
  true,
);
renderedEl.addEventListener(
  "load",
  (e) => {
    const img = e.target as HTMLImageElement;
    if (img.tagName === "IMG") img.classList.remove("broken");
  },
  true,
);
function retryImages() {
  renderedEl.querySelectorAll<HTMLImageElement>("img.broken").forEach((img) => {
    const src = img.getAttribute("src")!;
    img.src = src + (src.includes("?") ? "&" : "?") + "retry=" + Date.now();
  });
}
window.addEventListener("online", retryImages);

// ---------------------------------------------------------------- external changes & resume

async function checkExternal(t: Tab) {
  const st = await host.stat(t.path).catch(() => null);
  if (!st) {
    setBanner(t, `${t.name} was deleted or moved outside MdTiger.`);
    return;
  }
  if (st.mtime === t.mtime) return;
  const data = await host.readFile(t.path);
  if (data.text === t.view.state.sliceDoc()) {
    t.mtime = data.mtime;
    t.savedDoc = t.view.state.doc;
    return;
  }
  if (!isDirty(t)) {
    t.mtime = data.mtime;
    t.bom = data.bom;
    replaceDoc(t, data.text, true);
    renderTabs();
    status(`Reloaded ${t.path} (changed outside MdTiger)`);
  } else {
    setBanner(
      t,
      `${t.name} changed on disk while you have unsaved edits.`,
      [
        ["Reload from disk", () => { t.mtime = data.mtime; replaceDoc(t, data.text, true); clearDraft(t.path); setBanner(t, null); renderTabs(); }],
        // The edits now apply on top of the newer file: re-base the draft.
        ["Keep mine", () => { t.mtime = data.mtime; writeDraft(t); setBanner(t, null); }],
      ],
    );
  }
}

function onResumed(reason: string) {
  host.log("info", `resume detected (${reason}); rechecking ${tabs.length} tab(s)`);
  for (const t of tabs) void checkExternal(t);
  retryImages();
}

// Portable resume detection: a timer that suddenly fires much later than
// scheduled means the machine was asleep. File watchers can miss changes
// made meanwhile, so re-check every open file (NFR-10).
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  if (now - lastTick > 15000) onResumed(`timer gap ${(now - lastTick) / 1000 | 0}s`);
  lastTick = now;
}, 2000);

// ---------------------------------------------------------------- banner

let bannerActions: [string, () => void][] = [];
function setBanner(t: Tab, msg: string | null, actions: [string, () => void][] = []) {
  t.banner = msg;
  if (t === active) showBanner(msg, actions);
}
function showBanner(msg: string | null, actions: [string, () => void][] = bannerActions) {
  bannerActions = actions;
  bannerEl.hidden = !msg;
  if (!msg) return;
  bannerEl.innerHTML = `<span></span>`;
  bannerEl.firstElementChild!.textContent = msg;
  for (const [label, fn] of actions) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", fn);
    bannerEl.appendChild(b);
  }
  const close = document.createElement("button");
  close.textContent = "×";
  close.className = "banner-close";
  close.addEventListener("click", () => active && setBanner(active, null));
  bannerEl.appendChild(close);
}

// ---------------------------------------------------------------- commands & keys

async function pickAndOpen() {
  const p = await host.pickFile();
  if (p) await openFile(p);
}

document.querySelector(".toolbar")!.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!b) return;
  if (b.dataset.mode) setMode(b.dataset.mode as Mode);
  else if (b.dataset.cmd === "open") void pickAndOpen();
  else if (b.dataset.cmd === "save" && active) void save(active);
  else if (b.dataset.cmd === "outline") outlineEl.classList.toggle("hidden");
});
document.querySelector(".outline-buttons")!.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (b?.dataset.ol) outlineCommand(b.dataset.ol);
});
outlineFilter.addEventListener("input", () => active && renderOutline(active));
lpToggle.addEventListener("change", () => {
  if (!active) return;
  active.livePreview = lpToggle.checked;
  setLivePreview(active.view, lpToggle.checked, (rel) => host.fileUrl(resolvePath(active!.path, decodeURIComponent(rel))));
});

document.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "s") {
    e.preventDefault();
    if (active) void save(active);
  } else if (k === "o") {
    e.preventDefault();
    void pickAndOpen();
  } else if (k === "w") {
    e.preventDefault();
    if (active) closeTab(active);
  } else if (k === "1" || k === "2" || k === "3") {
    e.preventDefault();
    setMode((["rendered", "source", "split"] as Mode[])[+k - 1]);
  } else if (k === "tab" && tabs.length > 1 && active) {
    e.preventDefault();
    const i = tabs.indexOf(active);
    activate(tabs[(i + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length]);
  }
});

// Scroll sync (split mode: editor drives the rendered view) and outline highlight.
// Both handlers run at most once per frame (S8: big documents scroll often).
let editorScrollQueued = false;
let syncedScroll = false;
function onEditorScroll() {
  if (editorScrollQueued) return;
  editorScrollQueued = true;
  requestAnimationFrame(() => {
    editorScrollQueued = false;
    if (!active) return;
    if (active.mode === "split") {
      const v = active.view;
      const el = renderedElementAt(v.lineBlockAtHeight(v.scrollDOM.scrollTop).from);
      if (el) {
        syncedScroll = true; // don't treat our own scroll as a user scroll
        renderedPane.scrollTop += el.getBoundingClientRect().top - renderedPane.getBoundingClientRect().top - 8;
      }
    }
    highlightCurrentHeading();
  });
}
let renderedScrollQueued = false;
function onRenderedScroll() {
  if (syncedScroll) {
    syncedScroll = false;
    return;
  }
  if (renderedScrollQueued) return;
  renderedScrollQueued = true;
  requestAnimationFrame(() => {
    renderedScrollQueued = false;
    highlightCurrentHeading();
  });
}
sourcePane.addEventListener("scroll", onEditorScroll, { capture: true, passive: true });
renderedPane.addEventListener("scroll", onRenderedScroll, { passive: true });

// Splitter for the outline width (FR-NAV-07).
{
  const sp = $("splitter");
  const saved = localStorage.getItem("mdtiger.outlineWidth");
  if (saved) outlineEl.style.width = saved;
  sp.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const move = (m: MouseEvent) => (outlineEl.style.width = `${Math.max(140, Math.min(600, m.clientX))}px`);
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      try {
        localStorage.setItem("mdtiger.outlineWidth", outlineEl.style.width);
      } catch {
        /* ignore */
      }
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
}

// ---------------------------------------------------------------- default app (FR-APP-05)

async function checkDefaultApp() {
  if (localStorage.getItem("mdtiger.noDefaultAsk") === "1") return;
  const st = await host.defaultAppStatus().catch(() => null);
  if (!st || st.isDefault || !active || active.banner) return; // don't hide a more important message
  setBanner(active, `MdTiger isn't your default app for .md files${st.currentProgId ? ` (currently: ${st.currentProgId})` : ""}.`, [
    ["Make default…", () => { void host.openDefaultAppsSettings(); active && setBanner(active, null); }],
    ["Not now", () => active && setBanner(active, null)],
    ["Don't ask again", () => { localStorage.setItem("mdtiger.noDefaultAsk", "1"); active && setBanner(active, null); }],
  ]);
}

// ---------------------------------------------------------------- startup

// sessionStorage lives in the browser process, so it survives a renderer
// crash and reload, but not closing the app.
function readSession(): { paths: string[]; active: string | null } {
  try {
    const s = JSON.parse(sessionStorage.getItem("mdtiger.session") ?? "null");
    if (s && Array.isArray(s.paths)) return s;
  } catch {
    /* ignore */
  }
  return { paths: [], active: null };
}
function saveSession() {
  try {
    sessionStorage.setItem("mdtiger.session", JSON.stringify({ paths: tabs.map((t) => t.path), active: active?.path ?? null }));
  } catch {
    /* ignore */
  }
}

async function start() {
  host = await detectHost();
  host.onEvent((ev) => {
    if (ev.type === "open") void openFile(ev.path).catch((e) => status(`Cannot open ${ev.path}: ${e}`));
    else if (ev.type === "changed") {
      const t = tabs.find((x) => x.path.toLowerCase() === ev.path.toLowerCase());
      if (t) void checkExternal(t);
    } else if (ev.type === "resumed") onResumed("host event");
  });
  // After a web-engine restart (NFR-10) the page reloads: reopen every tab of
  // this session, not just the files the app was started with.
  const session = readSession();
  const seen = new Set<string>();
  const files = [...session.paths, ...(await host.initialFiles())].filter((f) => {
    const k = f.toLowerCase();
    return seen.has(k) ? false : (seen.add(k), true);
  });
  for (const f of files) {
    try {
      await openFile(f);
    } catch (e) {
      status(`Cannot open ${f}: ${e}`);
      host.log("error", `open ${f}: ${e}`);
    }
  }
  const wasActive = session.active && tabs.find((t) => t.path.toLowerCase() === session.active!.toLowerCase());
  if (wasActive) activate(wasActive);
  if (!tabs.length) status("No file open. Use Open (Ctrl+O).");
  // Usable = first document rendered and painted.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const ms = performance.now();
      readyInfo = `ready in ${ms.toFixed(0)} ms after navigation`;
      host.ready({ msSinceNavigation: ms });
      status(active?.path ?? "ready");
      setTimeout(() => void checkDefaultApp(), 1500);
    }),
  );
}

void start();
