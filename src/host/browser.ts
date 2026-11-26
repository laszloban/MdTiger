import type { Host } from "./host";

const SETTINGS_KEY = "mdtiger.settings";

// Development host: runs in a normal browser against the Vite dev server,
// which serves tests/fixtures. Saving stays in memory; settings go to
// localStorage.
export function createBrowserHost(): Host {
  const written = new Map<string, string>();
  return {
    name: "browser",
    async initialFiles() {
      const q = new URLSearchParams(location.search).get("file");
      return q ? [q] : [];
    },
    async readFile(path) {
      if (written.has(path)) return { text: written.get(path)!, bom: false, mtime: Date.now() };
      const r = await fetch("./" + path.replace(/\\/g, "/"));
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      const text = new TextDecoder().decode(bom ? buf.subarray(3) : buf);
      return { text, bom, mtime: Date.now() };
    },
    async writeFile(path, text) {
      written.set(path, text);
      return { mtime: Date.now() };
    },
    async stat() {
      return { mtime: 0 };
    },
    onEvent() {},
    async settingsRead() {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        const v = raw ? JSON.parse(raw) : null;
        return v && typeof v === "object" && !Array.isArray(v) ? v : null;
      } catch {
        return null;
      }
    },
    async settingsWrite(settings) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings, null, 2));
    },
    ready(info) {
      console.info(`[mdtiger] ready after ${info.msSinceNavigation.toFixed(0)} ms`);
    },
    log(level, message) {
      console[level](`[mdtiger] ${message}`);
    },
  };
}
