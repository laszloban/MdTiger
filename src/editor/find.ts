// Find and replace on the source text. The find bar (src/ui/findBar.ts) talks
// to the `FindBackend` interface; this file is the backend for the CodeMirror
// source editor. S11 adds a backend for the rendered view behind the same bar.
//
// Built on CodeMirror's SearchQuery / findNext / replaceAll, but without its
// search panel: the query lives in the editor state, the match highlighting
// is ours (CodeMirror only highlights while its own panel is open).

import { findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, search, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorSelection, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Target } from "./lists";

export interface FindOptions {
  search: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

export interface FindCount {
  /** Number of matches, at most `MAX_COUNT`. */
  total: number;
  /** There are more than `MAX_COUNT` matches (show `10000+`). */
  capped: boolean;
  /** The pattern is not a valid regular expression. */
  invalid: boolean;
}

export const MAX_COUNT = 10_000;

export interface FindBackend {
  setQuery(options: FindOptions): void;
  /** Selects the first match at or after the selection start (incremental search). */
  reveal(): boolean;
  next(): boolean;
  prev(): boolean;
  replaceCurrent(): boolean;
  /** Replaces every match in one undo step; returns how many. */
  replaceAll(): number;
  count(): FindCount;
  /** 1-based position of the selected match, 0 if the selection is not a match. */
  currentIndex(): number;
  /** Removes highlighting and the query. */
  clear(): void;
  /** Called after the document, the selection or the query changed. */
  onChange(cb: () => void): () => void;
}

// ---------------------------------------------------------------- editor state

const setFindActive = StateEffect.define<boolean>();

/** Whether the find bar is open for this editor (highlights matches while it is). */
const findActive = StateField.define<boolean>({
  create: () => false,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setFindActive)) v = e.value;
    return v;
  },
});

const matchMark = Decoration.mark({ class: "cm-find-match" });
const currentMark = Decoration.mark({ class: "cm-find-match cm-find-current" });
const HIGHLIGHT_MARGIN = 500;

const highlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        u.startState.field(findActive) !== u.state.field(findActive) ||
        getSearchQuery(u.startState) !== getSearchQuery(u.state)
      )
        this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const state = view.state;
      const query = getSearchQuery(state);
      if (!state.field(findActive) || !query.valid) return Decoration.none;
      const ranges: { from: number; to: number; current: boolean }[] = [];
      const sel = state.selection.ranges;
      for (const vr of view.visibleRanges) {
        const from = Math.max(0, vr.from - HIGHLIGHT_MARGIN);
        const to = Math.min(state.doc.length, vr.to + HIGHLIGHT_MARGIN);
        const cur = query.getCursor(state, from, to);
        let n = 0;
        for (let r = cur.next(); !r.done && n < MAX_COUNT; r = cur.next(), n++) {
          const { from: f, to: t } = r.value;
          if (f === t) continue;
          ranges.push({ from: f, to: t, current: sel.some((s) => s.from === f && s.to === t) });
        }
      }
      ranges.sort((a, b) => a.from - b.from);
      let last = -1;
      const out = [];
      for (const r of ranges) {
        if (r.from < last) continue; // overlapping visible ranges
        last = r.to;
        out.push((r.current ? currentMark : matchMark).range(r.from, r.to));
      }
      return Decoration.set(out);
    }
  },
  { decorations: (v) => v.decorations },
);

const listeners = new Set<() => void>();

const notifier = EditorView.updateListener.of((u) => {
  if (
    u.docChanged ||
    u.selectionSet ||
    u.startState.field(findActive) !== u.state.field(findActive) ||
    getSearchQuery(u.startState) !== getSearchQuery(u.state)
  ) {
    for (const cb of [...listeners]) cb();
  }
});

/** The editor extension for find/replace (query state, highlighting, change notification). */
export function findExtension(): Extension {
  return [search(), findActive, highlighter, notifier];
}

// ---------------------------------------------------------------- the backend

function toQuery(o: FindOptions): SearchQuery {
  return new SearchQuery({
    search: o.search,
    replace: o.replace,
    caseSensitive: o.caseSensitive,
    wholeWord: o.wholeWord,
    regexp: o.regexp,
    // Plain searches are literal; `\n` and `\t` are only escapes in regex mode.
    literal: !o.regexp,
  });
}

function validRegExp(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

/** Visits each non-empty match of the current query until `onMatch` returns false. */
function eachMatch(state: EditorState, onMatch: (from: number, to: number) => boolean | void): void {
  const query = getSearchQuery(state);
  if (!query.valid) return;
  const cur = query.getCursor(state);
  for (let r = cur.next(); !r.done; r = cur.next()) {
    if (r.value.from === r.value.to) continue; // an empty regex match is not a match
    if (onMatch(r.value.from, r.value.to) === false) return;
  }
}

export class SourceFindBackend implements FindBackend {
  private options: FindOptions | null = null;
  private relay: (() => void) | null = null;
  private readonly callbacks = new Set<() => void>();

  /** `getTarget` returns the active editor (a view, or a state holder in unit tests). */
  constructor(private readonly getTarget: () => Target | null) {}

  private get target(): Target | null {
    return this.getTarget();
  }

  private ready(t: Target): boolean {
    return t.state.field(findActive, false) !== undefined && getSearchQuery(t.state).valid;
  }

  setQuery(options: FindOptions): void {
    this.options = options;
    const t = this.target;
    if (!t || t.state.field(findActive, false) === undefined) return;
    t.dispatch(t.state.update({ effects: [setSearchQuery.of(toQuery(options)), setFindActive.of(true)] }));
  }

  reveal(): boolean {
    const t = this.target;
    if (!t || !this.ready(t)) return false;
    const { from } = t.state.selection.main;
    let found: [number, number] | null = null;
    let first: [number, number] | null = null;
    eachMatch(t.state, (f, e) => {
      first ??= [f, e];
      if (f >= from) {
        found = [f, e];
        return false;
      }
    });
    const m: [number, number] | null = found ?? first;
    if (!m) return false;
    t.dispatch(
      t.state.update({
        selection: EditorSelection.single(m[0], m[1]),
        effects: EditorView.scrollIntoView(m[0], { y: "nearest", yMargin: 40 }),
        userEvent: "select.search",
      }),
    );
    return true;
  }

  next(): boolean {
    const t = this.target;
    return !!t && this.ready(t) && findNext(t as never);
  }

  prev(): boolean {
    const t = this.target;
    return !!t && this.ready(t) && findPrevious(t as never);
  }

  replaceCurrent(): boolean {
    const t = this.target;
    return !!t && this.ready(t) && replaceNext(t as never);
  }

  replaceAll(): number {
    const t = this.target;
    if (!t || !this.ready(t)) return 0;
    let n = 0;
    eachMatch(t.state, () => void n++);
    if (n === 0) return 0;
    replaceAll(t as never); // one transaction = one undo step
    return n;
  }

  count(): FindCount {
    const t = this.target;
    if (!t || !this.options || this.options.search === "") return { total: 0, capped: false, invalid: false };
    if (this.options.regexp && !validRegExp(this.options.search)) return { total: 0, capped: false, invalid: true };
    let total = 0;
    let capped = false;
    eachMatch(t.state, () => {
      if (total === MAX_COUNT) {
        capped = true;
        return false;
      }
      total++;
    });
    return { total, capped, invalid: false };
  }

  currentIndex(): number {
    const t = this.target;
    if (!t || !this.ready(t)) return 0;
    const { from, to } = t.state.selection.main;
    let i = 0;
    let found = 0;
    eachMatch(t.state, (f, e) => {
      i++;
      if (f === from && e === to) {
        found = i;
        return false;
      }
      if (i >= MAX_COUNT) return false;
    });
    return found;
  }

  clear(): void {
    const t = this.target;
    this.options = null;
    if (!t || t.state.field(findActive, false) === undefined) return;
    t.dispatch(t.state.update({ effects: [setFindActive.of(false), setSearchQuery.of(new SearchQuery({ search: "" }))] }));
  }

  onChange(cb: () => void): () => void {
    this.callbacks.add(cb);
    if (!this.relay) {
      this.relay = () => this.callbacks.forEach((c) => c());
      listeners.add(this.relay);
    }
    return () => {
      this.callbacks.delete(cb);
      if (this.callbacks.size === 0 && this.relay) {
        listeners.delete(this.relay);
        this.relay = null;
      }
    };
  }
}
