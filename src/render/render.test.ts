// Renderer unit tests: the rendered view is built from the editor's own tree.
// jsdom, not happy-dom: DOMPurify does not work on happy-dom's HTML parser.
// @vitest-environment jsdom

import type { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import showcaseMd from "../../tests/fixtures/showcase.md?raw";
import tablesMd from "../../tests/fixtures/tables.md?raw";
import { createEditorState } from "../editor/createEditor";
import { assignHeadingIds, slugify } from "./render";
import { RenderedView } from "./view";

const fixture = (name: string) => (name === "tables.md" ? tablesMd : showcaseMd).replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));

/** A rendered view of `text`, rendered once. */
function render(text: string): { view: RenderedView; el: HTMLElement; state: EditorState } {
  const state = createEditorState(text, "\n");
  const view = new RenderedView(() => state);
  expect(view.renderNow()).toBe(true);
  return { view, el: view.doc, state };
}

const html = (text: string) => render(text).el.innerHTML;

describe("elements", () => {
  it("renders headings, paragraphs and inline markup", () => {
    const { el } = render("# One\n\nText with **bold**, *italic*, ~~gone~~ and `code`.\n\nSetext\n------\n");
    expect(el.querySelector("h1")?.textContent).toBe("One");
    expect(el.querySelector("p strong")?.textContent).toBe("bold");
    expect(el.querySelector("p em")?.textContent).toBe("italic");
    expect(el.querySelector("p del")?.textContent).toBe("gone");
    expect(el.querySelector("p code")?.textContent).toBe("code");
    expect(el.querySelector("h2")?.textContent).toBe("Setext");
  });

  it("renders lists, nested lists and task items", () => {
    const { el } = render("- a\n  - b\n- c\n\n1. one\n2. two\n\n- [ ] open\n- [x] done\n");
    expect(el.querySelectorAll("ul").length).toBe(3);
    expect(el.querySelectorAll("ol > li").length).toBe(2);
    const boxes = el.querySelectorAll<HTMLInputElement>("input.task-box");
    expect(boxes.length).toBe(2);
    expect(boxes[0].disabled).toBe(true);
    expect(boxes[0].checked).toBe(false);
    expect(boxes[1].checked).toBe(true);
  });

  it("renders code blocks as plain pre/code, quotes and rules", () => {
    const { el } = render("```js\nlet a = 1 < 2;\n```\n\n    indented\n\n> quoted\n\n---\n");
    expect(el.querySelector("pre[data-lang=js] code")?.textContent).toBe("let a = 1 < 2;");
    expect(el.querySelectorAll("pre").length).toBe(2);
    expect(el.querySelector("blockquote p")?.textContent).toBe("quoted");
    expect(el.querySelector("hr")).not.toBeNull();
  });

  it("renders images as placeholders and links as inert anchors", () => {
    const { el } = render("![the alt](pic.png) and [site](https://x.example) and <https://auto.example> and https://www.bare.example\n");
    expect(el.querySelector(".image-placeholder")?.textContent).toBe("the alt");
    expect(el.querySelector("img")).toBeNull();
    const hrefs = [...el.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://x.example", "https://auto.example", "https://www.bare.example"]);
  });

  it("resolves reference links", () => {
    const { el } = render("[ref][r] and [r]\n\n[r]: https://ref.example 'T'\n");
    const as = el.querySelectorAll("a");
    expect(as.length).toBe(2);
    expect(as[0].getAttribute("href")).toBe("https://ref.example");
    expect(as[0].getAttribute("title")).toBe("T");
  });

  it("renders alignment, header and the literal pipe in code spans of cells", () => {
    const { el } = render("| L | C | R |\n|:--|:-:|--:|\n| a | b | c |\n| `x \\| y` | m | 1 |\n");
    const ths = el.querySelectorAll<HTMLElement>("th");
    expect(ths.length).toBe(3);
    expect(ths[1].style.textAlign).toBe("center");
    expect(ths[2].style.textAlign).toBe("right");
    expect(el.querySelectorAll("tbody tr").length).toBe(2);
    expect(el.querySelector("tbody tr:nth-child(2) code")?.textContent).toBe("x | y");
    expect(el.querySelector(".table-wrap > table")).not.toBeNull();
  });

  it("renders ragged and pipe-less tables like GitHub", () => {
    const { el } = render("|Name|Value|\n|-|-|\n|missing padding|1|\n| extra | 2 | 3 |\n| short |\n\nShell | Notes\n--- | ---\nTauri | thin\n");
    expect(el.querySelectorAll("table").length).toBe(2);
    const rows = el.querySelector("table")!.querySelectorAll("tbody tr");
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.children.length).toBe(2); // padded or cut to the header
    expect(rows[2].children[1].textContent).toBe("");
  });

  it("counts the tables of the fixtures", () => {
    expect(render(fixture("tables.md")).el.querySelectorAll("table").length).toBe(3);
    expect(render(fixture("showcase.md")).el.querySelectorAll("table").length).toBe(3);
  });

  it("renders footnotes GitHub style, numbered by first reference", () => {
    const { el } = render("Text[^b] and more[^a] and again[^b].\n\n[^a]: Note A.\n[^b]: Note B\n    continued.\n\nLater.\n");
    const refs = el.querySelectorAll("sup.footnote-ref a");
    expect([...refs].map((r) => r.textContent)).toEqual(["1", "2", "1"]);
    expect(refs[0].getAttribute("href")).toBe("#fn-b");
    const items = el.querySelectorAll("section.footnotes li");
    expect(items.length).toBe(2);
    expect(items[0].id).toBe("fn-b");
    expect(items[0].textContent).toContain("Note B");
    expect(items[0].textContent).toContain("continued.");
    expect(items[0].querySelector("a.footnote-back")?.getAttribute("href")).toBe("#fnref-b");
    // Definitions are not shown in place.
    expect(el.textContent?.match(/Note A/g)?.length).toBe(1);
    expect(el.textContent).toContain("Later.");
  });

  it("leaves an undefined footnote reference as text", () => {
    const { el } = render("Text[^nope] here.\n");
    expect(el.querySelector("sup")).toBeNull();
    expect(el.textContent).toContain("[^nope]");
  });
});

describe("front matter", () => {
  it("is recognised at the very start and shown collapsed", () => {
    const { el } = render("---\ntitle: X\ntags: [a]\n---\n\n# Hi\n");
    const d = el.querySelector("details.front-matter");
    expect(d).not.toBeNull();
    expect(d!.querySelector("summary")?.textContent).toBe("Front matter");
    expect(d!.hasAttribute("open")).toBe(false);
    expect(d!.querySelector("code")?.textContent).toBe("title: X\ntags: [a]");
    expect(el.querySelector("h1")?.textContent).toBe("Hi");
    expect(el.querySelector("hr")).toBeNull();
  });

  it("ends at a ... line too", () => {
    expect(render("---\na: 1\n...\n\ntext\n").el.querySelector("details.front-matter")).not.toBeNull();
  });

  it("is not front matter later in the document, or without a closing line", () => {
    expect(render("text\n\n---\na: 1\n---\n").el.querySelector("details")).toBeNull();
    expect(render("\n---\na: 1\n---\n").el.querySelector("details")).toBeNull();
    const open = render("---\nno end\n\ntext\n").el;
    expect(open.querySelector("details")).toBeNull();
    expect(open.querySelector("hr")).not.toBeNull();
  });

  it("is a rule when it is later", () => {
    expect(render("para\n\n---\n\nmore\n").el.querySelector("hr")).not.toBeNull();
  });
});

describe("heading anchors", () => {
  it("follows GitHub's slug rules", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("Árvíztűrő tükör")).toBe("árvíztűrő-tükör");
    expect(slugify("4.3 Foo")).toBe("43-foo");
    expect(slugify("snake_case and-dash")).toBe("snake_case-and-dash");
  });

  it("numbers duplicates", () => {
    const { el } = render("# Same\n\n## Same\n\n### Same\n\n## Other\n");
    expect([...el.querySelectorAll("h1,h2,h3,h2")].map((h) => h.id)).toEqual(["same", "same-1", "same-2", "other"]);
  });

  it("uses the text without markup, and reassigns on its own", () => {
    const { el } = render("## A `code` **bold** [link](x)\n");
    expect(el.querySelector("h2")?.id).toBe("a-code-bold-link");
    el.querySelector("h2")!.id = "";
    assignHeadingIds(el);
    expect(el.querySelector("h2")?.id).toBe("a-code-bold-link");
  });
});

describe("sanitising", () => {
  it("removes scripts, event handlers, javascript: links and iframes", () => {
    const { el } = render(
      [
        "<script>window.__pwned = 1</script>",
        "",
        '<img src="x" onerror="window.__pwned = 2">',
        "",
        '<a href="javascript:window.__pwned=3">js</a>',
        "",
        '<iframe src="https://evil.example"></iframe>',
        "",
        'Inline <b onclick="x()">bold</b> and <script>bad()</script> text.',
        "",
        "[md](javascript:alert(1))",
        "",
        '<div style="background:url(http://evil.example/x)">styled</div>',
      ].join("\n"),
    );
    const s = el.innerHTML;
    expect(s).not.toContain("<script");
    expect(s).not.toContain("onerror");
    expect(s).not.toContain("onclick");
    expect(s).not.toContain("javascript:");
    expect(s).not.toContain("iframe");
    expect(s).not.toContain("url(");
    expect(el.querySelector("b")?.textContent).toBe("bold");
    expect(el.textContent).toContain("md");
  });

  it("keeps common README HTML: details/summary, br, kbd, sub, sup, align", () => {
    const { el } = render(
      '<details>\n<summary>More</summary>\n\nHidden <kbd>Ctrl</kbd> H<sub>2</sub>O x<sup>2</sup><br>\n\n</details>\n\n<div align="center">centered</div>\n\n<!-- a comment -->\n\nVisible.\n',
    );
    expect(el.querySelector("summary")?.textContent).toBe("More");
    expect(el.querySelector("details kbd")?.textContent).toBe("Ctrl"); // the Markdown between the tags is inside the element
    expect(el.querySelector("sub")).not.toBeNull();
    expect(el.querySelector("sup")).not.toBeNull();
    expect(el.querySelector("div[align=center]")?.textContent).toBe("centered");
    expect(el.innerHTML).not.toContain("a comment");
    expect(el.textContent).toContain("Visible.");
  });
});

describe("html spanning blocks", () => {
  it("keeps Markdown between an opening and a closing details or div inside the element", () => {
    const md = [
      "<div align=\"center\">",
      "",
      "# Title",
      "",
      "![logo](logo.png)",
      "",
      "</div>",
      "",
      "Outside.",
      "",
      "<details>",
      "<summary>S</summary>",
      "",
      "- item",
      "",
      "</details>",
      "",
    ].join(String.fromCharCode(10));
    const { el, view } = render(md);
    const div = el.querySelector("div[align=center]")!;
    expect(div.querySelector("h1")?.textContent).toBe("Title");
    expect(div.querySelector(".image-placeholder")).not.toBeNull();
    expect(div.textContent).not.toContain("Outside.");
    expect(el.querySelector("details li")?.textContent).toBe("item");
    expect(el.querySelector("details")?.getAttribute("data-from")).not.toBeNull();
    expect(view.blockRanges().length).toBe(3); // group, paragraph, group
  });

  it("leaves an unclosed opener alone", () => {
    const { el } = render(["<div>", "", "text", ""].join(String.fromCharCode(10)));
    expect(el.textContent).toContain("text");
  });
});

describe("source offsets", () => {
  // The marker each element's source range must begin with.
  const START: Record<string, RegExp> = {
    H1: /^(#|[^\n]+\n[=-])/,
    H2: /^(#|[^\n]+\n[=-])/,
    H3: /^#/,
    H4: /^#/,
    H5: /^#/,
    H6: /^#/,
    P: /^\S/,
    UL: /^[-*+] /,
    OL: /^\d+[.)] /,
    LI: /^([-*+]|\d+[.)])( |$)/,
    BLOCKQUOTE: /^>/,
    HR: /^(-{3,}|\*{3,}|_{3,})/,
    PRE: /^(```|~~~| {4}|\t)/,
    DIV: /^[^\n]*\|/, // the table wrapper: a row with pipes
    TD: /^[^|\n]/,
    TH: /^[^|\n]/,
    A: /^(\[|<|h|w)/,
    SPAN: /^!\[/,
    INPUT: /^\[[ xX]\]/,
    DETAILS: /^(---|<details)/,
    CENTER: /^</,
  };

  function check(text: string): number {
    const { el } = render(text);
    const bad: string[] = [];
    let seen = 0;
    for (const e of el.querySelectorAll<HTMLElement>("[data-from]")) {
      seen++;
      const from = +e.dataset.from!;
      const to = +e.dataset.to!;
      const slice = text.slice(from, to);
      let re: RegExp | undefined = START[e.tagName];
      if (e.tagName === "DIV" && e.classList.contains("html-block")) re = /^</;
      if (e.tagName === "A" && e.closest("sup")) re = /^\[\^/;
      if (e.tagName === "LI" && e.closest("section.footnotes")) re = /^\[\^/;
      if (e.tagName === "P" && e.closest("section.footnotes")) re = /^\S/;
      if (!re) {
        bad.push(`${e.tagName}: no expectation`);
        continue;
      }
      if (!(to > from) || !re.test(slice)) bad.push(`${e.tagName} [${from},${to}) -> ${JSON.stringify(slice.slice(0, 30))}`);
    }
    expect(bad).toEqual([]);
    return seen;
  }

  it("every element of showcase.md starts at its source marker", () => {
    expect(check(fixture("showcase.md"))).toBeGreaterThan(60);
  });

  it("every element of tables.md starts at its source marker", () => {
    expect(check(fixture("tables.md"))).toBeGreaterThan(30);
  });

  it("covers footnotes and nesting", () => {
    check("# T\n\n> quote\n> - item [x](y)\n\n1. a\n   - b\n\nText[^1]\n\n[^1]: Note\n");
  });
});

describe("snapshots", () => {
  it("showcase.md", () => {
    expect(html(fixture("showcase.md"))).toMatchSnapshot();
  });
  it("tables.md", () => {
    expect(html(fixture("tables.md"))).toMatchSnapshot();
  });
});

describe("incremental rendering", () => {
  const para = (i: number) => `Paragraph number ${i} with some words.`;
  const doc = (n: number) => Array.from({ length: n }, (_, i) => para(i + 1)).join("\n\n") + "\n";

  /** A view over a mutable state, so edits can be applied like the editor does. */
  function live(text: string) {
    let state = createEditorState(text, "\n");
    const view = new RenderedView(() => state);
    view.renderNow();
    const edit = (changes: { from: number; to?: number; insert?: string }) => {
      const tr = state.update({ changes });
      state = tr.state;
      view.notify(tr.changes);
      expect(view.renderNow()).toBe(true);
    };
    return { view, edit, text: () => state.doc.toString() };
  }

  it("an edit inside paragraph 50 of 200 renders exactly one block", () => {
    const l = live(doc(200));
    const before = l.view.stats.blocks;
    l.edit({ from: l.text().indexOf("number 50 ") + 3, insert: "XY" });
    expect(l.view.stats.blocks - before).toBe(1);
    expect(l.view.stats.incremental).toBe(1);
    expect(l.view.doc.innerHTML).toBe(html(l.text()));
  });

  it("keeps the offsets of later blocks right", () => {
    const l = live(doc(30));
    l.edit({ from: l.text().indexOf("number 5 ") + 3, insert: "0123456789" });
    l.edit({ from: 0, insert: "abc " });
    const text = l.text();
    for (const p of l.view.doc.querySelectorAll<HTMLElement>("p[data-from]")) {
      expect(text.slice(+p.dataset.from!, +p.dataset.to!)).toMatch(/^(abc )?Paragraph num/);
    }
    expect(l.view.doc.innerHTML).toBe(html(text));
  });

  it("inserting a heading re-renders only the affected blocks and fixes the ids", () => {
    const l = live("# Same\n\n" + doc(100) + "\n## Same\n");
    const before = l.view.stats.blocks;
    l.edit({ from: l.text().indexOf("Paragraph number 60 "), insert: "## Same\n\n" });
    expect(l.view.stats.blocks - before).toBeLessThanOrEqual(3);
    expect(l.view.stats.incremental).toBe(1);
    expect([...l.view.doc.querySelectorAll("h1,h2")].map((h) => h.id)).toEqual(["same", "same-1", "same-2"]);
    expect(l.view.doc.innerHTML).toBe(html(l.text()));
  });

  it("deleting a block and merging two paragraphs match a full render", () => {
    const l = live(doc(40));
    const end = l.text().indexOf("\n\n", l.text().indexOf("Paragraph number 10 "));
    l.edit({ from: end, to: end + 2, insert: " " }); // joins 10 and 11
    expect(l.view.doc.innerHTML).toBe(html(l.text()));
    const b = l.text().indexOf("Paragraph number 20 ");
    l.edit({ from: b, to: l.text().indexOf("\n\n", b) + 2 });
    expect(l.view.doc.innerHTML).toBe(html(l.text()));
  });

  it("falls back to a full render for large edits, link references and footnotes", () => {
    const l = live(doc(20) + "\n[r]: https://x.example\n");
    const full = l.view.stats.full;
    l.edit({ from: 0, to: 400, insert: "# New start\n\nFresh.\n\n" });
    expect(l.view.stats.full).toBe(full + 1);
    expect(l.view.doc.innerHTML).toBe(html(l.text()));

    const l2 = live("a [r] b\n\n" + doc(20) + "\n[r]: https://x.example\n");
    const f2 = l2.view.stats.full;
    l2.edit({ from: l2.text().indexOf("https://x.example") + 8, insert: "y" });
    expect(l2.view.stats.full).toBe(f2 + 1);
    expect(l2.view.doc.querySelector("a")?.getAttribute("href")).toBe("https://yx.example");
    expect(l2.view.doc.innerHTML).toBe(html(l2.text()));

    const l3 = live(doc(20) + "\nRef[^n] here.\n\n[^n]: Note.\n");
    const f3 = l3.view.stats.full;
    l3.edit({ from: l3.text().indexOf("Ref[^n]"), insert: "More[^n]. " });
    expect(l3.view.stats.full).toBe(f3 + 1);
    expect(l3.view.doc.innerHTML).toBe(html(l3.text()));
  });

  it("a replaced document renders from scratch after invalidate()", () => {
    let state = createEditorState("# A\n", "\n");
    const view = new RenderedView(() => state);
    view.renderNow();
    state = createEditorState("# B\n\ntext\n", "\n");
    view.invalidate();
    view.renderNow();
    expect(view.doc.querySelector("h1")?.textContent).toBe("B");
  });
});

describe("positions", () => {
  it("maps source offsets to the deepest element", () => {
    const text = "# T\n\n- one\n- two\n\nEnd\n";
    const { view } = render(text);
    expect(view.elementAt(0)?.tagName).toBe("H1");
    expect(view.elementAt(text.indexOf("two"))?.tagName).toBe("LI");
    expect(view.elementAt(text.indexOf("End"))?.tagName).toBe("P");
    expect(view.blockRanges().length).toBe(3);
  });
});
