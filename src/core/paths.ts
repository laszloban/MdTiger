// Path helpers. Windows paths compare case-insensitively and accept either
// separator, so two spellings of one file must map to one key.

/** Canonical form for comparing and keying: backslashes, lower case. */
export function normalizePath(path: string): string {
  return path.replace(/\//g, "\\").toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

export function fileName(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i < 0 ? path : path.slice(i + 1);
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/** Appends ".md" if the last path segment has no extension. */
export function withDefaultExtension(path: string): string {
  return /\.[^\\/.]+$/.test(fileName(path)) ? path : `${path}.md`;
}
