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
