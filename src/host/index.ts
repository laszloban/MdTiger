import type { Host } from "./host";
import { createBrowserHost } from "./browser";

/** Picks the shell implementation. The Tauri host is loaded lazily so the
 *  browser (dev) build doesn't need the Tauri API at runtime. */
export async function detectHost(): Promise<Host> {
  if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    return (await import("./tauri")).createTauriHost();
  }
  return createBrowserHost();
}
