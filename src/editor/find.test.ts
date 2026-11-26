import { undo } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "./createEditor";
import { SourceFindBackend, type FindOptions } from "./find";
import { parseLineSpec } from "../ui/gotoLine";
import { formatCount } from "../ui/findBar";

/** A real view (CodeMirror's commands expect one); `updates` counts its updates. */
function holder(text: string): EditorView & { updates: number } {
  const counter = { updates: 0 };
  const view = new EditorView({
    state: createEditorState(text, "\n", [EditorView.updateListener.of(() => void counter.updates++)]),
  });
  return Object.defineProperty(view, "updates", { get: () => counter.updates }) as EditorView & { updates: number };
}

const opts = (search: string, extra: Partial<FindOptions> = {}): FindOptions => ({
  search,
  replace: "",
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
  ...extra,
});

describe("source find backend", () => {
  it("counts with case, whole word and regex options", () => {
    const h = holder("Cat cat concat CAT\ncat1 cat");
    const b = new SourceFindBackend(() => h);
    b.setQuery(opts("cat"));
    expect(b.count()).toEqual({ total: 6, capped: false, invalid: false });
    b.setQuery(opts("cat", { caseSensitive: true }));
    expect(b.count().total).toBe(4);
    b.setQuery(opts("cat", { wholeWord: true }));
    expect(b.count().total).toBe(4); // Cat cat CAT cat (not concat, cat1)
    b.setQuery(opts("c\\w+t", { regexp: true }));
    expect(b.count().total).toBe(6);
  });

  it("reports an invalid regex without throwing", () => {
    const h = holder("abc");
    const b = new SourceFindBackend(() => h);
    b.setQuery(opts("(", { regexp: true }));
    expect(b.count()).toEqual({ total: 0, capped: false, invalid: true });
    expect(b.next()).toBe(false);
    expect(b.replaceAll()).toBe(0);
    expect(h.state.doc.toString()).toBe("abc");
  });

  it("a plain search treats backslash sequences literally", () => {
    const h = holder("a\\nb\na");
    const b = new SourceFindBackend(() => h);
    b.setQuery(opts("\\n"));
    expect(b.count().total).toBe(1);
  });

  it("replace all with $1 is one transaction and one undo step", () => {
    const text = "ann@x bob@x\nnothing\ncy@x";
    const h = holder(text);
    const b = new SourceFindBackend(() => h);
    b.setQuery(opts("(\\w+)@x", { regexp: true, replace: "$1@y" }));
    const before = h.updates;
    expect(b.replaceAll()).toBe(3);
    expect(h.updates - before).toBe(1);
    expect(h.state.doc.toString()).toBe("ann@y bob@y\nnothing\ncy@y");
    // One undo restores the original text.
    undo(h);
    expect(h.state.doc.toString()).toBe(text);
  });

  it("supports $& and $$ in the replacement", () => {
    const h = holder("a b");
    const b = new SourceFindBackend(() => h);
    b.setQuery(opts("\\w", { regexp: true, replace: "[$&]$$" }));
    b.replaceAll();
    expect(h.state.doc.toString()).toBe("[a]$ [b]$");
  });

  it("next, previous and the position of the current match", () => {
    const h = holder("x a x a x");
    const b = new SourceFindBackend(() => h);
    b.setQuery(opts("x"));
    expect(b.reveal()).toBe(true);
    expect(b.currentIndex()).toBe(1);
    b.next();
    expect(b.currentIndex()).toBe(2);
    b.next();
    b.next(); // wraps around
    expect(b.currentIndex()).toBe(1);
    b.prev(); // wraps back
    expect(b.currentIndex()).toBe(3);
  });

  it("replace one replaces the selected match and moves on", () => {
    const h = holder("a a a");
    const b = new SourceFindBackend(() => h);
    b.setQuery(opts("a", { replace: "b" }));
    b.reveal();
    b.replaceCurrent();
    expect(h.state.doc.toString()).toBe("b a a");
    expect(b.currentIndex()).toBe(1); // the next "a" is selected
  });

  it("caps the count", () => {
    const h = holder("a".repeat(10_050));
    const b = new SourceFindBackend(() => h);
    b.setQuery(opts("a"));
    expect(b.count()).toEqual({ total: 10_000, capped: true, invalid: false });
    expect(formatCount(b.count(), 0, true)).toBe("10000+ results");
  });

  it("clear removes the query", () => {
    const h = holder("a");
    const b = new SourceFindBackend(() => h);
    b.setQuery(opts("a"));
    b.clear();
    expect(b.count().total).toBe(0);
    expect(b.next()).toBe(false);
  });
});

describe("find bar text and go to line", () => {
  it("formats the counter", () => {
    expect(formatCount({ total: 17, capped: false, invalid: false }, 3, true)).toBe("3 of 17");
    expect(formatCount({ total: 0, capped: false, invalid: false }, 0, true)).toBe("No results");
    expect(formatCount({ total: 0, capped: false, invalid: true }, 0, true)).toBe("Invalid regex");
    expect(formatCount({ total: 5, capped: false, invalid: false }, 0, false)).toBe("");
  });

  it("parses line and line:column, clamped to the document", () => {
    let s = createEditorState("one\ntwo\nthree", "\n");
    s = s.update({ selection: EditorSelection.single(0) }).state;
    ensureSyntaxTree(s, s.doc.length, 1000);
    expect(parseLineSpec("2", s)).toBe(4);
    expect(parseLineSpec("3:2", s)).toBe(9);
    expect(parseLineSpec("99", s)).toBe(8);
    expect(parseLineSpec("2:99", s)).toBe(7);
    expect(parseLineSpec("0", s)).toBe(0);
    expect(parseLineSpec("x", s)).toBeNull();
    expect(parseLineSpec("", s)).toBeNull();
  });
});
