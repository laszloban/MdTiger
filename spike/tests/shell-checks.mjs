// Automated spike checks S2–S9 against a real shell (Tauri or WPF).
// Both shells use WebView2, so the page is driven through the Chrome DevTools
// Protocol (remote debugging port). Usage:
//   node tests/shell-checks.mjs tauri
//   node tests/shell-checks.mjs wpf
// What can't be automated is listed at the end of the output as MANUAL.

import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const shell = process.argv[2] ?? "tauri";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exe = {
  tauri: join(root, "tauri/src-tauri/target/release/mdtiger-spike-tauri.exe"),
  wpf: join(root, "wpf/publish/MdTigerSpikeWpf.exe"),
}[shell];
const PORT = shell === "tauri" ? 9341 : 9342;
const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` };

const work = join(tmpdir(), `mdtiger-spike-${shell}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "images"), { recursive: true });
const samples = join(root, "samples");
for (const f of ["showcase.md", "tables.md", "images/tiger.svg"]) copyFileSync(join(samples, f), join(work, f));
// A CRLF + BOM variant for the byte-fidelity check.
const crlf = "﻿" + readFileSync(join(samples, "showcase.md"), "utf8").replace(/\r?\n/g, "\r\n");
writeFileSync(join(work, "crlf-bom.md"), crlf, "utf8");

const results = [];
const check = (id, name, ok, detail = "") => {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

// ------------------------------------------------------------------ CDP

async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && /index\.html|tauri\.localhost/.test(t.url));
      if (page) return openWs(page.webSocketDebuggerUrl);
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error("no debuggable page found");
}

function openWs(url) {
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
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return new Promise((resolve) => (ws.onopen = () => resolve({ ws, send, evaluate })));
}

function clipboardFormats() {
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-Command", "Add-Type -A System.Windows.Forms; [Windows.Forms.Clipboard]::GetDataObject().GetFormats() -join ','; '@@MDTIGER-SEP@@'; [Windows.Forms.Clipboard]::GetText()"],
    { encoding: "utf8" },
  );
  // The separator must not occur in copied code (PowerShell samples contain '|').
  const [formats, text] = out.split("@@MDTIGER-SEP@@");
  return { formats: formats.trim().split(","), text: text.replace(/\r\n/g, "\n").replace(/^\n/, "").replace(/\n$/, "") };
}

const launch = (...files) => spawn(exe, files, { env, detached: false, stdio: "ignore" });

// Page helpers (run inside the app)
const key = (k) => `document.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', ctrlKey: true, bubbles: true }))`;
const wait = (ms) => `new Promise(r => setTimeout(r, ${ms}))`;

// ------------------------------------------------------------------ run

const showcase = join(work, "showcase.md");
const app = launch(showcase);
let cdp = await connect();
await cdp.evaluate(`${wait(1500)}`);
await cdp.evaluate(`document.querySelector('[data-mode=rendered]').click(), ${wait(800)}`);

// S5: unchanged save is byte-identical; a checkbox click changes one byte.
for (const file of ["showcase.md", "crlf-bom.md"]) {
  const p = join(work, file);
  if (file !== "showcase.md") {
    await cdp.evaluate(`void 0`);
    spawn(exe, [p], { env, stdio: "ignore" }); // second launch → opens a tab in the first instance
    await sleep(1500);
  }
  const before = readFileSync(p);
  const hashBefore = sha(p);
  await cdp.evaluate(`${key("s")}, ${wait(600)}`);
  check("S5", `${file}: save without edits keeps the file byte-identical`, sha(p) === hashBefore);
  await cdp.evaluate(`document.querySelector('.task-box').click(), ${wait(200)}, ${key("s")}, ${wait(600)}`);
  const after = readFileSync(p);
  let diff = 0;
  for (let i = 0; i < Math.max(before.length, after.length); i++) if (before[i] !== after[i]) diff++;
  check("S5", `${file}: ticking a checkbox changes exactly one byte`, diff === 1 && before.length === after.length, `${diff} byte(s) differ`);
  await cdp.evaluate(`document.querySelector('.task-box').click(), ${wait(200)}, ${key("s")}, ${wait(600)}`);
  check("S5", `${file}: unticking restores the original bytes`, sha(p) === hashBefore);
}
const tabCount = await cdp.evaluate(`document.querySelectorAll('.tab').length`);
check("S7", "second launch opened its file as a tab in the first window", tabCount === 2, `${tabCount} tabs`);

// Back to showcase.md
await cdp.evaluate(`[...document.querySelectorAll('.tab')][0].dispatchEvent(new MouseEvent('mousedown', {bubbles:true})), ${wait(800)}`);

// A real Ctrl+C key press, as a user would do it.
async function pressCtrlC() {
  // Reset first, so a stale clipboard can't make a failed copy look like a pass.
  execFileSync("powershell.exe", ["-NoProfile", "-STA", "-Command", "Set-Clipboard -Value 'mdtiger-reset'"]);
  await cdp.send("Page.bringToFront").catch(() => {});
  const base = { modifiers: 2, key: "c", code: "KeyC", windowsVirtualKeyCode: 67 };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, commands: ["copy"] });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(300);
}

// S2: selection inside a code block copies as plain text only.
await cdp.evaluate(`(() => {
  const code = document.querySelector('.code-block pre code');
  const r = document.createRange(); r.selectNodeContents(code);
  getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
await pressCtrlC();
let cb = clipboardFormats();
check("S2", "selection inside a code block → plain text only (no HTML/RTF on the clipboard)", !cb.formats.some((f) => /HTML|Rich Text/i.test(f)), cb.formats.join(", "));
check("S2", "copied code keeps its line breaks and indentation", cb.text.includes("\n    Where-Object Length -gt 10MB |"), JSON.stringify(cb.text.slice(0, 90)));

await cdp.evaluate(`(() => {
  const p = [...document.querySelectorAll('p')].find(p => p.textContent.startsWith('Select from'));
  const code = document.querySelector('.code-block pre code');
  const tw = document.createTreeWalker(code, NodeFilter.SHOW_TEXT); tw.nextNode(); tw.nextNode(); tw.nextNode();
  const r = document.createRange(); r.setStart(p.firstChild, 0); r.setEnd(tw.currentNode, tw.currentNode.textContent.length);
  getSelection().removeAllRanges(); getSelection().addRange(r);
  return getSelection().toString().length; })()`);
await pressCtrlC();
cb = clipboardFormats();
check("S2", "selection can run from a paragraph into a code block", cb.text.startsWith("Select from") && cb.text.includes("Get-ChildItem"), `${cb.text.length} chars`);

await cdp.evaluate(`document.querySelectorAll('.code-block')[1].querySelector('.copy-btn').click(), ${wait(400)}`);
cb = clipboardFormats();
const btnText = await cdp.evaluate(`document.querySelectorAll('.code-block')[1].querySelector('.copy-btn').textContent`);
check("S2", "copy button copies the raw code (no fences), plain text only", cb.text.startsWith("public sealed record Heading") && !cb.text.includes("```") && !cb.formats.some((f) => /HTML/i.test(f)), cb.formats.join(", "));
check("S2", "copy button shows confirmation", btnText === "Copied", btnText);
const hoverCss = await cdp.evaluate(`getComputedStyle(document.querySelector('.copy-btn')).opacity`);
check("S2", "copy button hidden until hover", hoverCss === "0", `opacity ${hoverCss}`);

// S3: outline.
const ol = await cdp.evaluate(`[...document.querySelectorAll('.ol-label')].map(l => l.textContent)`);
check("S3", "outline shows headings exactly as written (no added numbering)", ol[0] === "MdTiger spike showcase" && ol.includes("1. Code blocks (S2)") && ol.includes("Level five"), ol.slice(0, 3).join(" | "));
const collapsed = await cdp.evaluate(`document.querySelector('[data-ol=collapse]').click(), document.querySelectorAll('.ol-row').length`);
const expanded = await cdp.evaluate(`document.querySelector('[data-ol=expand]').click(), document.querySelectorAll('.ol-row').length`);
check("S3", "collapse all / expand all", collapsed === 1 && expanded === ol.length, `${collapsed} → ${expanded} rows`);
const jumped = await cdp.evaluate(`(async () => {
  [...document.querySelectorAll('.ol-row')].find(r => r.textContent.includes('5. Links')).click();
  await ${wait(400)};
  const h = [...document.querySelectorAll('h2')].find(h => h.textContent.startsWith('5.'));
  const top = h.getBoundingClientRect().top - document.getElementById('rendered-pane').getBoundingClientRect().top;
  return { top: Math.round(top), current: document.querySelector('.ol-row.current')?.textContent };
})()`);
check("S3", "click jumps to the heading and highlights it", Math.abs(jumped.top) < 30 && jumped.current?.includes("5. Links"), JSON.stringify(jumped));

// S4: Mermaid.
await cdp.evaluate(wait(1500));
const mm = await cdp.evaluate(`[...document.querySelectorAll('.mermaid-block')].map(b => b.dataset.state)`);
check("S4", "Mermaid diagrams render; the broken one shows an error, rest still renders", JSON.stringify(mm) === '["done","done","error"]', mm.join(","));
const imgs = await cdp.evaluate(`[...document.querySelectorAll('.markdown-body img')].map(i => (i.scrollIntoView(), i.getAttribute('src').slice(0, 40)))`);
await cdp.evaluate(wait(1500));
const loaded = await cdp.evaluate(`[...document.querySelectorAll('.markdown-body img')].map(i => i.naturalWidth > 0)`);
check("LINK", "local image (relative path) loads through the shell", loaded[0] === true, imgs[0]);
check("LINK", "remote image loads (network available)", loaded[1] === true, imgs[1]);

// S7: external change, no unsaved edits → silent reload.
appendFileSync(showcase, "\nAppended from outside MdTiger.\n");
await sleep(2000);
const reloaded = await cdp.evaluate(`document.getElementById('rendered').textContent.includes('Appended from outside MdTiger.')`);
check("S7", "file changed on disk (no local edits) → reloaded automatically", reloaded);

// External change while there are unsaved edits → banner, no dialog.
await cdp.evaluate(`document.querySelector('.task-box').click(), ${wait(300)}`);
appendFileSync(showcase, "\nSecond outside change.\n");
await sleep(2000);
const banner = await cdp.evaluate(`document.getElementById('banner').hidden ? '' : document.getElementById('banner').textContent`);
check("S7", "file changed on disk with unsaved edits → non-blocking banner", /changed on disk/.test(banner), banner.slice(0, 60));
await cdp.evaluate(`[...document.querySelectorAll('#banner button')].find(b => b.textContent === 'Keep mine')?.click()`);

const defaultApp = await cdp.evaluate(`(async () => { await ${wait(100)}; return document.getElementById('banner').textContent; })()`);
void defaultApp;

// S9: kill the WebView2 renderer while there are unsaved edits.
await cdp.evaluate(wait(800)); // let the draft be written
const dirtyBefore = await cdp.evaluate(`document.querySelector('.tab.active .tab-dirty').textContent`);
const renderers = execFileSync(
  "powershell.exe",
  ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -match '--type=renderer' -and $_.CommandLine -match 'webview-exe-name=${exe.split(/[\\/]/).pop()}' } | ForEach-Object { $_.ProcessId }`],
  { encoding: "utf8" },
)
  .split(/\s+/)
  .filter(Boolean);
for (const pid of renderers) {
  try {
    process.kill(+pid);
  } catch {
    /* already gone */
  }
}
await sleep(3000);
let recovered = false;
let restoredBanner = "";
let tabsAfter = "";
try {
  cdp.ws.close();
  cdp = await connect();
  await cdp.evaluate(wait(1500));
  restoredBanner = await cdp.evaluate(`document.getElementById('banner').textContent`);
  recovered = await cdp.evaluate(`document.querySelectorAll('.markdown-body h1').length > 0`);
  tabsAfter = await cdp.evaluate(`[...document.querySelectorAll('.tab-name')].map(n => n.textContent).join(', ')`);
} catch (e) {
  restoredBanner = String(e.message);
}
check("S9", "all open tabs come back after the renderer restart", tabsAfter === "showcase.md, crlf-bom.md", tabsAfter);
check("S9", `renderer killed (${renderers.length} process(es)) → page comes back by itself`, recovered, `dirty before: '${dirtyBefore}'`);
check("S9", "unsaved edits restored after the renderer restart", /Restored unsaved edits/.test(restoredBanner), restoredBanner.slice(0, 60));

const alive = app.exitCode === null;
check("NFR-11", "app still running, no crash", alive);

// S8: big document.
const big = join(samples, "big.md");
if (existsSync(big)) {
  copyFileSync(big, join(work, "big.md"));
  const t0 = Date.now();
  spawn(exe, [join(work, "big.md")], { env, stdio: "ignore" });
  await cdp.evaluate(`new Promise(r => { const t = setInterval(() => { if ([...document.querySelectorAll('.tab-name')].some(n => n.textContent === 'big.md') && document.querySelectorAll('.markdown-body h1').length > 50) { clearInterval(t); r(); } }, 50); })`);
  const openMs = Date.now() - t0;
  check("S8", "2 MB document opens and renders", true, `${openMs} ms until rendered (includes second-launch handover)`);
  // Typing latency in source mode, measured with the Event Timing API.
  await cdp.evaluate(`document.querySelector('[data-mode=source]').click(), ${wait(500)}`);
  await cdp.evaluate(`(() => { window.__lat = []; new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'keydown') window.__lat.push(e.duration); }).observe({ type: 'event', durationThreshold: 0, buffered: false }); document.querySelector('.cm-content').focus(); })()`);
  // One warm-up key: the editor's first layout of a 2 MB document after a mode switch is a one-off.
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", text: "a", key: "a" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a" });
  await sleep(500);
  await cdp.evaluate(`window.__lat = []`);
  for (let i = 0; i < 30; i++) {
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", text: "a", key: "a" });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a" });
    await sleep(40);
  }
  await sleep(500);
  const lat = await cdp.evaluate(`window.__lat`);
  const sorted = [...lat].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  check("S8", "typing latency in a 2 MB document below 50 ms (p90)", sorted.length > 0 && p(0.9) < 50, `${sorted.length} keys: median ${p(0.5)} ms, p90 ${p(0.9)} ms, max ${sorted[sorted.length - 1]} ms`);
  // Wheel-like scrolling (200 px per frame) through content not seen before.
  const scroll = await cdp.evaluate(`(async () => { document.querySelector('[data-mode=rendered]').click(); await ${wait(1500)}; const p = document.getElementById('rendered-pane'); const f = []; let last = performance.now(); for (let i = 0; i < 60; i++) { p.scrollTop += 200; await new Promise(r => requestAnimationFrame(r)); const now = performance.now(); f.push(now - last); last = now; } f.sort((a, b) => a - b); return { median: f[30], p90: f[54] }; })()`);
  check("S8", "scrolling the rendered 2 MB document stays smooth (median frame < 25 ms)", scroll.median < 25, `median ${scroll.median.toFixed(1)} ms, p90 ${scroll.p90.toFixed(1)} ms per frame`);
} else {
  console.log("SKIP  S8  samples/big.md missing (run: node samples/make-big.mjs)");
}

app.kill();
try {
  execFileSync("taskkill", ["/F", "/T", "/IM", exe.split(/[\\/]/).pop()], { stdio: "ignore" });
} catch {
  /* already closed */
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${shell}: ${results.length - failed.length}/${results.length} automated checks passed`);
console.log(`MANUAL: paste into Word/Outlook (S2), hibernate + resume (S9), 'Make default…' opens Windows Default apps (S7), cold start after reboot (S1)`);
process.exit(failed.length ? 1 : 0);
