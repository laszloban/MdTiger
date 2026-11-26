// The find and replace bar, docked at the top of the content area. It only
// knows the `FindBackend` interface, so S11 can drive the Rendered view with
// the same bar. See src/editor/find.ts for the source backend.

import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, createElement, Regex, WholeWord, X } from "lucide";
import type { FindBackend, FindOptions } from "../editor/find";

export interface FindBarContext {
  backend: FindBackend;
  /** The selected text when it is a single non-empty line, else null. */
  selectedText(): string | null;
  focusEditor(): void;
  setStatus(text: string): void;
  /** Called when the bar opens (so other docked bars can close). */
  onOpen(): void;
}

export interface FindBar {
  open(opts?: { replace?: boolean }): void;
  /** Hides the bar and clears the highlighting; focus goes back to the editor unless false. */
  close(focusEditor?: boolean): void;
  readonly isOpen: boolean;
  next(): void;
  prev(): void;
  /** The active document changed: apply the query to the new editor. */
  retarget(): void;
}

export const COUNT_DELAY_MS = 150;

export function formatCount(count: { total: number; capped: boolean; invalid: boolean }, index: number, hasText: boolean): string {
  if (!hasText) return "";
  if (count.invalid) return "Invalid regex";
  if (count.total === 0) return "No results";
  const total = `${count.total}${count.capped ? "+" : ""}`;
  return index > 0 ? `${index} of ${total}` : `${total} results`;
}

type Icon = Parameters<typeof createElement>[0];

function iconButton(id: string, label: string, icon: Icon, toggle = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.id = id;
  b.className = "icon-button";
  b.title = label;
  b.setAttribute("aria-label", label);
  if (toggle) b.setAttribute("aria-pressed", "false");
  b.append(createElement(icon, { width: 16, height: 16 }));
  return b;
}

function textButton(id: string, label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.id = id;
  b.className = "text-button";
  b.textContent = label;
  return b;
}

function textInput(id: string, placeholder: string): HTMLInputElement {
  const i = document.createElement("input");
  i.id = id;
  i.type = "text";
  i.placeholder = placeholder;
  i.autocomplete = "off";
  i.spellcheck = false;
  i.setAttribute("aria-label", placeholder);
  return i;
}

export function mountFindBar(dock: HTMLElement, ctx: FindBarContext): FindBar {
  const { backend } = ctx;
  const bar = document.createElement("div");
  bar.id = "find-bar";
  bar.className = "dock-bar";
  bar.hidden = true;
  bar.setAttribute("role", "search");

  const toggleReplace = iconButton("find-toggle-replace", "Show replace (Ctrl+H)", ChevronRight);
  const search = textInput("find-input", "Find");
  const caseBtn = iconButton("find-case", "Match case", CaseSensitive, true);
  const wordBtn = iconButton("find-word", "Whole word", WholeWord, true);
  const regexBtn = iconButton("find-regex", "Regular expression", Regex, true);
  const count = document.createElement("span");
  count.id = "find-count";
  count.setAttribute("aria-live", "polite");
  const prevBtn = iconButton("find-prev", "Previous match (Shift+F3)", ChevronUp);
  const nextBtn = iconButton("find-next", "Next match (F3)", ChevronDown);
  const closeBtn = iconButton("find-close", "Close (Esc)", X);
  const row1 = document.createElement("div");
  row1.className = "find-row";
  row1.append(toggleReplace, search, caseBtn, wordBtn, regexBtn, count, prevBtn, nextBtn, closeBtn);

  const replace = textInput("replace-input", "Replace");
  const replaceOne = textButton("replace-one", "Replace");
  const replaceAllBtn = textButton("replace-all", "Replace all");
  const row2 = document.createElement("div");
  row2.id = "find-replace-row";
  row2.className = "find-row";
  row2.hidden = true;
  const spacer = document.createElement("span");
  spacer.className = "find-spacer";
  row2.append(spacer, replace, replaceOne, replaceAllBtn);

  bar.append(row1, row2);
  dock.append(bar);

  const flags = { caseSensitive: false, wholeWord: false, regexp: false };
  const options = (): FindOptions => ({ search: search.value, replace: replace.value, ...flags });

  let countTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCount = 0;

  const refresh = () => {
    if (countTimer) {
      clearTimeout(countTimer);
      countTimer = null;
    }
    lastCount = performance.now();
    const c = backend.count();
    count.textContent = formatCount(c, c.total > 0 ? backend.currentIndex() : 0, search.value !== "");
    search.classList.toggle("invalid", c.invalid);
  };
  /** Counting a big document is not free: at most once per COUNT_DELAY_MS. */
  const schedule = () => {
    if (countTimer) return;
    const wait = Math.max(0, COUNT_DELAY_MS - (performance.now() - lastCount));
    countTimer = setTimeout(refresh, wait);
  };
  backend.onChange(() => {
    if (!bar.hidden) schedule();
  });

  const apply = (reveal: boolean) => {
    backend.setQuery(options());
    if (reveal && search.value !== "") backend.reveal();
    refresh();
  };

  const setReplaceVisible = (visible: boolean) => {
    row2.hidden = !visible;
    toggleReplace.title = visible ? "Hide replace" : "Show replace (Ctrl+H)";
    toggleReplace.replaceChildren(createElement(visible ? ChevronDown : ChevronRight, { width: 16, height: 16 }));
  };

  const api: FindBar = {
    get isOpen() {
      return !bar.hidden;
    },
    open({ replace: withReplace = false } = {}) {
      ctx.onOpen();
      const sel = ctx.selectedText();
      bar.hidden = false;
      if (withReplace) setReplaceVisible(true);
      if (sel !== null) search.value = sel;
      search.focus();
      search.select();
      apply(true);
    },
    close(focusEditor = true) {
      if (bar.hidden) return;
      bar.hidden = true;
      if (countTimer) clearTimeout(countTimer);
      countTimer = null;
      backend.clear();
      if (focusEditor) ctx.focusEditor();
    },
    next() {
      if (bar.hidden) return api.open();
      backend.setQuery(options());
      backend.next();
      refresh();
    },
    prev() {
      if (bar.hidden) return api.open();
      backend.setQuery(options());
      backend.prev();
      refresh();
    },
    retarget() {
      if (bar.hidden) return;
      apply(false);
    },
  };

  search.addEventListener("input", () => apply(true));
  replace.addEventListener("input", () => backend.setQuery(options()));
  for (const [btn, key] of [
    [caseBtn, "caseSensitive"],
    [wordBtn, "wholeWord"],
    [regexBtn, "regexp"],
  ] as const) {
    btn.addEventListener("click", () => {
      flags[key] = !flags[key];
      btn.setAttribute("aria-pressed", String(flags[key]));
      btn.classList.toggle("active", flags[key] === true);
      apply(true);
    });
  }
  prevBtn.addEventListener("click", () => api.prev());
  nextBtn.addEventListener("click", () => api.next());
  closeBtn.addEventListener("click", () => api.close());
  toggleReplace.addEventListener("click", () => setReplaceVisible(row2.hidden === true));

  const doReplaceOne = () => {
    backend.setQuery(options());
    backend.replaceCurrent();
    refresh();
  };
  const doReplaceAll = () => {
    backend.setQuery(options());
    const n = backend.replaceAll();
    ctx.setStatus(n === 0 ? "No occurrences to replace" : `Replaced ${n} occurrence${n === 1 ? "" : "s"}`);
    refresh();
  };
  replaceOne.addEventListener("click", doReplaceOne);
  replaceAllBtn.addEventListener("click", doReplaceAll);

  bar.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      api.close();
    } else if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey && row2.hidden === false) {
      // Tab moves between the two text fields directly, not through the buttons.
      if (e.target === search && !e.shiftKey) {
        e.preventDefault();
        replace.focus();
        replace.select();
      } else if (e.target === replace && e.shiftKey) {
        e.preventDefault();
        search.focus();
        search.select();
      }
    } else if (e.key === "Enter" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.target === search) {
        e.preventDefault();
        if (e.shiftKey) api.prev();
        else api.next();
      } else if (e.target === replace) {
        e.preventDefault();
        doReplaceOne();
      }
    }
  });
  return api;
}
