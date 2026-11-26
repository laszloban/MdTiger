// Settings store (FR-APP-02): one JSON file read and written by the shell.
// Defaults live in code. The file's keys are merged over the defaults;
// unknown keys are ignored but kept when saving. Later steps add keys to
// `Settings` and `DEFAULTS` and document them in their implementation notes.

import type { Host } from "../host/host";
import { log } from "./log";

export type ThemeSetting = "system" | "light" | "dark";

export interface Settings {
  theme: ThemeSetting;
  "outline.visible": boolean;
  "outline.width": number;
}

export const DEFAULTS: Readonly<Settings> = {
  theme: "system",
  "outline.visible": true,
  "outline.width": 260,
};

const THEMES: readonly string[] = ["system", "light", "dark"];

/** Whether a value read from the file is acceptable for this key. */
function valid(key: keyof Settings, value: unknown): boolean {
  if (key === "theme") return typeof value === "string" && THEMES.includes(value);
  if (key === "outline.width") return typeof value === "number" && Number.isFinite(value) && value > 0;
  return typeof value === typeof DEFAULTS[key];
}

type Handler<K extends keyof Settings> = (value: Settings[K], key: K) => void;

export const SAVE_DELAY_MS = 300;

export class SettingsStore {
  private values: Settings = { ...DEFAULTS };
  /** Everything from the file, including keys this version doesn't know. */
  private extra: Record<string, unknown> = {};
  private readonly handlers = new Map<keyof Settings, Set<Handler<never>>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly host: Pick<Host, "settingsRead" | "settingsWrite">,
    private readonly delayMs = SAVE_DELAY_MS,
  ) {}

  /** Merges the stored file over the defaults. Never throws. */
  async load(): Promise<void> {
    let stored: Record<string, unknown> | null = null;
    try {
      stored = await this.host.settingsRead();
    } catch (e) {
      log.warn(`settings: could not read the settings file: ${e}`);
    }
    const next: Settings = { ...DEFAULTS };
    this.extra = {};
    for (const [k, v] of Object.entries(stored ?? {})) {
      if (k in DEFAULTS) {
        const key = k as keyof Settings;
        if (valid(key, v)) (next as unknown as Record<string, unknown>)[key] = v;
        else log.warn(`settings: ignoring invalid value for "${k}"`);
      } else {
        this.extra[k] = v;
      }
    }
    this.values = next;
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.values[key];
  }

  /** Sets a value, notifies listeners and schedules a save (debounced). */
  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (!valid(key, value)) {
      log.warn(`settings: refusing invalid value for "${key}"`);
      return;
    }
    if (this.values[key] === value) return;
    this.values[key] = value;
    for (const h of this.handlers.get(key) ?? []) (h as Handler<K>)(value, key);
    this.scheduleSave();
  }

  /** Calls `handler` whenever the key changes. Returns an unsubscribe function. */
  onChange<K extends keyof Settings>(key: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(key);
    if (!set) this.handlers.set(key, (set = new Set()));
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  private scheduleSave(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Saves now (and cancels a pending debounced save). */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const snapshot: Record<string, unknown> = { ...this.extra, ...this.values };
    this.writing = this.writing
      .then(() => this.host.settingsWrite(snapshot))
      .catch((e) => log.error(`settings: save failed: ${e}`));
    return this.writing;
  }
}
