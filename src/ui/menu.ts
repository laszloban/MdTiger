// A small reusable dropdown menu. The app menu button uses it for the file
// commands; later steps add items or reuse the component.

import { createElement, Menu as MenuIcon } from "lucide";
import type { CommandRegistry } from "../core/commands";

export interface MenuItem {
  /** A command id: the item runs it, shows its shortcut, and is disabled with it. */
  command: string;
  label?: string;
  /** A separator is drawn above this item. */
  separator?: boolean;
}

/** "Mod-Shift-s" → "Ctrl+Shift+S". */
export function formatShortcut(shortcut: string): string {
  return shortcut
    .replace(/^Mod-/, "Ctrl+")
    .replace(/-(?=.)/g, "+")
    .replace(/\+([a-z])$/, (_, c: string) => `+${c.toUpperCase()}`);
}

export interface MenuHandle {
  button: HTMLButtonElement;
  close(): void;
}

export function createMenu(parent: HTMLElement, registry: CommandRegistry, items: MenuItem[], opts: { id: string; label: string }): MenuHandle {
  const wrap = document.createElement("div");
  wrap.className = "menu-wrap";
  const button = document.createElement("button");
  button.type = "button";
  button.id = `${opts.id}-button`;
  button.className = "icon-button";
  button.title = opts.label;
  button.setAttribute("aria-label", opts.label);
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.append(createElement(MenuIcon, { width: 18, height: 18 }));

  const list = document.createElement("div");
  list.id = opts.id;
  list.className = "menu";
  list.setAttribute("role", "menu");
  list.hidden = true;
  wrap.append(button, list);
  parent.append(wrap);

  const close = () => {
    if (list.hidden) return;
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };

  const render = () => {
    list.replaceChildren();
    for (const item of items) {
      const cmd = registry.get(item.command);
      if (!cmd) continue;
      if (item.separator) {
        const sep = document.createElement("div");
        sep.className = "menu-separator";
        sep.setAttribute("role", "separator");
        list.append(sep);
      }
      const b = document.createElement("button");
      b.type = "button";
      b.id = `${opts.id}-${item.command}`;
      b.className = "menu-item";
      b.setAttribute("role", "menuitem");
      b.disabled = !registry.isEnabled(item.command);
      const label = document.createElement("span");
      label.textContent = item.label ?? cmd.label;
      b.append(label);
      if (cmd.shortcut) {
        const k = document.createElement("span");
        k.className = "menu-shortcut";
        k.textContent = formatShortcut(cmd.shortcut);
        b.append(k);
      }
      b.addEventListener("click", () => {
        close();
        void registry.run(item.command);
      });
      list.append(b);
    }
  };

  button.addEventListener("click", () => {
    if (!list.hidden) return close();
    render();
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("mousedown", (e) => {
    if (!wrap.contains(e.target as Node)) close();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && !list.hidden) {
        close();
        button.focus();
      }
    },
    true,
  );
  return { button, close };
}
