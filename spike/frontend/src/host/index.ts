import type { Host } from "./host";
import { createBrowserHost } from "./browser";

/** Picks the shell implementation. Tauri and WPF hosts are loaded lazily so
 *  the browser build doesn't pull in the Tauri API, and vice versa. */
export async function detectHost(): Promise<Host> {
  const w = window as any;
  if (w.__TAURI_INTERNALS__) return (await import("./tauri")).createTauriHost();
  if (w.chrome?.webview) return (await import("./wpf")).createWpfHost();
  return createBrowserHost();
}
