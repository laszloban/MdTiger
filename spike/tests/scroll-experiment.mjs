// S8 detail: per-frame scroll cost of the rendered 2 MB document, under a few
// variations, to find what makes scrolling slow. Usage:
//   node tests/scroll-experiment.mjs tauri|wpf
import { spawn, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const shell = process.argv[2] ?? "tauri";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exe = { tauri: join(root, "tauri/src-tauri/target/release/mdtiger-spike-tauri.exe"), wpf: join(root, "wpf/publish/MdTigerSpikeWpf.exe") }[shell];
const PORT = 9370;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
spawn(exe, [join(root, "samples/big.md")], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: "ignore" });

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
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return r.exceptionDetails ? `ERR ${r.exceptionDetails.exception?.description}` : r.result?.value;
};

await sleep(3000);
await ev(`document.querySelector('[data-mode=rendered]').click(); new Promise(r => setTimeout(r, 3000))`);

const measure = (step) => `(async () => {
  const p = document.getElementById('rendered-pane');
  p.scrollTop = 0; await new Promise(r => setTimeout(r, 500));
  const frames = [];
  let last = performance.now();
  for (let i = 0; i < 40; i++) {
    p.scrollTop += ${step};
    await new Promise(r => requestAnimationFrame(r));
    const now = performance.now(); frames.push(now - last); last = now;
  }
  frames.sort((a, b) => a - b);
  return 'median ' + frames[20].toFixed(1) + ' ms, p90 ' + frames[36].toFixed(1) + ' ms';
})()`;

const variants = [
  ["as built", ""],
  ["no content-visibility", `document.head.insertAdjacentHTML('beforeend', '<style id=x1>.markdown-body > * { content-visibility: visible !important; }</style>')`],
  ["… and outline hidden", `document.getElementById('outline').classList.add('hidden')`],
];
for (const [name, setup] of variants) {
  if (setup) await ev(setup);
  await sleep(500);
  console.log(`${name.padEnd(24)} step 200px: ${await ev(measure(200))} | step 2000px: ${await ev(measure(2000))}`);
}
try { execFileSync("taskkill", ["/F", "/T", "/IM", exe.split(/[\\/]/).pop()], { stdio: "ignore" }); } catch {}
process.exit(0);
