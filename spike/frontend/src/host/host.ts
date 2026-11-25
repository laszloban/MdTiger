// The only boundary between the front end and its shell (Tauri, WPF, or a
// plain browser for development). Everything platform-specific goes through
// this interface, so the shell can be swapped without touching the editor.

export interface FileData {
  /** Decoded text, without the BOM. */
  text: string;
  /** True if the file started with a UTF-8 BOM. */
  bom: boolean;
  /** Last write time, milliseconds since epoch. */
  mtime: number;
}

export type HostEvent =
  /** Another launch asked to open a file (single instance), or a file was dropped. */
  | { type: "open"; path: string }
  /** A watched file changed on disk. */
  | { type: "changed"; path: string }
  /** The machine resumed from sleep/hibernate (when the shell can tell). */
  | { type: "resumed" };

export interface DefaultAppStatus {
  isDefault: boolean;
  /** ProgId currently registered as the user's choice for .md, if any. */
  currentProgId: string | null;
}

export interface Host {
  readonly name: "tauri" | "wpf" | "browser";
  /** Files passed on the command line at startup. */
  initialFiles(): Promise<string[]>;
  readFile(path: string): Promise<FileData>;
  writeFile(path: string, text: string, bom: boolean): Promise<{ mtime: number }>;
  /** Returns null if the file no longer exists. */
  stat(path: string): Promise<{ mtime: number } | null>;
  watch(path: string): Promise<void>;
  unwatch(path: string): Promise<void>;
  onEvent(handler: (e: HostEvent) => void): void;
  pickFile(): Promise<string | null>;
  /** A URL the WebView can load a local file from (images). */
  fileUrl(path: string): string;
  openExternal(url: string): Promise<void>;
  defaultAppStatus(): Promise<DefaultAppStatus>;
  openDefaultAppsSettings(): Promise<void>;
  /** Called once the first document is rendered and the window is usable. */
  ready(info: { msSinceNavigation: number }): void;
  log(level: "info" | "warn" | "error", message: string): void;
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
