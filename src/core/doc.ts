// One Doc per tab: path, encoding flags, the text at last save, and the
// CodeMirror view that owns the live text, undo history and scroll position.
// The editor's document is the single source of truth (plan §3).

import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { fileName } from "./paths";

export type LineSeparator = "\n" | "\r\n";

/** The file's own line separator: the first line break decides. LF if there is none. */
export function detectLineSeparator(text: string): LineSeparator {
  const i = text.indexOf("\n");
  return i > 0 && text[i - 1] === "\r" ? "\r\n" : "\n";
}

export interface BannerState {
  kind: "restored" | "stale";
  text: string;
}

export interface DocInit {
  path: string | null;
  bom: boolean;
  lineSeparator: LineSeparator;
  savedDoc: Text;
  mtime: number;
  lossy: boolean;
  untitledNo: number;
}

export class Doc {
  path: string | null;
  bom: boolean;
  lineSeparator: LineSeparator;
  /** The editor's document at the last save or read. */
  savedDoc: Text;
  /** The file's modification time at the last read or save. */
  mtime: number;
  /** The file had invalid UTF-8: saving replaces those bytes for good. */
  lossy: boolean;
  readonly untitledNo: number;
  /** Set by the workspace right after creation. */
  view!: EditorView;
  scrollTop = 0;
  banner: BannerState | null = null;
  draftTimer: ReturnType<typeof setTimeout> | null = null;
  /** Slots later steps fill: mode (S04), fold state (S06). */
  mode?: string;
  fold?: unknown;

  constructor(
    readonly id: string,
    init: DocInit,
  ) {
    this.path = init.path;
    this.bom = init.bom;
    this.lineSeparator = init.lineSeparator;
    this.savedDoc = init.savedDoc;
    this.mtime = init.mtime;
    this.lossy = init.lossy;
    this.untitledNo = init.untitledNo;
  }

  get isDirty(): boolean {
    return !this.view.state.doc.eq(this.savedDoc);
  }

  /** The text as it goes to disk: lines joined with the file's own separator. */
  get text(): string {
    return this.view.state.sliceDoc();
  }

  get title(): string {
    return this.path ? fileName(this.path) : this.untitledNo > 1 ? `Untitled ${this.untitledNo}` : "Untitled";
  }
}
