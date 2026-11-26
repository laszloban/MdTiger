import { describe, expect, it } from "vitest";
import { clearDraft, decideDraft, draftKey, readDraft, readSession, writeDraft, writeSession } from "./drafts";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

function store() {
  const m = memory();
  return {
    get: async (k: string) => m.getItem(k),
    set: async (k: string, v: string) => m.setItem(k, v),
    remove: async (k: string) => m.removeItem(k),
  };
}

describe("drafts", () => {
  const draft = { text: "a\r\nb", baseMtime: 100, bom: true, lineSeparator: "\r\n" as const };

  it("writes, reads and clears", async () => {
    const s = store();
    const key = draftKey("C:\\a\\b.md", "t1");
    expect(await readDraft(s, key)).toBeNull();
    await writeDraft(s, key, draft);
    expect(await readDraft(s, key)).toEqual(draft);
    await clearDraft(s, key);
    expect(await readDraft(s, key)).toBeNull();
  });

  it("keys files by normalised path and untitled documents by id", () => {
    expect(draftKey("C:\\A\\b.md", "t1")).toBe(draftKey("c:/a/B.md", "t9"));
    expect(draftKey(null, "t1")).not.toBe(draftKey(null, "t2"));
    expect(draftKey(null, "t1")).not.toBe(draftKey("t1", "t1"));
  });

  it("ignores unusable stored values", async () => {
    const s = store();
    await s.set("k", "not json");
    expect(await readDraft(s, "k")).toBeNull();
    await s.set("k", JSON.stringify({ text: 5 }));
    expect(await readDraft(s, "k")).toBeNull();
  });

  it("survives a store that throws", async () => {
    const fail = async () => {
      throw new Error("x");
    };
    const broken = { get: fail, set: fail, remove: fail };
    await writeDraft(broken, "k", draft);
    expect(await readDraft(broken, "k")).toBeNull();
    await clearDraft(broken, "k");
  });

  it("restores on the same mtime and flags a draft of a changed file as stale", () => {
    expect(decideDraft(draft, 100)).toBe("restore");
    expect(decideDraft(draft, 101)).toBe("stale");
  });

  it("round-trips the session and rejects an empty one", () => {
    const s = memory();
    expect(readSession(s)).toBeNull();
    const session = { tabs: [{ path: "C:\\a.md", id: "t1" }, { path: null, id: "t2" }], active: "t2" };
    writeSession(s, session);
    expect(readSession(s)).toEqual(session);
    writeSession(s, { tabs: [], active: null });
    expect(readSession(s)).toBeNull();
  });
});
