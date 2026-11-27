// The mode switch (FR-EDIT-05): a segmented control with Rendered, Source and
// Split. Exactly one button is pressed (aria-pressed="true", accent
// background); `sync` is the only thing that changes that, so it cannot drift
// from the real mode.

import { BookOpen, Code, Columns2, createElement, type IconNode } from "lucide";
import type { Mode } from "../core/doc";

interface ModeInfo {
  mode: Mode;
  label: string;
  icon: IconNode;
  command: string;
  shortcut: string;
}

export const MODE_INFO: readonly ModeInfo[] = [
  { mode: "rendered", label: "Rendered", icon: BookOpen, command: "view.rendered", shortcut: "Ctrl+1" },
  { mode: "source", label: "Source", icon: Code, command: "view.source", shortcut: "Ctrl+2" },
  { mode: "split", label: "Split", icon: Columns2, command: "view.split", shortcut: "Ctrl+3" },
];

export interface ModeSwitch {
  /** Presses `mode`'s button and releases the others; `enabled` false greys the control out (no document). */
  sync(mode: Mode, enabled: boolean): void;
}

export function mountModeSwitch(parent: HTMLElement, onSelect: (mode: Mode) => void): ModeSwitch {
  const group = document.createElement("div");
  group.id = "mode-switch";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "View mode");
  const buttons = new Map<Mode, HTMLButtonElement>();
  for (const info of MODE_INFO) {
    const b = document.createElement("button");
    b.type = "button";
    b.id = `mode-${info.mode}`;
    b.className = "mode-button";
    b.dataset.mode = info.mode;
    b.title = `${info.label} (${info.shortcut})`;
    b.setAttribute("aria-pressed", "false");
    b.append(createElement(info.icon, { width: 16, height: 16 }));
    const label = document.createElement("span");
    label.className = "mode-label";
    label.textContent = info.label;
    b.append(label);
    b.addEventListener("click", () => onSelect(info.mode));
    buttons.set(info.mode, b);
    group.append(b);
  }
  parent.append(group);
  return {
    sync(mode, enabled) {
      for (const [m, b] of buttons) {
        b.setAttribute("aria-pressed", m === mode ? "true" : "false");
        b.disabled = !enabled;
      }
    },
  };
}
