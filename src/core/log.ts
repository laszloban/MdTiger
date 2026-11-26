// NFR-11: errors are logged through the host, never shown as dialogs.

import type { Host, LogLevel } from "../host/host";

let sink: Pick<Host, "log"> | null = null;

function write(level: LogLevel, message: string): void {
  if (sink) sink.log(level, message);
  else console[level](`[mdtiger] ${message}`);
}

export const log = {
  info: (message: string) => write("info", message),
  warn: (message: string) => write("warn", message),
  error: (message: string) => write("error", message),
};

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Routes log calls to the host and logs uncaught errors and rejected
 *  promises instead of leaving them to the webview. Call once at startup. */
export function installLogging(host: Pick<Host, "log">, target: Window = window): void {
  sink = host;
  target.addEventListener("error", (e) => {
    const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : "";
    write("error", `uncaught error: ${e.error ? describe(e.error) : e.message}${where}`);
    e.preventDefault();
  });
  target.addEventListener("unhandledrejection", (e) => {
    write("error", `unhandled rejection: ${describe(e.reason)}`);
    e.preventDefault();
  });
}
