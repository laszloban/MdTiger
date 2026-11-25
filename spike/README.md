# MdTiger spike

Throwaway code to answer the technology question in
[TECHNOLOGY_OPTIONS.md](../Planning/TECHNOLOGY_OPTIONS.md). Results are in
[RESULTS.md](RESULTS.md).

| Folder | What |
|---|---|
| `frontend/` | The shared TypeScript front end: CodeMirror 6 editor, a Lezer-based renderer, outline, tabs, Mermaid. It talks to its shell only through `src/host/host.ts`. |
| `tauri/` | Shell A: Tauri 2 (Rust). |
| `wpf/` | Shell B: WPF + WebView2 (.NET 10). |
| `samples/` | Test documents. `node samples/make-big.mjs` generates the 2 MB `big.md`. |
| `tests/` | Automated checks that drive a real shell through the WebView2 debugging port. |

## Build

Requirements: Node.js 22+, Rust (MSVC toolchain), .NET 10 SDK, WebView2 runtime.

```powershell
cd frontend; npm install; npm run build; cd ..
cd tauri; npm install; npx tauri build --no-bundle; cd ..
cd wpf; dotnet publish -c Release -o publish; cd ..
```

Rebuild both shells after changing the front end: Tauri embeds `frontend/dist`
at compile time, and the WPF publish copies it.

## Run

```powershell
.\tauri\src-tauri\target\release\mdtiger-spike-tauri.exe .\samples\showcase.md
```

```powershell
.\wpf\publish\MdTigerSpikeWpf.exe .\samples\showcase.md
```

For front-end work without a shell, run `npm run dev` in `frontend/` and open
`http://localhost:5178/?file=showcase.md`. That uses the browser host, where
saving only keeps the text in memory.

## Checks

```powershell
.\measure-startup.ps1 -Shell tauri -Runs 10
```

```powershell
node samples/make-big.mjs; node tests/shell-checks.mjs tauri
```

The other tools in `tests/`: `renderer-kill.mjs` (S9 detail),
`profile-typing.mjs` and `scroll-experiment.mjs` (S8 detail).

Logs: `%LOCALAPPDATA%\MdTiger\spike-tauri.log` and `spike-wpf.log`.
