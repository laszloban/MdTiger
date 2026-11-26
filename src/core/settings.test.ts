import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS, SAVE_DELAY_MS, SettingsStore } from "./settings";

type Stored = Record<string, unknown> | null;

function fakeHost(initial: Stored) {
  const writes: Record<string, unknown>[] = [];
  return {
    writes,
    host: {
      settingsRead: async () => initial,
      settingsWrite: async (s: Record<string, unknown>) => {
        writes.push(s);
      },
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SettingsStore", () => {
  it("uses the defaults when there is no file", async () => {
    const { host } = fakeHost(null);
    const s = new SettingsStore(host);
    await s.load();
    expect(s.get("theme")).toBe(DEFAULTS.theme);
    expect(s.get("outline.visible")).toBe(true);
    expect(s.get("outline.width")).toBe(260);
  });

  it("file values override the defaults", async () => {
    const { host } = fakeHost({ theme: "dark", "outline.width": 300 });
    const s = new SettingsStore(host);
    await s.load();
    expect(s.get("theme")).toBe("dark");
    expect(s.get("outline.width")).toBe(300);
    expect(s.get("outline.visible")).toBe(true);
  });

  it("ignores values of the wrong type", async () => {
    const { host } = fakeHost({ theme: "purple", "outline.visible": "yes", "outline.width": -5 });
    const s = new SettingsStore(host);
    await s.load();
    expect(s.get("theme")).toBe("system");
    expect(s.get("outline.visible")).toBe(true);
    expect(s.get("outline.width")).toBe(260);
  });

  it("falls back to defaults when reading fails", async () => {
    const s = new SettingsStore({
      settingsRead: async () => {
        throw new Error("disk on fire");
      },
      settingsWrite: async () => {},
    });
    await s.load();
    expect(s.get("theme")).toBe("system");
  });

  it("keeps unknown keys when saving", async () => {
    const { host, writes } = fakeHost({ theme: "light", "future.key": { a: [1, 2] } });
    const s = new SettingsStore(host);
    await s.load();
    s.set("theme", "dark");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ ...DEFAULTS, theme: "dark", "future.key": { a: [1, 2] } });
  });

  it("several set calls within the delay cause one write", async () => {
    const { host, writes } = fakeHost(null);
    const s = new SettingsStore(host);
    await s.load();
    s.set("theme", "dark");
    await vi.advanceTimersByTimeAsync(100);
    s.set("outline.width", 320);
    await vi.advanceTimersByTimeAsync(100);
    s.set("outline.visible", false);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ theme: "dark", "outline.width": 320, "outline.visible": false });
  });

  it("setting the same value again doesn't schedule a write", async () => {
    const { host, writes } = fakeHost(null);
    const s = new SettingsStore(host);
    await s.load();
    s.set("theme", "system");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(writes).toHaveLength(0);
  });

  it("flush() saves immediately", async () => {
    const { host, writes } = fakeHost(null);
    const s = new SettingsStore(host);
    await s.load();
    s.set("theme", "dark");
    await s.flush();
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(writes).toHaveLength(1);
  });

  it("onChange fires on a change, not on an unchanged set, and can unsubscribe", async () => {
    const { host } = fakeHost(null);
    const s = new SettingsStore(host);
    await s.load();
    const handler = vi.fn();
    const off = s.onChange("theme", handler);
    s.set("theme", "dark");
    s.set("theme", "dark");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("dark", "theme");
    off();
    s.set("theme", "light");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("a failing save is logged, not thrown, and later saves still work", async () => {
    let fail = true;
    const writes: unknown[] = [];
    const s = new SettingsStore({
      settingsRead: async () => null,
      settingsWrite: async (v) => {
        if (fail) throw new Error("locked");
        writes.push(v);
      },
    });
    await s.load();
    s.set("theme", "dark");
    await expect(s.flush()).resolves.toBeUndefined();
    fail = false;
    s.set("theme", "light");
    await s.flush();
    expect(writes).toHaveLength(1);
  });
});
