// End-to-end helpers: launch the real release exe and drive its page through
// the WebView2 debugging port (Chrome DevTools Protocol).
//
// Every launch gets its own profile folder under tests/e2e/.tmp/<run>/ via
// MDTIGER_PROFILE_DIR, so tests never touch the user's real settings or logs.
// MdTiger is a single-instance app: don't run these tests while another
// MdTiger is open (the second launch would be handed over to it).

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const EXE = join(ROOT, "src-tauri", "target", "release", "mdtiger.exe");
export const EXE_NAME = "mdtiger.exe";
const FIXTURES = join(ROOT, "tests", "fixtures");
const TMP = join(ROOT, "tests", "e2e", ".tmp");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One run folder per test process, created lazily.
let runDir = null;
let launches = 0;
const running = new Set();

export function getRunDir() {
  if (!runDir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    runDir = join(TMP, `${stamp}-${process.pid}`);
    mkdirSync(runDir, { recursive: true });
  }
  return runDir;
}

/** Copies a file from tests/fixtures into this run's temp folder; returns its path. */
export function fixture(name) {
  const src = join(FIXTURES, name);
  const dst = join(getRunDir(), "files", name);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  return dst;
}

/** Path of a profile folder that doesn't exist yet. */
export function newProfileDir() {
  return join(getRunDir(), `profile-${++launches}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function mdtigerRunning() {
  const out = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${EXE_NAME}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
  return out.toLowerCase().includes(EXE_NAME);
}

function killTree(pid) {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* already gone */
  }
}

// ------------------------------------------------------------------ CDP

async function connectCdp(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page" && /tauri\.localhost|index\.html/.test(t.url));
      if (page) return await openWs(page.webSocketDebuggerUrl);
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error(`no debuggable page found on port ${port}`);
}

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    ws.onclose = () => {
      for (const cb of pending.values()) cb({ error: { message: "connection closed" } });
      pending.clear();
    };
    const send = (method, params = {}, timeoutMs = 15000) =>
      new Promise((res, rej) => {
        const i = ++id;
        const timer = setTimeout(() => {
          pending.delete(i);
          rej(new Error(`CDP ${method} timed out`));
        }, timeoutMs);
        pending.set(i, (msg) => {
          clearTimeout(timer);
          if (msg.error) rej(new Error(msg.error.message));
          else res(msg.result);
        });
        try {
          ws.send(JSON.stringify({ id: i, method, params }));
        } catch (e) {
          clearTimeout(timer);
          pending.delete(i);
          rej(e);
        }
      });
    ws.onopen = () => resolve({ ws, send });
    ws.onerror = () => reject(new Error("websocket error"));
  });
}

// ------------------------------------------------------------------ keys

const NAMED_KEYS = {
  Enter: { code: "Enter", vk: 13 },
  Escape: { code: "Escape", vk: 27 },
  Tab: { code: "Tab", vk: 9 },
  Backspace: { code: "Backspace", vk: 8 },
  Delete: { code: "Delete", vk: 46 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  ArrowUp: { code: "ArrowUp", vk: 38 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
  ArrowDown: { code: "ArrowDown", vk: 40 },
  PageUp: { code: "PageUp", vk: 33 },
  PageDown: { code: "PageDown", vk: 34 },
  Home: { code: "Home", vk: 36 },
  End: { code: "End", vk: 35 },
  Space: { code: "Space", vk: 32, key: " " },
};
const PUNCT = {
  "-": { code: "Minus", vk: 189 },
  "=": { code: "Equal", vk: 187 },
  ",": { code: "Comma", vk: 188 },
  ".": { code: "Period", vk: 190 },
  "/": { code: "Slash", vk: 191 },
  ";": { code: "Semicolon", vk: 186 },
  "'": { code: "Quote", vk: 222 },
};

/** "Ctrl+Shift+P", "F1", "Ctrl+1" → Input.dispatchKeyEvent parameters.
 *  Digits and punctuation carry an explicit physical `code`. */
export function parseKeyCombo(combo) {
  const parts = combo.split("+");
  const main = parts.pop() || "+";
  let modifiers = 0;
  for (const m of parts) {
    const bit = { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 }[m];
    if (!bit) throw new Error(`unknown modifier ${m} in ${combo}`);
    modifiers |= bit;
  }
  const shift = (modifiers & 8) !== 0;
  if (/^[a-zA-Z]$/.test(main)) {
    const up = main.toUpperCase();
    return { modifiers, key: shift ? up : up.toLowerCase(), code: `Key${up}`, windowsVirtualKeyCode: up.charCodeAt(0) };
  }
  if (/^[0-9]$/.test(main)) return { modifiers, key: main, code: `Digit${main}`, windowsVirtualKeyCode: 48 + Number(main) };
  if (/^F([1-9]|1[0-2])$/.test(main)) return { modifiers, key: main, code: main, windowsVirtualKeyCode: 111 + Number(main.slice(1)) };
  if (NAMED_KEYS[main]) {
    const n = NAMED_KEYS[main];
    return { modifiers, key: n.key ?? main, code: n.code, windowsVirtualKeyCode: n.vk };
  }
  if (PUNCT[main]) return { modifiers, key: main, code: PUNCT[main].code, windowsVirtualKeyCode: PUNCT[main].vk };
  throw new Error(`unsupported key ${main} in ${combo}`);
}

// ------------------------------------------------------------------ clipboard

/** Clipboard formats and plain text, read through Windows PowerShell. */
export function clipboard() {
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-Command", "Add-Type -A System.Windows.Forms; [Windows.Forms.Clipboard]::GetDataObject().GetFormats() -join ','; '@@MDTIGER-SEP@@'; [Windows.Forms.Clipboard]::GetText()"],
    { encoding: "utf8" },
  );
  // The separator must not occur in copied text.
  const [formats, text = ""] = out.split("@@MDTIGER-SEP@@");
  return { formats: formats.trim().split(","), text: text.replace(/\r\n/g, "\n").replace(/^\n/, "").replace(/\n$/, "") };
}

// ------------------------------------------------------------------ app

/**
 * Starts MdTiger and connects to its page.
 *
 * @param {object}   [opts]
 * @param {string[]} [opts.files]       paths passed on the command line
 * @param {object}   [opts.env]         extra environment variables
 * @param {string}   [opts.profile]     reuse this profile folder (default: a fresh one)
 * @param {boolean}  [opts.waitForPage] wait for the page (default true)
 */
export async function launchApp({ files = [], env = {}, profile, waitForPage = true } = {}) {
  if (!existsSync(EXE)) throw new Error(`${EXE} not found: build first with: npx tauri build --no-bundle (a plain cargo build --release makes an exe that loads the dev server URL)`);
  if (running.size === 0 && mdtigerRunning()) {
    throw new Error("another MdTiger is running; close it first (single-instance: the test launch would be handed over to it)");
  }
  const profileDir = profile ?? newProfileDir();
  mkdirSync(profileDir, { recursive: true });
  const port = await freePort();
  const fullEnv = {
    ...process.env,
    MDTIGER_PROFILE_DIR: profileDir,
    MDTIGER_TEST: "1",
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    ...env,
  };
  const child = spawn(EXE, files, { env: fullEnv, stdio: "ignore", windowsHide: false });
  running.add(child);
  child.on("exit", () => running.delete(child));
  let cdp = null;
  let primed = false;

  const app = {
    profile: profileDir,
    port,
    child,
    pid: child.pid,
    env: fullEnv,

    get alive() {
      return child.exitCode === null && child.signalCode === null;
    },

    async connect(timeoutMs) {
      try {
        cdp?.ws.close();
      } catch {
        /* ignore */
      }
      cdp = await connectCdp(port, timeoutMs);
      return app;
    },

    /** Evaluates an expression in the page (promises are awaited). */
    async eval(expression) {
      const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },

    /** Polls until the expression is truthy; returns its value. */
    async waitFor(expression, timeoutMs = 10000) {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        try {
          last = await app.eval(expression);
          if (last) return last;
        } catch (e) {
          last = e.message;
        }
        await sleep(100);
      }
      throw new Error(`timed out after ${timeoutMs} ms waiting for: ${expression} (last: ${JSON.stringify(last)})`);
    },

    /** A real key press, e.g. "Ctrl+O". */
    async key(combo) {
      const k = parseKeyCombo(combo);
      await cdp.send("Page.bringToFront").catch(() => {});
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...k, commands: [] });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
    },

    /** The first mouse press into a window that has no focus only focuses it
     *  (the page never sees it). Prime the window with a harmless press in the
     *  top-left corner of the toolbar. */
    async focusWindow() {
      if (primed) return; // document.hasFocus() is not reliable here: prime once per launch
      primed = true;
      await cdp.send("Page.bringToFront").catch(() => {});
      const base = { x: 2, y: 2, button: "left", clickCount: 1 };
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
      await sleep(100);
    },

    async click(selector) {
      await app.focusWindow();
      const box = await app.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (!box) throw new Error(`no element matches ${selector}`);
      const base = { x: box.x, y: box.y, button: "left", clickCount: 1 };
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
    },

    /** Drags with the mouse from the center of one element to a point relative to another. */
    async drag(fromSelector, toSelector, { toEdge = "right" } = {}) {
      const rect = (sel) => app.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; })()`);
      await app.focusWindow();
      const f = await rect(fromSelector);
      const t = await rect(toSelector);
      if (!f || !t) throw new Error(`drag: missing ${fromSelector} or ${toSelector}`);
      const x0 = (f.l + f.r) / 2;
      const y = (f.t + f.b) / 2;
      const x1 = toEdge === "right" ? t.r - 4 : t.l + 4;
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0, y });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y, button: "left", clickCount: 1 });
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + ((x1 - x0) * i) / steps, y, button: "left", buttons: 1 });
      }
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y, button: "left", clickCount: 1 });
    },

    /** Raw DevTools Protocol call (for tests that freeze or inspect the page). */
    cdp: (method, params) => cdp.send(method, params),

    /** Types text as key presses into the focused element. */
    async type(text) {
      for (const ch of text) {
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      }
    },

    clipboard,

    /** The profile's log file as text ("" if there is none yet). */
    log() {
      const p = join(app.profile, "logs", "mdtiger.log");
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    },

    async waitForLog(pattern, timeoutMs = 10000) {
      const re = pattern instanceof RegExp ? pattern : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const m = app.log().match(re);
        if (m) return m;
        await sleep(100);
      }
      throw new Error(`timed out after ${timeoutMs} ms waiting for log ${re}; log was:\n${app.log()}`);
    },

    /** Starts another instance with the same profile (single-instance handover). */
    launchSecond(files = []) {
      const second = spawn(EXE, files, { env: fullEnv, stdio: "ignore" });
      running.add(second);
      second.on("exit", () => running.delete(second));
      const exited = new Promise((resolve) => second.on("exit", (code) => resolve(code)));
      return { child: second, exited };
    },

    /** PIDs of this app's WebView2 renderer processes. */
    rendererPids() {
      const dir = app.profile.replace(/'/g, "''");
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -match '--type=renderer' -and $_.CommandLine.ToLower().Contains('${dir.toLowerCase()}') } | ForEach-Object { $_.ProcessId }`],
        { encoding: "utf8" },
      );
      return out.split(/\s+/).filter(Boolean).map(Number);
    },

    /** Kills the app's whole process tree and waits for it to end. */
    async close() {
      try {
        cdp?.ws.close();
      } catch {
        /* ignore */
      }
      if (app.alive) {
        const exited = new Promise((r) => child.once("exit", r));
        killTree(child.pid);
        await Promise.race([exited, sleep(5000)]);
      }
      running.delete(child);
      // Give Windows a moment to release the single-instance mutex and the profile folder.
      await sleep(300);
    },
  };

  if (waitForPage) await app.connect();
  return app;
}

/** Last-modified time of a path, or null if it doesn't exist. */
export function mtimeOrNull(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** Names in a folder, or null if it doesn't exist. */
export function listOrNull(path) {
  try {
    return readdirSync(path).sort();
  } catch {
    return null;
  }
}
