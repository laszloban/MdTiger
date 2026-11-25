// Profiles typing in the source editor of a big document inside a real shell,
// and prints the functions with the most self time. Usage:
//   node tests/profile-typing.mjs tauri [file]
import { spawn, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const shell = process.argv[2] ?? "tauri";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[3] ?? join(root, "samples/big.md");
const exe = { tauri: join(root, "tauri/src-tauri/target/release/mdtiger-spike-tauri.exe"), wpf: join(root, "wpf/publish/MdTigerSpikeWpf.exe") }[shell];
const PORT = 9360;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
spawn(exe, [file], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: "ignore" });

let page;
for (let i = 0; i < 100 && !page; i++) {
  await sleep(200);
  try {
    page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page");
  } catch {}
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (pending.has(msg.id)) pending.get(msg.id)(msg), pending.delete(msg.id);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, (msg) => r(msg.result)); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;

await sleep(4000);
await ev(`document.querySelector('[data-mode=source]').click(); new Promise(r => setTimeout(r, 800))`);
await ev(`document.querySelector('.cm-content').focus()`);
await ev(`(() => { window.__lat = []; new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'keydown') window.__lat.push(Math.round(e.duration)); }).observe({ type: 'event', durationThreshold: 0, buffered: false }); })()`);
await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 200 });
await send("Profiler.start");
const t0 = Date.now();
for (let i = 0; i < 30; i++) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", text: "a", key: "a" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a" });
  await sleep(40);
}
await sleep(1500);
const { profile } = await send("Profiler.stop");
console.log(`typed 30 keys in ${Date.now() - t0} ms (incl. 1.5 s tail)`);
const lat = (await ev(`window.__lat`)) ?? [];
const s = [...lat].sort((a, b) => a - b);
console.log(`keydown→paint latency (ms), in order: ${lat.join(" ")}`);
console.log(`median ${s[Math.floor(s.length / 2)]} ms, p90 ${s[Math.floor(s.length * 0.9)]} ms, max ${s[s.length - 1]} ms`);

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
profile.samples.forEach((sid, i) => {
  const n = byId.get(sid);
  const key = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
});
[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, ms]) => console.log(`${ms.toFixed(0).padStart(6)} ms  ${k}`));
try { execFileSync("taskkill", ["/F", "/T", "/IM", exe.split(/[\\/]/).pop()], { stdio: "ignore" }); } catch {}
process.exit(0);
