// The tab strip: one tab per document, with a dirty marker and a close button.
// Reordering uses pointer events (HTML5 drag and drop is taken over by the
// shell's file drop handling).

import { createElement, X } from "lucide";
import type { Workspace } from "../core/workspace";

const DRAG_THRESHOLD_PX = 5;

export function mountTabs(strip: HTMLElement, ws: Workspace): void {
  let signature = "";

  const sig = () =>
    ws.docs.map((d) => `${d.id}|${d.title}|${d.path ?? ""}|${d.isDirty ? 1 : 0}|${d.id === ws.activeId ? 1 : 0}`).join("\n");

  const render = () => {
    const s = sig();
    if (s === signature) return;
    signature = s;
    strip.replaceChildren(...ws.docs.map(tabElement));
    strip.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const tabElement = (doc: Workspace["docs"][number]): HTMLElement => {
    const tab = document.createElement("div");
    tab.className = "tab" + (doc.id === ws.activeId ? " active" : "");
    tab.dataset.id = doc.id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(doc.id === ws.activeId));
    tab.title = doc.path ?? doc.title;
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = doc.title;
    const dirty = document.createElement("span");
    dirty.className = "tab-dirty";
    dirty.textContent = "●";
    dirty.hidden = !doc.isDirty;
    dirty.setAttribute("aria-label", "Unsaved changes");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.title = "Close";
    close.setAttribute("aria-label", `Close ${doc.title}`);
    close.tabIndex = -1;
    close.append(createElement(X, { width: 14, height: 14 }));
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      void ws.close([doc]);
    });
    close.addEventListener("pointerdown", (e) => e.stopPropagation());
    tab.append(title, dirty, close);
    return tab;
  };

  // Middle click closes.
  strip.addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault(); // no autoscroll
  });
  strip.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    const tab = (e.target as HTMLElement).closest<HTMLElement>(".tab");
    const doc = tab && ws.docs.find((d) => d.id === tab.dataset.id);
    if (doc) void ws.close([doc]);
  });

  // Click activates; dragging reorders.
  strip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const tab = (e.target as HTMLElement).closest<HTMLElement>(".tab");
    if (!tab) return;
    const id = tab.dataset.id!;
    const startX = e.clientX;
    let dragging = false;
    ws.activate(id);
    const dragged = strip.querySelector<HTMLElement>(`.tab[data-id="${id}"]`) ?? tab;

    const onMove = (m: PointerEvent) => {
      if (!dragging && Math.abs(m.clientX - startX) < DRAG_THRESHOLD_PX) return;
      if (!dragging) {
        dragging = true;
        dragged.classList.add("dragging");
        dragged.setPointerCapture?.(m.pointerId);
      }
      // Move the dragged tab before the first tab whose middle is right of the pointer.
      const others = [...strip.querySelectorAll<HTMLElement>(".tab")].filter((t) => t !== dragged);
      const before = others.find((t) => {
        const r = t.getBoundingClientRect();
        return m.clientX < r.left + r.width / 2;
      });
      if (before) {
        if (dragged.nextElementSibling !== before) strip.insertBefore(dragged, before);
      } else if (strip.lastElementChild !== dragged) {
        strip.append(dragged);
      }
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      if (!dragging) return;
      dragged.classList.remove("dragging");
      ws.reorder([...strip.querySelectorAll<HTMLElement>(".tab")].map((t) => t.dataset.id!));
      signature = ""; // rebuild from the model
      render();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  });

  ws.onChange(render);
  render();
}
