// The content area: the active document's source pane (CodeMirror) and its
// rendered pane, arranged by the tab's mode. Handles mode changes with
// position keeping, the Split divider and the scroll sync between the panes.

import { EditorView } from "@codemirror/view";
import type { Doc, Mode } from "../core/doc";
import type { SettingsStore } from "../core/settings";
import type { Workspace } from "../core/workspace";
import type { Layout } from "./layout";
import type { ModeSwitch } from "./modeSwitch";

export interface Panes {
  /** The source offset at the top of the visible view. */
  topPos(): number;
}

/** Source offset of the first line at the top of an editor. `scrollEditorTo` leaves a margin of 8 px
 *  above the line it targets: look a little below the edge, or the line above would be taken. */
function editorTopPos(v: EditorView): number {
  return v.lineBlockAtHeight(v.scrollDOM.scrollTop + 12).from;
}

/** Scrolls an editor so the line holding `pos` is at the top. `exact` goes through CodeMirror's own
 *  scroll effect, which settles after the editor has measured (needed right after it was hidden). */
function scrollEditorTo(v: EditorView, pos: number, exact = false): void {
  const p = Math.min(pos, v.state.doc.length);
  if (exact) {
    v.dispatch({ effects: EditorView.scrollIntoView(p, { y: "start", yMargin: 8 }) });
    if (p <= 0) v.scrollDOM.scrollTop = 0;
  } else {
    v.scrollDOM.scrollTop = p <= 0 ? 0 : Math.max(0, v.lineBlockAt(p).top - 8);
  }
}

export function mountPanes(layout: Layout, ws: Workspace, settings: SettingsStore, modeSwitch: ModeSwitch): Panes {
  const workarea = document.createElement("div");
  workarea.id = "workarea";
  const sourcePane = document.createElement("div");
  sourcePane.id = "pane-source";
  const divider = document.createElement("div");
  divider.id = "split-divider";
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", "vertical");
  const renderedHost = document.createElement("div");
  renderedHost.id = "pane-rendered";
  workarea.append(sourcePane, divider, renderedHost);
  layout.content.append(workarea);
  workarea.hidden = true;

  const applyRatio = () => workarea.style.setProperty("--split-ratio", String(settings.get("split.ratio")));
  applyRatio();
  settings.onChange("split.ratio", applyRatio);

  let shown: Doc | null = null;
  let shownMode: Mode | null = null;

  // ---- positions
  const topPosIn = (doc: Doc, mode: Mode | null): number => (mode === "rendered" ? doc.rendered.topSourcePos() : editorTopPos(doc.view));

  const scrollVisibleTo = (doc: Doc, mode: Mode, pos: number) => {
    if (mode !== "rendered") scrollEditorTo(doc.view, pos, true);
    if (mode !== "source") doc.rendered.scrollToPos(pos);
  };

  // ---- scroll sync (Split): one update per frame, no feedback loops
  let ignoreSource = false;
  let ignoreRendered = false;
  let setSource = -1; // scroll positions we set ourselves in Split: events at these are not user scrolls
  let setRendered = -1;
  const sourceTop = () => (shown ? shown.view.scrollDOM.scrollTop : -2);
  let queued = false;
  let ignoreTimer: ReturnType<typeof setTimeout> | null = null;
  const releaseIgnore = () => {
    if (ignoreTimer) clearTimeout(ignoreTimer);
    ignoreTimer = setTimeout(() => {
      ignoreSource = false;
      ignoreRendered = false;
    }, 120);
  };
  /** Scrolls the rendered side so that the source line the reader is working on (the caret, when it is
   *  in view and the editor has the focus; else the top line) is at the same height on the screen. */
  const alignRendered = (doc: Doc) => {
    const v = doc.view;
    const rect = v.scrollDOM.getBoundingClientRect();
    let pos = editorTopPos(v);
    if (v.hasFocus) {
      const head = v.state.selection.main.head;
      const c = v.coordsAtPos(head);
      if (c && c.top >= rect.top && c.bottom <= rect.bottom) pos = head;
    }
    const c = v.coordsAtPos(pos);
    const el = doc.rendered.elementAt(pos);
    if (!c || !el) return;
    const y = c.top - rect.top;
    // Inside a tall block (code, list, paragraph) place the matching line, not the block's top.
    const from = +(el.dataset.from ?? pos);
    const to = +(el.dataset.to ?? pos);
    const st = v.state.doc;
    const l0 = st.lineAt(Math.min(from, st.length)).number;
    const l1 = st.lineAt(Math.min(Math.max(to, from), st.length)).number;
    const frac = l1 > l0 ? (st.lineAt(pos).number - l0) / (l1 - l0 + 1) : 0;
    const r = el.getBoundingClientRect();
    const paneTop = doc.rendered.el.getBoundingClientRect().top;
    const pane = doc.rendered.el;
    const before = pane.scrollTop;
    pane.scrollTop += r.top + frac * r.height - paneTop - y;
    // The matching text must be readable, not cut off by the bottom edge: a few lines of room below it.
    const r2 = el.getBoundingClientRect();
    const need = r2.top + frac * r2.height + Math.min((1 - frac) * r2.height, 90) - (pane.getBoundingClientRect().bottom - 16);
    if (need > 0) pane.scrollTop += need;
    // Moving the caret forward must never scroll the rendered side back up (the caret's screen height
    // grows while the editor does not scroll yet, which would pull the rendered side up).
    // The same holds the other way round when moving up.
    if (lastAlign.doc === doc && pos === v.state.selection.main.head) {
      const top = v.scrollDOM.scrollTop;
      if (pos > lastAlign.pos && top >= lastAlign.top && pane.scrollTop < before) pane.scrollTop = before;
      if (pos < lastAlign.pos && top <= lastAlign.top && pane.scrollTop > before) pane.scrollTop = before;
    }
    lastAlign = { doc, pos, top: v.scrollDOM.scrollTop };
  };
  let lastAlign: { doc: Doc | null; pos: number; top: number } = { doc: null, pos: -1, top: 0 };
  const alignNow = () => {
    const doc = shown;
    if (doc && doc.mode === "split") syncFrom("source");
  };
  sourcePane.addEventListener("keyup", alignNow);
  sourcePane.addEventListener("pointerup", alignNow);

  const syncFrom = (from: "source" | "rendered") => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const doc = shown;
      if (!doc || doc.mode !== "split") return;
      if (from === "source") {
        const before = doc.rendered.el.scrollTop;
        alignRendered(doc);
        if (doc.rendered.el.scrollTop !== before) {
          setRendered = doc.rendered.el.scrollTop;
        }
      } else {
        const v = doc.view;
        const before = v.scrollDOM.scrollTop;
        scrollEditorTo(v, doc.rendered.topSourcePos());
        if (v.scrollDOM.scrollTop !== before) {
          setSource = v.scrollDOM.scrollTop;
        }
      }
    });
  };
  sourcePane.addEventListener(
    "scroll",
    () => {
      if (ignoreSource) {
        ignoreSource = false;
        return;
      }
      if (Math.abs(sourceTop() - setSource) < 1) return; // our own move (it may fire several events)
      syncFrom("source");
    },
    { capture: true, passive: true },
  );
  renderedHost.addEventListener(
    "scroll",
    () => {
      if (ignoreRendered) {
        ignoreRendered = false;
        return;
      }
      if (shown && Math.abs(shown.rendered.el.scrollTop - setRendered) < 1) return;
      syncFrom("rendered");
    },
    { capture: true, passive: true },
  );

  // ---- the Split divider
  divider.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    divider.classList.add("dragging");
    const rect = workarea.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const r = Math.min(0.85, Math.max(0.15, (ev.clientX - rect.left) / rect.width));
      workarea.style.setProperty("--split-ratio", String(r));
    };
    const up = (ev: PointerEvent) => {
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
      divider.removeEventListener("pointercancel", up);
      divider.classList.remove("dragging");
      move(ev);
      settings.set("split.ratio", Math.min(0.85, Math.max(0.15, (ev.clientX - rect.left) / rect.width)));
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
    divider.addEventListener("pointercancel", up);
  });

  // ---- following the workspace
  const sync = () => {
    const active = ws.active ?? null;
    const activeChanged = active !== shown;
    const modeChanged = !!active && !activeChanged && active.mode !== shownMode;
    if (!activeChanged && !modeChanged) {
      modeSwitch.sync(active?.mode ?? settings.get("defaultMode"), !!active);
      return;
    }

    // Where the reader is, in whatever view was showing.
    let pos = 0;
    if (shown && shownMode) {
      pos = topPosIn(shown, shownMode);
      if (activeChanged) {
        shown.scrollTop = shown.view.scrollDOM.scrollTop;
        shown.topPos = pos;
        shown.rendered.setActive(false);
        shown.view.dom.remove();
        shown.rendered.el.remove();
      }
    }

    if (activeChanged) {
      shown = active;
      pos = active?.topPos ?? 0;
      if (active) {
        sourcePane.append(active.view.dom);
        renderedHost.append(active.rendered.el);
        active.rendered.onRender = () => {
          if (active === shown && active.mode === "split") syncFrom("source");
        };
      }
      layout.showEmptyState(!active);
    }
    workarea.hidden = !active;

    if (!active) {
      shownMode = null;
      modeSwitch.sync(settings.get("defaultMode"), false);
      return;
    }

    const mode = active.mode;
    shownMode = mode;
    workarea.dataset.mode = mode;
    modeSwitch.sync(mode, true);
    active.rendered.setActive(mode !== "source");
    if (mode !== "rendered") active.view.requestMeasure();

    if (activeChanged && mode !== "rendered") active.view.scrollDOM.scrollTop = active.scrollTop;
    if (mode === "rendered") active.rendered.el.focus({ preventScroll: true });
    else active.view.focus();

    // Layout settles first, then the position is put back (the editor measures lazily).
    const doc = active;
    const restore = () => {
      if (doc !== shown || doc.mode !== mode) return;
      if (activeChanged && mode !== "rendered") {
        doc.view.scrollDOM.scrollTop = doc.scrollTop;
        if (mode === "split") doc.rendered.scrollToPos(pos);
        else return;
      } else {
        scrollVisibleTo(doc, mode, pos);
      }
      // The mode changed: both views follow the same position without echoing.
      if (mode === "split") {
        ignoreSource = ignoreRendered = true;
        releaseIgnore();
      }
    };
    if (mode === "rendered" && activeChanged) {
      // The rendered pane's own scroll position isn't kept by the browser while detached.
      requestAnimationFrame(() => doc === shown && doc.mode === mode && doc.rendered.scrollToPos(pos));
    } else {
      requestAnimationFrame(restore);
    }
  };

  ws.onChange(sync);
  sync();

  return {
    topPos() {
      return shown && shownMode ? topPosIn(shown, shownMode) : 0;
    },
  };
}
