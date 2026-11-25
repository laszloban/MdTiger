// S9 detail: kill the WebView2 renderer of a running shell and watch, once a
// second, whether and when the page comes back.
// Usage: node tests/renderer-kill.mjs tauri|wpf [seconds]
import { spawn, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const shell = process.argv[2] ?? "tauri";
const seconds = +(process.argv[3] ?? 60);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exe = { tauri: join(root, "tauri/src-tauri/target/release/mdtiger-spike-tauri.exe"), wpf: join(root, "wpf/publish/MdTigerSpikeWpf.exe") }[shell];
const exeName = exe.split(/[\\/]/).pop();
const PORT = 9350;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = spawn(exe, [join(root, "samples/showcase.md")], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: "ignore",
});

async function probe() {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const page = list.find((t) => t.type === "page");
    if (!page) return "no page";
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    return await new Promise((resolve) => {
      const timer = setTimeout(() => (ws.close(), resolve("page not responding")), 800);
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "document.querySelectorAll('.markdown-body h2').length", returnByValue: true } }));
      ws.onmessage = (m) => {
        clearTimeout(timer);
        const r = JSON.parse(m.data);
        ws.close();
        resolve(r.error ? `error: ${r.error.message}` : `alive (${r.result.result.value} h2)`);
      };
      ws.onerror = () => (clearTimeout(timer), resolve("ws error"));
    });
  } catch {
    return "debug port down";
  }
}

await sleep(3000);
console.log("before kill:", await probe());
const pids = execFileSync("powershell.exe", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -match '--type=renderer' -and $_.CommandLine -match 'webview-exe-name=${exeName}' } | ForEach-Object { $_.ProcessId }`], { encoding: "utf8" }).split(/\s+/).filter(Boolean);
for (const pid of pids) process.kill(+pid);
console.log(`killed renderer(s): ${pids.join(", ")}`);
let last = "";
for (let s = 1; s <= seconds; s++) {
  await sleep(1000);
  const st = await probe();
  if (st !== last) console.log(`t+${s}s: ${st}`);
  last = st;
  if (st.startsWith("alive")) break;
}
app.kill();
try {
  execFileSync("taskkill", ["/F", "/T", "/IM", exeName], { stdio: "ignore" });
} catch {}
