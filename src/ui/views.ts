// Shows the active document's editor in the content area, keeps the banner
// and the window title in step with the workspace.

import type { Host } from "../host/host";
import type { Workspace } from "../core/workspace";
import type { Layout } from "./layout";

export function mountViews(layout: Layout, ws: Workspace, host: Host): void {
  let shown: string | null = null;
  let lastTitle = "";
  let bannerSig = "";

  const button = (id: string, label: string, run: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.id = id;
    b.textContent = label;
    b.addEventListener("click", run);
    return b;
  };

  const sync = () => {
    const active = ws.active;

    // Editor
    if (active?.id !== shown) {
      const prev = ws.docs.find((d) => d.id === shown);
      if (prev) {
        prev.scrollTop = prev.view.scrollDOM.scrollTop;
        prev.view.dom.remove();
      }
      shown = active?.id ?? null;
      if (active) {
        layout.content.append(active.view.dom);
        active.view.scrollDOM.scrollTop = active.scrollTop;
        active.view.focus();
      }
      layout.showEmptyState(!active);
    }

    // Banner
    const b = active?.banner;
    const sig = `${active?.id}|${b?.kind ?? ""}`;
    if (sig !== bannerSig) {
      bannerSig = sig;
      layout.banner.replaceChildren();
      layout.banner.hidden = !b;
      if (active && b) {
        const text = document.createElement("span");
        text.id = "banner-text";
        text.textContent = b.text;
        layout.banner.append(text);
        if (b.kind === "stale") layout.banner.append(button("banner-use-draft", "Use draft", () => void ws.useDraft(active)));
        layout.banner.append(button("banner-discard", "Discard", () => ws.discardDraft(active)));
      }
    }

    // Window title
    const title = active ? `${active.isDirty ? "● " : ""}${active.title} – MdTiger` : "MdTiger";
    if (title !== lastTitle) {
      lastTitle = title;
      document.title = title;
      host.setTitle(title);
    }
  };

  ws.onChange(sync);
  sync();
}
