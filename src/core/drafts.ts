// Drafts: unsaved text is copied to a draft store shortly after each change, so
// a crash, a killed renderer or a killed app never loses typing (NFR-10). The
// store is the shell's profile folder (host.draft*): localStorage would commit
// only seconds later and lose the last edits when the app is killed. The
// session (open tabs) lives in sessionStorage: it survives a renderer reload
// but not an app restart.

import { normalizePath } from "./paths";

export interface Draft {
  text: string;
  /** The file's mtime when the draft was made. */
  baseMtime: number;
  bom: boolean;
  lineSeparator: "\n" | "\r\n";
}

/** Where drafts live (async: the shell writes files). */
export interface DraftStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** The sessionStorage subset the session uses. */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PREFIX = "mdtiger.draft:";

export function draftKey(path: string | null, untitledId: string): string {
  return PREFIX + (path ? `file:${normalizePath(path)}` : `untitled:${untitledId}`);
}

export async function writeDraft(store: DraftStore, key: string, draft: Draft): Promise<void> {
  try {
    await store.set(key, JSON.stringify(draft));
  } catch {
    /* a draft is best effort */
  }
}

export async function readDraft(store: DraftStore, key: string): Promise<Draft | null> {
  try {
    const raw = await store.get(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (typeof d.text !== "string" || typeof d.baseMtime !== "number") return null;
    return {
      text: d.text,
      baseMtime: d.baseMtime,
      bom: d.bom === true,
      lineSeparator: d.lineSeparator === "\r\n" ? "\r\n" : "\n",
    };
  } catch {
    return null;
  }
}

export async function clearDraft(store: DraftStore, key: string): Promise<void> {
  try {
    await store.remove(key);
  } catch {
    /* ignore */
  }
}

/** Same mtime: the file is as the draft left it, restore it. Otherwise the
 *  file changed since, so the draft must not be applied silently. */
export function decideDraft(draft: Draft, fileMtime: number): "restore" | "stale" {
  return draft.baseMtime === fileMtime ? "restore" : "stale";
}

// ------------------------------------------------------------- session

export interface SessionTab {
  /** Null for an untitled document. */
  path: string | null;
  id: string;
}

export interface Session {
  tabs: SessionTab[];
  active: string | null;
}

const SESSION_KEY = "mdtiger.session";

export function writeSession(storage: DraftStorage, session: Session): void {
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function readSession(storage: DraftStorage): Session | null {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session>;
    if (!Array.isArray(s.tabs)) return null;
    const tabs = s.tabs.filter((t): t is SessionTab => !!t && typeof t.id === "string" && (t.path === null || typeof t.path === "string"));
    return tabs.length ? { tabs, active: typeof s.active === "string" ? s.active : null } : null;
  } catch {
    return null;
  }
}
