// S6 / NFR-09 groundwork: in the source editor, draw rendered content in
// place over the Markdown while the document stays plain text. Headings lose
// their '#' marks and get heading styling; images are shown inline. On any
// line that holds the cursor, the raw Markdown reappears. This is the same
// decoration technique a full live-preview mode (phase 2) would build on.

import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super();
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.alt === this.alt;
  }
  toDOM() {
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.className = "lp-image";
    return img;
  }
}

export function livePreview(resolve: (url: string) => string): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state))
          this.decorations = this.build(u.view);
      }
      build(view: EditorView): DecorationSet {
        const { state } = view;
        const activeLines = new Set<number>();
        for (const r of state.selection.ranges) {
          const a = state.doc.lineAt(r.from).number;
          const b = state.doc.lineAt(r.to).number;
          for (let l = a; l <= b; l++) activeLines.add(l);
        }
        const items: { from: number; to: number; deco: Decoration }[] = [];
        for (const { from, to } of view.visibleRanges) {
          syntaxTree(state).iterate({
            from,
            to,
            enter(n) {
              const m = /^ATXHeading(\d)$/.exec(n.name);
              if (m) {
                const line = state.doc.lineAt(n.from);
                items.push({ from: line.from, to: line.from, deco: Decoration.line({ class: `lp-h lp-h${m[1]}` }) });
                if (!activeLines.has(line.number)) {
                  const mark = n.node.getChild("HeaderMark");
                  if (mark && mark.from === line.from) {
                    const end = Math.min(mark.to + 1, line.to);
                    items.push({ from: mark.from, to: end, deco: Decoration.replace({}) });
                  }
                }
                return false;
              }
              if (n.name === "Image") {
                const line = state.doc.lineAt(n.from);
                if (activeLines.has(line.number) || state.doc.lineAt(n.to).number !== line.number) return false;
                const url = n.node.getChild("URL");
                const marks = n.node.getChildren("LinkMark");
                if (!url || marks.length < 2) return false;
                const src = state.sliceDoc(url.from, url.to).replace(/^<|>$/g, "");
                const alt = state.sliceDoc(marks[0].to, marks[1].from);
                const full = /^https?:/i.test(src) ? src : resolve(src);
                items.push({ from: n.from, to: n.to, deco: Decoration.replace({ widget: new ImageWidget(full, alt) }) });
                return false;
              }
            },
          });
        }
        items.sort((a, b) => a.from - b.from || a.to - b.to);
        const b = new RangeSetBuilder<Decoration>();
        for (const i of items) b.add(i.from, i.to, i.deco);
        return b.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}
