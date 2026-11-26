// App layout skeleton. Regions, top to bottom: toolbar, tab strip, a row with
// the outline sidebar and the content area, status bar. A banner slot sits
// above the content. Later steps fill the regions; this module only builds
// them and keeps the sidebar in sync with the settings.

import type { SettingsStore } from "../core/settings";
import logoUrl from "./logo.png";

export interface Layout {
  root: HTMLElement;
  toolbar: HTMLElement;
  tabs: HTMLElement;
  outline: HTMLElement;
  banner: HTMLElement;
  /** Holds the find bar and the go-to-line bar, above the editor. */
  dock: HTMLElement;
  content: HTMLElement;
  emptyState: HTMLElement;
  status: HTMLElement;
  /** Shows a short non-blocking message in the status bar (clears itself). */
  setStatus(text: string): void;
  /** Shows a non-blocking notification that goes away by itself. */
  notify(text: string): void;
  /** Shows or hides the empty state (shown while no document is open). */
  showEmptyState(visible: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, id?: string, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (id) e.id = id;
  if (className) e.className = className;
  return e;
}

const STATUS_MS = 10_000;
const TOAST_MS = 10_000;

export function buildLayout(host: HTMLElement, settings: Pick<SettingsStore, "get" | "onChange">): Layout {
  const root = el("div", "layout");
  const toolbar = el("div", "toolbar");
  toolbar.setAttribute("role", "toolbar");
  const tabs = el("div", "tabs");
  tabs.setAttribute("role", "tablist");

  const main = el("div", "main");
  const outline = el("aside", "outline");
  outline.setAttribute("aria-label", "Outline");
  const outlineTitle = el("div", undefined, "outline-title");
  outlineTitle.textContent = "Outline";
  outline.append(outlineTitle);

  const column = el("div", "column");
  const banner = el("div", "banner");
  banner.hidden = true;
  banner.setAttribute("role", "status");
  const dock = el("div", "dock");
  const content = el("main", "content");

  const emptyState = el("div", "empty-state");
  const logo = el("img", undefined, "empty-logo");
  logo.src = logoUrl;
  logo.alt = "";
  logo.width = 96;
  logo.height = 96;
  const title = el("p", undefined, "empty-title");
  title.textContent = "Open a Markdown file";
  const hint = el("p", undefined, "empty-hint");
  const kbd = el("kbd");
  kbd.textContent = "Ctrl+O";
  hint.append(kbd);
  emptyState.append(logo, title, hint);
  content.append(emptyState);

  column.append(banner, dock, content);
  main.append(outline, column);

  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const status = el("footer", "status");
  status.setAttribute("role", "status");

  const toast = el("div", "toast");
  toast.setAttribute("role", "status");
  toast.hidden = true;

  root.append(toolbar, tabs, main, status, toast);
  host.append(root);

  const applyOutline = () => {
    outline.hidden = !settings.get("outline.visible");
    root.style.setProperty("--outline-width", `${settings.get("outline.width")}px`);
  };
  applyOutline();
  settings.onChange("outline.visible", applyOutline);
  settings.onChange("outline.width", applyOutline);

  return {
    root,
    toolbar,
    tabs,
    outline,
    banner,
    dock,
    content,
    emptyState,
    status,
    setStatus(text) {
      status.textContent = text;
      if (statusTimer) clearTimeout(statusTimer);
      statusTimer = setTimeout(() => {
        if (status.textContent === text) status.textContent = "";
      }, STATUS_MS);
    },
    notify(text) {
      toast.textContent = text;
      toast.hidden = false;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.hidden = true), TOAST_MS);
    },
    showEmptyState(visible) {
      emptyState.hidden = !visible;
    },
  };
}
