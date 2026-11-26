// The open documents: tabs, active tab, opening, saving, closing, drafts and
// the session. UI-free: dialogs and notifications are injected, so unit tests
// and the end-to-end hooks drive the same code.

import { EditorView } from "@codemirror/view";
import { createEditorState, createEditorView, type EditorOptions } from "../editor/createEditor";
import type { Host } from "../host/host";
import { Doc, detectLineSeparator, type LineSeparator } from "./doc";
import {
  clearDraft,
  decideDraft,
  draftKey,
  readDraft,
  readSession,
  writeDraft,
  writeSession,
  type Draft,
  type DraftStorage,
  type DraftStore,
} from "./drafts";
import { log } from "./log";
import { fileName, samePath, withDefaultExtension } from "./paths";

/** How long after the last change a draft is written. */
export const DRAFT_DELAY_MS = 1000;

export type CloseChoice = "save" | "saveAll" | "discard" | "cancel";

export interface WorkspaceDeps {
  host: Host;
  /** Drafts. */
  drafts: DraftStore;
  /** The session (open tabs); survives a renderer reload only. */
  session: DraftStorage;
  /** A short hint in the status bar (errors, "Not a Markdown file"). */
  hint(text: string): void;
  /** A non-blocking notification. */
  notify(text: string): void;
  /** Asks what to do with an unsaved document. `othersDirty` = more unsaved ones follow. */
  confirmClose(doc: Doc, othersDirty: number): Promise<CloseChoice>;
  /** Editor settings read when a document's editor state is created. */
  editorOptions?: () => EditorOptions;
  /** Test hooks: bypass the native dialogs. */
  overrides?: { nextPickPath: string[] | null; nextSavePath: string | null };
}

export interface DocSnapshot {
  id: string;
  path: string | null;
  title: string;
  dirty: boolean;
  active: boolean;
  lossy: boolean;
  bom: boolean;
  lineSeparator: LineSeparator;
  text: string;
  banner: string | null;
}

export class Workspace {
  docs: Doc[] = [];
  activeId: string | null = null;
  private listeners = new Set<() => void>();
  private nextId = 1;
  private untitledCount = 0;

  constructor(private readonly d: WorkspaceDeps) {}

  get active(): Doc | undefined {
    return this.docs.find((x) => x.id === this.activeId);
  }

  /** Called after any change to the tab list, the active tab, titles or dirty state. */
  onChange(cb: () => void): void {
    this.listeners.add(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  snapshot(): DocSnapshot[] {
    return this.docs.map((x) => ({
      id: x.id,
      path: x.path,
      title: x.title,
      dirty: x.isDirty,
      active: x.id === this.activeId,
      lossy: x.lossy,
      bom: x.bom,
      lineSeparator: x.lineSeparator,
      text: x.text,
      banner: x.banner?.kind ?? null,
    }));
  }

  findByPath(path: string): Doc | undefined {
    return this.docs.find((x) => x.path !== null && samePath(x.path, path));
  }

  // ------------------------------------------------------------------ views

  private extensionsFor(doc: Doc) {
    return [
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        this.scheduleDraft(doc);
        this.emit();
      }),
    ];
  }

  private makeView(doc: Doc, text: string): void {
    doc.view = createEditorView(createEditorState(text, doc.lineSeparator, this.extensionsFor(doc), this.d.editorOptions?.()));
  }

  // ------------------------------------------------------------------ drafts

  private keyOf(doc: Doc): string {
    return draftKey(doc.path, doc.id);
  }

  private scheduleDraft(doc: Doc): void {
    if (doc.draftTimer) clearTimeout(doc.draftTimer);
    doc.draftTimer = setTimeout(() => {
      doc.draftTimer = null;
      this.flushDraft(doc);
    }, DRAFT_DELAY_MS);
  }

  /** Writes the draft now if the document is dirty, removes it if not. */
  flushDraft(doc: Doc): void {
    if (doc.draftTimer) {
      clearTimeout(doc.draftTimer);
      doc.draftTimer = null;
    }
    if (!this.docs.includes(doc)) return;
    if (doc.isDirty) {
      void writeDraft(this.d.drafts, this.keyOf(doc), {
        text: doc.text,
        baseMtime: doc.mtime,
        bom: doc.bom,
        lineSeparator: doc.lineSeparator,
      });
    } else {
      void clearDraft(this.d.drafts, this.keyOf(doc));
    }
  }

  private dropDraft(doc: Doc, key = this.keyOf(doc)): void {
    if (doc.draftTimer) {
      clearTimeout(doc.draftTimer);
      doc.draftTimer = null;
    }
    void clearDraft(this.d.drafts, key);
  }

  /** Banner action: throw the restored draft away and show the file's text. */
  discardDraft(doc: Doc): void {
    this.dropDraft(doc);
    if (doc.banner?.kind === "restored") {
      const v = doc.view;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: doc.savedDoc } });
    }
    doc.banner = null;
    this.emit();
  }

  /** Banner action for an older draft: apply it over the file's current text. */
  async useDraft(doc: Doc): Promise<void> {
    const draft = await readDraft(this.d.drafts, this.keyOf(doc));
    doc.banner = null;
    if (draft) {
      doc.bom = draft.bom;
      doc.lineSeparator = draft.lineSeparator;
      doc.view.setState(createEditorState(draft.text, draft.lineSeparator, this.extensionsFor(doc), this.d.editorOptions?.()));
      this.scheduleDraft(doc);
    }
    this.emit();
  }

  // ------------------------------------------------------------------ session

  private writeSessionNow(): void {
    writeSession(this.d.session, {
      tabs: this.docs.map((x) => ({ path: x.path, id: x.id })),
      active: this.activeId,
    });
  }

  /** Reopens the tabs of the previous page load (after a renderer restart).
   *  Returns false if there was no session. */
  async restoreSession(): Promise<boolean> {
    const s = readSession(this.d.session);
    if (!s) return false;
    for (const t of s.tabs) {
      if (t.path) await this.open(t.path, { activate: false, id: t.id, quiet: true });
      else this.newDoc(t.id, await readDraft(this.d.drafts, draftKey(null, t.id)));
    }
    const active = this.docs.find((x) => x.id === s.active) ?? this.docs[this.docs.length - 1];
    if (active) this.activate(active.id);
    log.info(`session restored: ${this.docs.length} tab(s)`);
    return true;
  }

  // ------------------------------------------------------------------ opening

  /** Opens a file in a tab, or switches to its tab if it is open already. */
  async open(path: string, opts: { activate?: boolean; id?: string; quiet?: boolean } = {}): Promise<Doc | null> {
    const existing = this.findByPath(path);
    if (existing) {
      if (opts.activate !== false) this.activate(existing.id);
      return existing;
    }
    let data;
    try {
      data = await this.d.host.readFile(path);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      log.error(`open failed: ${path}: ${reason}`);
      this.d.hint(`Cannot open ${fileName(path)}: ${reason}`);
      return null;
    }
    // The same file may have been opened while we were reading it.
    const raced = this.findByPath(path);
    if (raced) {
      if (opts.activate !== false) this.activate(raced.id);
      return raced;
    }
    const sep = detectLineSeparator(data.text);
    const savedDoc = createEditorState(data.text, sep).doc;
    const doc = new Doc(opts.id ?? `t${this.nextId++}`, {
      path,
      bom: data.bom,
      lineSeparator: sep,
      savedDoc,
      mtime: data.mtime,
      lossy: data.lossy,
      untitledNo: 0,
    });
    this.bumpIdCounter(doc.id);
    if (data.lossy) log.warn(`opened with invalid UTF-8 bytes replaced: ${path}`);

    let startText = data.text;
    const draft = await readDraft(this.d.drafts, draftKey(path, doc.id));
    if (draft && draft.text !== data.text) {
      if (decideDraft(draft, data.mtime) === "restore") {
        startText = draft.text;
        doc.banner = { kind: "restored", text: "Unsaved changes restored" };
      } else {
        doc.banner = { kind: "stale", text: "An older unsaved draft exists" };
      }
    } else if (draft) {
      void clearDraft(this.d.drafts, draftKey(path, doc.id));
    }
    this.makeView(doc, startText);
    this.docs.push(doc);
    if (opts.activate !== false) this.activeId = doc.id;
    this.writeSessionNow();
    this.emit();
    if (!opts.quiet) log.info(`opened ${path}`);
    return doc;
  }

  async openMany(paths: string[]): Promise<void> {
    for (const p of paths) await this.open(p);
  }

  private bumpIdCounter(id: string): void {
    const m = /^t(\d+)$/.exec(id);
    if (m) this.nextId = Math.max(this.nextId, Number(m[1]) + 1);
  }

  /** An empty untitled document (Ctrl+N). */
  newDoc(id?: string, draft: Draft | null = null): Doc {
    const docId = id ?? `t${this.nextId++}`;
    this.bumpIdCounter(docId);
    const doc = new Doc(docId, {
      path: null,
      bom: false,
      lineSeparator: "\n",
      savedDoc: createEditorState("", "\n").doc,
      mtime: 0,
      lossy: false,
      untitledNo: ++this.untitledCount,
    });
    this.makeView(doc, draft?.text ?? "");
    if (draft?.text) doc.banner = { kind: "restored", text: "Unsaved changes restored" };
    this.docs.push(doc);
    this.activeId = doc.id;
    this.writeSessionNow();
    this.emit();
    return doc;
  }

  /** Ctrl+O. */
  async openDialog(): Promise<void> {
    let paths: string[];
    const o = this.d.overrides;
    if (o?.nextPickPath) {
      paths = o.nextPickPath;
      o.nextPickPath = null;
    } else {
      paths = await this.d.host.pickFiles();
    }
    await this.openMany(paths);
  }

  // ------------------------------------------------------------------ tabs

  activate(id: string): void {
    if (this.activeId === id || !this.docs.some((x) => x.id === id)) return;
    this.activeId = id;
    this.writeSessionNow();
    this.emit();
  }

  /** Switches to the next (delta 1) or previous (delta -1) tab, wrapping around. */
  cycle(delta: number): void {
    if (this.docs.length < 2) return;
    const i = this.docs.findIndex((x) => x.id === this.activeId);
    const n = this.docs.length;
    this.activate(this.docs[(((i + delta) % n) + n) % n].id);
  }

  /** Puts the tabs in this order (ids not listed keep their relative order at the end). */
  reorder(ids: string[]): void {
    const byId = new Map(this.docs.map((x) => [x.id, x]));
    const next = ids.map((i) => byId.get(i)).filter((x): x is Doc => !!x);
    for (const x of this.docs) if (!next.includes(x)) next.push(x);
    if (next.every((x, i) => x === this.docs[i])) return;
    this.docs = next;
    this.writeSessionNow();
    this.emit();
  }

  // ------------------------------------------------------------------ saving

  async save(doc: Doc | undefined = this.active): Promise<boolean> {
    if (!doc) return false;
    return doc.path ? this.write(doc, doc.path) : this.saveAs(doc);
  }

  async saveAs(doc: Doc | undefined = this.active): Promise<boolean> {
    if (!doc) return false;
    let chosen: string | null;
    const o = this.d.overrides;
    if (o?.nextSavePath) {
      chosen = o.nextSavePath;
      o.nextSavePath = null;
    } else {
      chosen = await this.d.host.pickSavePath(doc.path ? fileName(doc.path) : `${doc.title}.md`);
    }
    if (!chosen) return false;
    return this.write(doc, withDefaultExtension(chosen));
  }

  private async write(doc: Doc, path: string): Promise<boolean> {
    // What is written is what counts as saved, even if typing continues meanwhile.
    const snapshot = doc.view.state.doc;
    const text = doc.text;
    let mtime: number;
    try {
      ({ mtime } = await this.d.host.writeFile(path, text, doc.bom));
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      log.error(`save failed: ${path}: ${reason}`);
      this.d.hint(`Cannot save ${fileName(path)}: ${reason}`);
      return false;
    }
    const oldKey = this.keyOf(doc);
    doc.path = path;
    doc.savedDoc = snapshot;
    doc.mtime = mtime;
    this.dropDraft(doc, oldKey);
    this.dropDraft(doc);
    if (doc.banner) doc.banner = null;
    if (doc.lossy) {
      doc.lossy = false;
      log.warn(`saved with invalid UTF-8 bytes replaced by U+FFFD: ${path}`);
      this.d.notify(`Saved ${fileName(path)}. Invalid UTF-8 bytes in the original file were replaced with U+FFFD (�).`);
    }
    log.info(`saved ${path}`);
    // Typing during the write leaves the document dirty: keep its draft.
    if (doc.isDirty) this.scheduleDraft(doc);
    this.writeSessionNow();
    this.emit();
    return true;
  }

  // ------------------------------------------------------------------ closing

  /** Asks about every unsaved document in `docs` (saving if the user says so).
   *  Returns false if the user cancelled. Nothing is closed here. */
  private async settle(docs: Doc[]): Promise<boolean> {
    let saveAll = false;
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      if (!doc.isDirty) continue;
      if (saveAll) {
        if (!(await this.save(doc))) return false;
        continue;
      }
      const othersDirty = docs.slice(i + 1).filter((x) => x.isDirty).length;
      this.activate(doc.id);
      const choice = await this.d.confirmClose(doc, othersDirty);
      if (choice === "cancel") return false;
      if (choice === "discard") {
        this.dropDraft(doc);
        continue;
      }
      if (choice === "saveAll") saveAll = true;
      if (!(await this.save(doc))) return false;
    }
    return true;
  }

  private remove(doc: Doc): void {
    const i = this.docs.indexOf(doc);
    if (i < 0) return;
    this.docs.splice(i, 1);
    if (doc.draftTimer) clearTimeout(doc.draftTimer);
    doc.view.destroy();
    if (this.activeId === doc.id) this.activeId = (this.docs[i] ?? this.docs[i - 1])?.id ?? null;
  }

  /** Closes the given tabs, asking about unsaved ones. False if cancelled. */
  async close(docs: Doc[]): Promise<boolean> {
    const list = this.docs.filter((x) => docs.includes(x));
    if (!(await this.settle(list))) {
      this.emit();
      return false;
    }
    // Discarded or saved: now the draft files must go with the tabs.
    for (const doc of list) {
      this.dropDraft(doc);
      this.remove(doc);
    }
    this.writeSessionNow();
    this.emit();
    return true;
  }

  closeActive(): Promise<boolean> {
    const a = this.active;
    return a ? this.close([a]) : Promise.resolve(true);
  }

  closeAll(): Promise<boolean> {
    return this.close([...this.docs]);
  }

  closeOthers(): Promise<boolean> {
    return this.close(this.docs.filter((x) => x.id !== this.activeId));
  }

  /** Window close: asks about every unsaved document; tabs stay as they are. */
  confirmWindowClose(): Promise<boolean> {
    return this.settle([...this.docs]);
  }
}
