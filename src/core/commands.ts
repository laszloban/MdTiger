// Command registry: every user action is a named command. Toolbar buttons,
// menus, shortcuts and the command palette (S09) all run commands.
//
// Shortcut syntax (as in CodeMirror): "Mod-o", "Mod-Shift-p", "Alt-ArrowLeft",
// "F1". Mod is Ctrl on Windows/Linux and Cmd on macOS.
//
// Keyboard-layout rules (IMPLEMENTATION_PLAN §3): letters match by `key`;
// digits and punctuation match by the physical key (`code`), because
// Shift+digit gives other characters on the Hungarian layout. Ctrl+Alt
// shortcuts are refused: Ctrl+Alt is AltGr and types `[ ] { } \ | @ # & ~`.

import { log } from "./log";

export interface Command {
  id: string;
  label: string;
  /** Default shortcut, e.g. "Mod-o". */
  shortcut?: string;
  run: () => void | Promise<void>;
  enabled?: () => boolean;
}

interface ParsedShortcut {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** Letters (lowercase) and named keys are compared with KeyboardEvent.key. */
  key?: string;
  /** Digits and punctuation are compared with KeyboardEvent.code. */
  codes?: string[];
}

const PUNCTUATION_CODES: Record<string, string> = {
  "-": "Minus",
  "=": "Equal",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  ";": "Semicolon",
  "'": "Quote",
};
const FORBIDDEN_KEYS = new Set(["[", "]", "\\", "`"]);

export function parseShortcut(shortcut: string, isMac = false): ParsedShortcut {
  const parts = shortcut.split("-");
  // "Mod--" means Mod and the minus key.
  const keyToken = parts[parts.length - 1] === "" ? "-" : parts[parts.length - 1];
  const mods = parts.slice(0, parts[parts.length - 1] === "" ? -2 : -1);
  const out: ParsedShortcut = { ctrl: false, alt: false, shift: false, meta: false };
  for (const m of mods) {
    switch (m) {
      case "Mod":
        if (isMac) out.meta = true;
        else out.ctrl = true;
        break;
      case "Ctrl":
        out.ctrl = true;
        break;
      case "Alt":
        out.alt = true;
        break;
      case "Shift":
        out.shift = true;
        break;
      case "Meta":
        out.meta = true;
        break;
      default:
        throw new Error(`unknown modifier "${m}" in shortcut "${shortcut}"`);
    }
  }
  if (out.ctrl && out.alt) throw new Error(`shortcut "${shortcut}": Ctrl+Alt is AltGr on some keyboard layouts`);
  if (FORBIDDEN_KEYS.has(keyToken)) throw new Error(`shortcut "${shortcut}": "${keyToken}" is not a plain key on every layout`);
  if (/^[0-9]$/.test(keyToken)) out.codes = [`Digit${keyToken}`, `Numpad${keyToken}`];
  else if (keyToken in PUNCTUATION_CODES) out.codes = [PUNCTUATION_CODES[keyToken]];
  else if (keyToken === "Space") out.codes = ["Space"];
  else if (keyToken.length === 1) out.key = keyToken.toLowerCase();
  else out.key = keyToken;
  return out;
}

export function matchesShortcut(p: ParsedShortcut, e: KeyboardEvent): boolean {
  // AltGr: never a shortcut.
  if (e.ctrlKey && e.altKey) return false;
  if (e.ctrlKey !== p.ctrl || e.altKey !== p.alt || e.shiftKey !== p.shift || e.metaKey !== p.meta) return false;
  if (p.codes) return p.codes.includes(e.code);
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return k === p.key;
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();
  private readonly shortcuts = new Map<string, ParsedShortcut>();

  constructor(private readonly isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)) {}

  register(command: Command): void {
    if (this.commands.has(command.id)) log.warn(`command "${command.id}" registered twice; the later one wins`);
    this.commands.set(command.id, command);
    this.shortcuts.delete(command.id);
    if (command.shortcut) this.shortcuts.set(command.id, parseShortcut(command.shortcut, this.isMac));
  }

  list(): Command[] {
    return [...this.commands.values()];
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  isEnabled(id: string): boolean {
    const c = this.commands.get(id);
    return !!c && (c.enabled ? c.enabled() : true);
  }

  /** Runs a command. Returns false if it doesn't exist or is disabled. Errors
   *  are logged, never thrown. */
  async run(id: string): Promise<boolean> {
    const c = this.commands.get(id);
    if (!c) {
      log.warn(`unknown command "${id}"`);
      return false;
    }
    if (c.enabled && !c.enabled()) return false;
    try {
      await c.run();
    } catch (e) {
      log.error(`command "${id}" failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
    return true;
  }

  /** The command whose shortcut matches this key event, if any. */
  find(e: KeyboardEvent): Command | undefined {
    for (const [id, p] of this.shortcuts) {
      if (matchesShortcut(p, e)) return this.commands.get(id);
    }
    return undefined;
  }

  /** Handles a keydown. Returns true if a command owned the key. */
  handleKeydown(e: KeyboardEvent): boolean {
    if (e.defaultPrevented || e.isComposing) return false;
    const c = this.find(e);
    if (!c) return false;
    // The app owns its shortcuts even while the command is disabled, so the
    // webview's own accelerator (e.g. Ctrl+O, Ctrl+S) doesn't kick in.
    e.preventDefault();
    void this.run(c.id);
    return true;
  }

  /** Installs the single keydown dispatcher. */
  attach(target: Pick<Document, "addEventListener"> = document): void {
    target.addEventListener("keydown", (e) => {
      this.handleKeydown(e as KeyboardEvent);
    });
  }
}

export const commands = new CommandRegistry();
