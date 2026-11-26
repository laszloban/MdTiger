import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { FileData, Host, HostEvent } from "./host";

export function createTauriHost(): Host {
  return {
    name: "tauri",
    initialFiles: () => invoke<string[]>("initial_files"),
    readFile: (path) => invoke<FileData>("read_file", { path }),
    writeFile: (path, text, bom) => invoke<{ mtime: number }>("write_file", { path, text, bom }),
    stat: (path) => invoke<{ mtime: number } | null>("stat_file", { path }),
    pickFiles: () => invoke<string[]>("pick_files"),
    pickSavePath: (defaultName) => invoke<string | null>("pick_save_path", { defaultName }),
    setTitle(title) {
      void invoke("set_title", { title }).catch(() => {});
    },
    testMode: () => invoke<boolean>("is_test_mode"),
    onCloseRequest(handler) {
      void listen("close-requested", async () => {
        // Tell the shell the page is alive, and keep telling it while the
        // user decides: silence means a frozen page and the shell closes anyway.
        void invoke("close_ack").catch(() => {});
        const beat = setInterval(() => void invoke("close_ack").catch(() => {}), 1000);
        let allow = false;
        try {
          allow = await handler();
        } catch {
          allow = true; // a broken handler must not make the window unclosable
        } finally {
          clearInterval(beat);
        }
        await invoke("close_response", { allow }).catch(() => {});
      });
    },
    draftGet: (key) => invoke<string | null>("draft_read", { key }),
    draftSet: (key, value) => invoke<void>("draft_write", { key, value }),
    draftRemove: (key) => invoke<void>("draft_clear", { key }),
    onEvent(handler) {
      void listen<HostEvent>("host-event", (e) => handler(e.payload));
    },
    settingsRead: () => invoke<Record<string, unknown> | null>("settings_read"),
    settingsWrite: (settings) => invoke<void>("settings_write", { json: settings }),
    ready(info) {
      void invoke("app_ready", { msSinceNavigation: info.msSinceNavigation });
    },
    log(level, message) {
      void invoke("log_msg", { level, message }).catch(() => {});
    },
  };
}
