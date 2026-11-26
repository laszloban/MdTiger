// The only boundary between the front end and its shell (Tauri, or a plain
// browser for development). Everything platform-specific goes through this
// interface, so the shell can be swapped without touching the editor.
//
// Later steps add methods here as they need them (watching files: S10, file
// dialog: S02, external links: S05, default app: S09).

export interface FileData {
  /** Decoded text, without the BOM. Line endings are kept as they are. */
  text: string;
  /** True if the file started with a UTF-8 BOM. */
  bom: boolean;
  /** Last write time, milliseconds since epoch. */
  mtime: number;
}

export type HostEvent =
  /** Another launch asked to open a file (single instance), or a file was dropped. */
  { type: "open"; path: string };

export type LogLevel = "info" | "warn" | "error";

export interface Host {
  readonly name: "tauri" | "browser";
  /** Files passed on the command line at startup. Same list on every call. */
  initialFiles(): Promise<string[]>;
  /** Rejects with a message string if the file can't be read. */
  readFile(path: string): Promise<FileData>;
  /** Atomic write; returns the new modification time. */
  writeFile(path: string, text: string, bom: boolean): Promise<{ mtime: number }>;
  /** Returns null if the file no longer exists. */
  stat(path: string): Promise<{ mtime: number } | null>;
  onEvent(handler: (e: HostEvent) => void): void;
  /** The stored settings object, or null if there is none (or it was unusable). */
  settingsRead(): Promise<Record<string, unknown> | null>;
  settingsWrite(settings: Record<string, unknown>): Promise<void>;
  /** Called once the first frame is painted: the shell shows its window. */
  ready(info: { msSinceNavigation: number }): void;
  log(level: LogLevel, message: string): void;
}

/** Resolves a path relative to a document, for images and .md links. */
export function resolvePath(docPath: string, rel: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith("\\\\") || rel.startsWith("/")) return rel;
  const sep = docPath.includes("\\") ? "\\" : "/";
  const parts = docPath.split(/[\\/]/);
  parts.pop();
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join(sep);
}
