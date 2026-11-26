import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandRegistry, parseShortcut } from "./commands";
import { installLogging } from "./log";

const logged: string[] = [];

function key(init: KeyboardEventInit & { key: string }): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

beforeEach(() => {
  logged.length = 0;
  installLogging({ log: (level, message) => logged.push(`${level}: ${message}`) }, window);
});

describe("CommandRegistry", () => {
  it("registers, lists and runs a command", async () => {
    const reg = new CommandRegistry(false);
    const run = vi.fn();
    reg.register({ id: "a", label: "A", run });
    expect(reg.list().map((c) => c.id)).toEqual(["a"]);
    expect(await reg.run("a")).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not run a disabled command", async () => {
    const reg = new CommandRegistry(false);
    const run = vi.fn();
    reg.register({ id: "a", label: "A", run, enabled: () => false });
    expect(reg.isEnabled("a")).toBe(false);
    expect(await reg.run("a")).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("logs a warning for an unknown id", async () => {
    const reg = new CommandRegistry(false);
    expect(await reg.run("nope")).toBe(false);
    expect(logged).toEqual(['warn: unknown command "nope"']);
  });

  it("logs a failing command instead of throwing", async () => {
    const reg = new CommandRegistry(false);
    reg.register({
      id: "boom",
      label: "Boom",
      run: () => {
        throw new Error("kaboom");
      },
    });
    await expect(reg.run("boom")).resolves.toBe(true);
    expect(logged.some((l) => l.startsWith("error:") && l.includes("kaboom"))).toBe(true);
  });
});

describe("shortcuts", () => {
  it("Mod-o is Ctrl+O on Windows", () => {
    const reg = new CommandRegistry(false);
    const run = vi.fn();
    reg.register({ id: "open", label: "Open", shortcut: "Mod-o", run });
    const e = key({ key: "o", code: "KeyO", ctrlKey: true });
    expect(reg.handleKeydown(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("Mod-o is Cmd+O on macOS and not Ctrl+O", () => {
    const reg = new CommandRegistry(true);
    reg.register({ id: "open", label: "Open", shortcut: "Mod-o", run: () => {} });
    expect(reg.find(key({ key: "o", code: "KeyO", metaKey: true }))?.id).toBe("open");
    expect(reg.find(key({ key: "o", code: "KeyO", ctrlKey: true }))).toBeUndefined();
  });

  it("letters ignore case, so Shift+letter needs an explicit Shift", () => {
    const reg = new CommandRegistry(false);
    reg.register({ id: "p", label: "P", shortcut: "Mod-Shift-p", run: () => {} });
    expect(reg.find(key({ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }))?.id).toBe("p");
    expect(reg.find(key({ key: "p", code: "KeyP", ctrlKey: true }))).toBeUndefined();
  });

  it("modifiers must match exactly", () => {
    const reg = new CommandRegistry(false);
    reg.register({ id: "s", label: "S", shortcut: "Mod-s", run: () => {} });
    expect(reg.find(key({ key: "s", code: "KeyS", ctrlKey: true, shiftKey: true }))).toBeUndefined();
    expect(reg.find(key({ key: "s", code: "KeyS" }))).toBeUndefined();
  });

  it("digits match by physical key, whatever character Shift produces", () => {
    const reg = new CommandRegistry(false);
    reg.register({ id: "h1", label: "H1", shortcut: "Mod-1", run: () => {} });
    expect(reg.find(key({ key: "1", code: "Digit1", ctrlKey: true }))?.id).toBe("h1");
    // Hungarian layout: the key above Q gives "1"; with other layouts or Shift it differs.
    expect(reg.find(key({ key: "'", code: "Digit1", ctrlKey: true }))?.id).toBe("h1");
    expect(reg.find(key({ key: "1", code: "KeyQ", ctrlKey: true }))).toBeUndefined();
  });

  it("punctuation matches by physical key", () => {
    const reg = new CommandRegistry(false);
    reg.register({ id: "minus", label: "Minus", shortcut: "Mod--", run: () => {} });
    reg.register({ id: "comma", label: "Comma", shortcut: "Mod-,", run: () => {} });
    expect(reg.find(key({ key: "-", code: "Minus", ctrlKey: true }))?.id).toBe("minus");
    expect(reg.find(key({ key: ",", code: "Comma", ctrlKey: true }))?.id).toBe("comma");
  });

  it("named keys", () => {
    const reg = new CommandRegistry(false);
    reg.register({ id: "about", label: "About", shortcut: "F1", run: () => {} });
    reg.register({ id: "back", label: "Back", shortcut: "Alt-ArrowLeft", run: () => {} });
    expect(reg.find(key({ key: "F1", code: "F1" }))?.id).toBe("about");
    expect(reg.find(key({ key: "ArrowLeft", code: "ArrowLeft", altKey: true }))?.id).toBe("back");
  });

  it("refuses Ctrl+Alt shortcuts (AltGr on a Hungarian keyboard)", () => {
    expect(() => parseShortcut("Mod-Alt-x")).toThrow(/AltGr/);
    expect(() => parseShortcut("Ctrl-Alt-x")).toThrow(/AltGr/);
    expect(() => parseShortcut("Alt-x")).not.toThrow();
  });

  it("refuses keys that aren't plain keys on every layout", () => {
    for (const k of ["[", "]", "\\", "`"]) expect(() => parseShortcut(`Mod-${k}`)).toThrow();
  });

  it("never matches an event with Ctrl and Alt together (AltGr)", () => {
    const reg = new CommandRegistry(false);
    reg.register({ id: "q", label: "Q", shortcut: "Mod-q", run: () => {} });
    expect(reg.find(key({ key: "q", code: "KeyQ", ctrlKey: true, altKey: true }))).toBeUndefined();
  });

  it("swallows the key of a disabled command without running it", () => {
    const reg = new CommandRegistry(false);
    const run = vi.fn();
    reg.register({ id: "s", label: "S", shortcut: "Mod-s", run, enabled: () => false });
    const e = key({ key: "s", code: "KeyS", ctrlKey: true });
    expect(reg.handleKeydown(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores events another handler already consumed", () => {
    const reg = new CommandRegistry(false);
    const run = vi.fn();
    reg.register({ id: "o", label: "O", shortcut: "Mod-o", run });
    const e = key({ key: "o", code: "KeyO", ctrlKey: true });
    e.preventDefault();
    expect(reg.handleKeydown(e)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("attach() installs one keydown dispatcher", async () => {
    const reg = new CommandRegistry(false);
    const run = vi.fn();
    reg.register({ id: "o", label: "O", shortcut: "Mod-o", run });
    reg.attach(document);
    document.dispatchEvent(key({ key: "o", code: "KeyO", ctrlKey: true }));
    await Promise.resolve();
    expect(run).toHaveBeenCalledOnce();
  });
});
