# S12 – Packaging and release

| | |
|---|---|
| **Depends on** | S11 |
| **Requirements** | FR-FILE-01 (double-click / file association), FR-APP-05 (registration), FR-APP-06 (installer and file icons), NFR-01 (cold start), NFR-04, NFR-05 |
| **Spike reference** | none |

## 1. Goal

An installable MdTiger 1.0: a per-user installer without admin rights that
registers `.md` and `.markdown` with the tiger icon, a portable build, a
clean uninstall, and a full regression run, so the user can replace Zettlr.

## 2. Scope

**In:** Tauri bundling (NSIS), file associations, WebView2 bootstrap
strategy, portable zip, version metadata, release build script, user
documentation, final regression and manual acceptance.

**Also in:** a GitHub Actions release workflow and a winget manifest
(OI-04, OI-05). **Out:** code signing: releases ship unsigned (OI-03). Keep the release
workflow so that a SignPath signing step can be added later without other
changes, and mention the SmartScreen *More info → Run anyway* step in the
README's install section.

## 3. Design and tasks

### 3.1 Installer (`src-tauri/tauri.conf.json` bundle section)

- **NSIS**, `installMode: "currentUser"` (no admin, NFR-04), installs to
  `%LOCALAPPDATA%\Programs\MdTiger`, Start menu shortcut, optional desktop
  shortcut (unchecked by default).
- **File associations** for `.md` and `.markdown`: ProgId from the shared
  constant defined in S09 (e.g. `MdTiger.md`), description
  "Markdown document", the tiger icon as the document icon, open command
  `"…\mdtiger.exe" "%1"`. Registering doesn't make MdTiger the default
  (Windows doesn't allow that silently); S09's banner handles that.
- WebView2: `webviewInstallMode` = `downloadBootstrapper` (Windows 11 and
  current Windows 10 have it); document the offline alternative.
- Uninstall removes the program files, shortcuts and file-association
  entries; it **keeps** settings, styles and logs (ask in the uninstaller:
  "Also remove settings?", default no).
- Upgrade over an existing install keeps settings; the running app is
  asked to close (single instance) or the installer waits.

### 3.2 Portable build

A zip with `mdtiger.exe` and a `README.txt`. When a file named
`portable.flag` sits next to the exe, settings, styles and logs live in a
`data\` folder next to it instead of `%APPDATA%` / `%LOCALAPPDATA%`
(reuse the profile-dir mechanism from S01).

### 3.3 Version and metadata

- One version source: `package.json` → `tauri.conf.json` →
  `Cargo.toml` (a small `tools/set-version.mjs` keeps them in sync).
  Release 1.0.0.
- Exe file properties: product name, version, company field empty or
  "MdTiger contributors", copyright, icon.
- About box (S09) shows the same version.

### 3.4 Release script (`tools/release.ps1`)

Runs `npm run check` and `npm run perf`, builds the installer and the
portable zip into `release/<version>/`, writes SHA-256 checksums and a
`CHANGELOG.md` entry template. Doesn't publish anything.

### 3.5 Publishing (OI-04, OI-05)

- `.github/workflows/release.yml`: on a `v*` tag, build the installer and
  the portable zip on `windows-latest`, and create a **draft** GitHub
  Release with both files and their checksums. The user publishes the
  draft.
- A winget manifest (`winget/manifests/…`, installer type `nullsoft`,
  per-user scope) generated from the release, plus the steps for
  submitting it to `microsoft/winget-pkgs` (e.g. with `wingetcreate`).
  The submission itself is done by the user.

### 3.6 Documentation

- `README.md`: what MdTiger is, screenshot (light and dark), features,
  install (installer, portable), making it the default app, keyboard
  shortcuts table (generated from the command registry by
  `tools/shortcuts-md.mjs`), custom styles link, building from source,
  licence.
- `docs/custom-styles.md` (from S08) linked.

## 4. Tests

### 4.1 Automated

- `npm run check` and `npm run perf` pass on the release build.
- `tests/e2e/s12-install.test.mjs` (runs only when
  `MDTIGER_INSTALL_TEST=1`, because it installs into the user profile):
  silent install (`/S`) → the exe exists, `HKCU\Software\Classes\.md`
  open-with lists the ProgId, the ProgId's command points to the exe →
  launch via the association (`cmd /c start "" file.md`) opens the file →
  silent uninstall removes them and keeps `settings.json`.
- Portable: with `portable.flag`, the profile ends up next to the exe, and
  nothing is written to `%APPDATA%\MdTiger`.

### 4.2 Manual acceptance (the user)

The full list, including the items left over from the spike:

1. Install without admin rights on a clean user account; Start menu entry
   with the tiger icon.
2. Explorer: `.md` files show the tiger document icon once MdTiger is the
   default; double-click opens the file; a second double-click adds a tab.
3. The default-app banner → *Make default…* → pick MdTiger → banner gone
   on next start.
4. **Cold start after a reboot ≤ 2 s**; warm start ≤ 1 s.
5. **Paste code copied from MdTiger into Word, Outlook and Teams:** plain,
   original whitespace.
6. **Hibernate and resume** with several tabs, one dirty: everything intact,
   no dialogs.
7. Light / dark / follow system, including switching Windows' mode live.
8. A day of real use replacing Zettlr: note anything annoying as open
   issues.
9. Uninstall: program gone, settings kept (or removed when chosen).
10. Upgrade from an earlier build keeps settings and the association.

## 5. Done when

The automated checks pass, the user has done the manual acceptance, and the
open issues are listed.

## 6. Implementation notes

<!-- Written by the implementing session. -->

## 7. Open issues

| ID | Issue | Proposal |
|---|---|---|
| | | |
