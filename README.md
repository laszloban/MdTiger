# MdTiger

A fast Markdown viewer and editor for Windows, built with [Tauri 2](https://tauri.app)
and a small TypeScript front end (CodeMirror 6). It starts quickly, renders
Markdown with selectable and copyable code blocks, an outline sidebar and
Mermaid diagrams, and works fully offline.

> **Status:** early development. Step S01 (project foundation) is in place;
> opening and editing files arrive in the following steps. See
> [Planning/IMPLEMENTATION_PLAN.md](Planning/IMPLEMENTATION_PLAN.md).

## Build and run

Requirements: Windows 10/11 x64 with WebView2 (preinstalled on Windows 11),
[Node.js](https://nodejs.org) LTS and the [Rust](https://rustup.rs) stable toolchain.

```powershell
npm install

npm run tauri dev          # run the app with hot reload
npm run dev                # front end only, in a normal browser (http://localhost:5178)

npm run build              # typecheck + production front end (dist/)
npx tauri build --no-bundle   # release exe: src-tauri/target/release/mdtiger.exe
```

## Tests

```powershell
npm run typecheck          # TypeScript
npm test                   # unit tests (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # shell unit tests
npm run e2e                # end-to-end tests against the release exe
npm run check              # everything above plus the release build
npm run check:ci           # as check, without the end-to-end tests (what CI runs)
```

The end-to-end tests start the real exe with a throw-away profile folder
(`MDTIGER_PROFILE_DIR`), so they never touch your settings or logs. MdTiger is a
single-instance app: close any running MdTiger before running them.

`tools/measure-startup.ps1` measures startup time.

## Data locations

| What | Where |
|---|---|
| Settings | `%APPDATA%\MdTiger\settings.json` |
| Log | `%LOCALAPPDATA%\MdTiger\logs\mdtiger.log` |
| WebView data | `%LOCALAPPDATA%\MdTiger\webview\` |

Setting the environment variable `MDTIGER_PROFILE_DIR` moves all three under
one folder.

## Documentation

Requirements, technology decision and the step-by-step implementation plan are
in [Planning/](Planning/). The `spike/` folder holds the frozen technology
spike (reference only).

## Licence

[MIT](LICENSE)
