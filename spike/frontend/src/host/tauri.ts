import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DefaultAppStatus, FileData, Host, HostEvent } from "./host";

export function createTauriHost(): Host {
  return {
    name: "tauri",
    initialFiles: () => invoke<string[]>("initial_files"),
    readFile: (path) => invoke<FileData>("read_file", { path }),
    writeFile: (path, text, bom) => invoke<{ mtime: number }>("write_file", { path, text, bom }),
    stat: (path) => invoke<{ mtime: number } | null>("stat_file", { path }),
    watch: (path) => invoke<void>("watch_file", { path }),
    unwatch: (path) => invoke<void>("unwatch_file", { path }),
    onEvent(handler) {
      void listen<HostEvent>("host-event", (e) => handler(e.payload));
    },
    async pickFile() {
      const r = await open({ multiple: false, filters: [{ name: "Markdown", extensions: ["md", "markdown"] }] });
      return typeof r === "string" ? r : null;
    },
    fileUrl: (path) => convertFileSrc(path),
    openExternal: (url) => openUrl(url),
    defaultAppStatus: () => invoke<DefaultAppStatus>("default_app_status"),
    openDefaultAppsSettings: () => invoke<void>("open_default_apps_settings"),
    ready(info) {
      void invoke("spike_ready", { msSinceNavigation: info.msSinceNavigation });
    },
    log(level, message) {
      void invoke("log_msg", { level, message }).catch(() => {});
    },
  };
}
