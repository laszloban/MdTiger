import type { DefaultAppStatus, FileData, Host, HostEvent } from "./host";

// WebView2 bridge: requests are {id, method, args}; the C# side answers with
// {id, result} or {id, error}, and pushes events as {event: HostEvent}.
interface WebView2 {
  postMessage(msg: unknown): void;
  addEventListener(type: "message", cb: (e: { data: any }) => void): void;
}

export function createWpfHost(): Host {
  const wv = (window as any).chrome.webview as WebView2;
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const handlers: ((e: HostEvent) => void)[] = [];

  wv.addEventListener("message", (e) => {
    const m = e.data;
    if (m && m.event) {
      for (const h of handlers) h(m.event as HostEvent);
      return;
    }
    const p = pending.get(m?.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(m.result);
  });

  function call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      wv.postMessage({ id, method, args });
    });
  }

  return {
    name: "wpf",
    initialFiles: () => call<string[]>("initialFiles"),
    readFile: (path) => call<FileData>("readFile", { path }),
    writeFile: (path, text, bom) => call<{ mtime: number }>("writeFile", { path, text, bom }),
    stat: (path) => call<{ mtime: number } | null>("stat", { path }),
    watch: (path) => call<void>("watch", { path }),
    unwatch: (path) => call<void>("unwatch", { path }),
    onEvent: (h) => void handlers.push(h),
    pickFile: () => call<string | null>("pickFile"),
    // Served by the C# side through WebResourceRequested.
    fileUrl: (path) => "https://local.mdtiger/file?path=" + encodeURIComponent(path),
    openExternal: (url) => call<void>("openExternal", { url }),
    defaultAppStatus: () => call<DefaultAppStatus>("defaultAppStatus"),
    openDefaultAppsSettings: () => call<void>("openDefaultAppsSettings"),
    ready: (info) => void call("ready", info).catch(() => {}),
    log: (level, message) => void call("log", { level, message }).catch(() => {}),
  };
}
