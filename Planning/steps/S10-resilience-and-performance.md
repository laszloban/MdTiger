# S10 – External changes, resilience, performance

| | |
|---|---|
| **Depends on** | S09 |
| **Requirements** | FR-FILE-04, NFR-01, NFR-02, NFR-10, NFR-11 (review) |
| **Spike reference** | `spike/tauri/src-tauri/src/main.rs` `watch_file`/`unwatch_file`; `spike/frontend/src/main.ts` section *external changes & resume* (`checkExternal`, `onResumed`, timer-gap check), `retryImages`; `spike/tests/scroll-experiment.mjs`, `spike/tests/profile-typing.mjs`, `spike/measure-startup.ps1` |

## 1. Goal

MdTiger stays correct and quiet when the world changes underneath it
(files edited elsewhere, sleep and hibernate, network loss, a dying web
engine), and it meets the startup and big-document targets with the full
feature set, measured, not assumed.

## 2. Scope

**In:** file watching and the reload/keep-mine flow, deleted and renamed
files, resume handling, image retry, a review of error handling, the
performance suite and any fixes it needs.

**Out:** diff view for conflicts (FR-FILE-04 marks it C).

## 3. Design and tasks

### 3.1 Watching (Rust `watcher.rs`)

- Port the spike: watch the **folder** of each open file (editors often save
  by writing a temp file and renaming), filter events to the open paths,
  debounce 200 ms per path, emit `changed` / `removed` host events.
- Own saves: the front end ignores a `changed` event whose mtime equals the
  one returned by its own `write_file`.
- Unwatch when the last tab of a folder closes.

### 3.2 Reacting (`src/core/external.ts`) (FR-FILE-04)

| Situation | Behavior |
|---|---|
| Changed, no local edits | Reload silently, keep the scroll position (by source offset of the top block, clamped) and cursor as near as possible; status hint "Reloaded – changed outside MdTiger". Undo history: the reload is one undoable transaction. |
| Changed, local edits | Non-blocking banner on that tab: "Changed on disk. *Reload* (lose my edits) / *Keep mine*". *Keep mine* re-bases: the next save overwrites, and the draft's base mtime is updated (spike lesson). Only the banner's tab is affected. |
| Deleted or renamed away | Banner: "Deleted on disk. *Save* to recreate / *Close*". The text stays; the tab is dirty. |
| Recreated after deletion | Treat as changed. |
| Tab not active | Same rules; the banner shows when the tab is activated, and the tab title gets a small indicator. |

### 3.3 Resume and network (NFR-10)

- Resume detection: the spike's timer-gap check (a 1 s interval; a gap
  > 5 s means the machine slept). Optionally add a Rust-side
  power-broadcast listener (`WM_POWERBROADCAST` / `PBT_APMRESUMEAUTOMATIC`)
  if it's cheap; both funnel into one `resumed` handler, debounced.
- On resume: `stat` every open file and run §3.2 for changed ones (watcher
  events may have been missed); re-arm watchers; retry failed images.
- On the `online` event: retry failed remote images.
- Retrying an image means re-setting its `src` with a cache-busting
  fragment only for previously failed ones; the Markdown is unchanged.

### 3.4 Error-handling review (NFR-11)

Go through every `await host.*` call and every Rust command: each failure
path logs and, where the user needs to know, shows a status hint or banner;
none throws into the console unhandled, none shows a dialog. Add the list
of failure paths and their handling to the implementation notes.

### 3.5 Performance suite (`tests/perf/`, `npm run perf`)

| Measure | Target | Method |
|---|---|---|
| Warm startup, `showcase.md` | ≤ 1 s, aim ≤ 0.6 s | `tools/measure-startup.ps1 -Runs 10 -Document tests/fixtures/showcase.md` |
| Warm startup, no document | ≤ 0.5 s | same, no document |
| Open `big.md` (2 MB) | ≤ 3 s to first paint | open via command line, read `ready` |
| Typing in `big.md`, Source / Split | p90 < 50 ms | 200 keystrokes, spike method |
| Scrolling `big.md`, Rendered | median frame ≤ 20 ms | spike `scroll-experiment.mjs` method |
| Outline click → heading visible, `big.md` | ≤ 200 ms | |
| Memory with 10 tabs incl. `big.md` | report only | WebView2 process working set |

- Write results to `tests/perf/results.md` (date, machine, numbers) on each
  run, keeping history.
- Fix what misses a target; typical suspects: Mermaid loaded eagerly,
  code-language parsers loaded at startup, outline rebuilt too often,
  unnecessary full re-renders.
- Add a check to `npm run check` that fails if the main JS bundle grows
  beyond a budget (set it at the current size + 15 %, note it).

## 4. Tests

### 4.1 Unit

- Reload decision table (§3.2) as a pure function.
- Scroll-position mapping after a reload (offset clamping, same block
  found by content when offsets move).
- Timer-gap resume detector with a fake clock.

### 4.2 End to end (`tests/e2e/s10-resilience.test.mjs`)

1. Change the open file on disk without local edits → content reloads, top
   heading still in view, status hint shown, no banner.
2. Same with local edits → banner; *Keep mine* → save overwrites the
   outside change; and a fresh run with *Reload* → outside content shown.
3. Save from another "editor" by temp-file + rename → detected as a change.
4. Delete the file → banner; *Save* recreates it.
5. Own save → no reload, no banner.
6. Simulated resume (test hook advancing the gap detector, or a real
   suspend of the timer) with a file changed while "asleep" and the watcher
   stopped → change detected after resume.
7. A failed remote image is retried on the `online` event (CDP
   `Network.emulateNetworkConditions` offline → online with a local test
   HTTP server serving the image).
8. Renderer kill with dirty tabs in several modes, outline folds and an
   open banner → everything restored except the banner, which is
   re-derived.
9. `npm run perf` meets the targets in §3.5.
10. Earlier suites still pass.

### 4.3 Manual

- Real hibernate and resume with a file changed on another machine via a
  network share while asleep.
- Unplug the network with a document full of remote images, plug it back
  in: images appear, no dialogs.
- Cold start after a reboot ≤ 2 s (NFR-01).

## 5. Done when

All tests pass with `npm run check` and `npm run perf`, manual checks done,
open issues listed.

## 6. Implementation notes

<!-- Written by the implementing session. -->

## 7. Open issues

| ID | Issue | Proposal |
|---|---|---|
| | | |
