// S01 end-to-end suite: drives the real release exe.
// Run with: npm run e2e  (build the release exe first: npm run check does both)

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { join } from "node:path";
import { fixture, launchApp, listOrNull, mtimeOrNull, newProfileDir, sleep } from "./lib/app.mjs";

const appData = process.env.APPDATA ? join(process.env.APPDATA, "MdTiger") : null;
const localLogs = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "MdTiger", "logs") : null;
const realProfile = () => ({
  settings: appData && { mtime: mtimeOrNull(appData), names: listOrNull(appData) },
  logs: localLogs && { mtime: mtimeOrNull(localLogs), names: listOrNull(localLogs) },
});
const realBefore = realProfile();

describe("S01 foundation", () => {
  let app;
  const apps = [];
  const start = async (opts) => {
    const a = await launchApp(opts);
    apps.push(a);
    return a;
  };

  before(async () => {
    app = await start();
  });

  after(async () => {
    for (const a of apps) await a.close();
  });

  it("1. starts, shows the window with the empty state and logs a ready line", async () => {
    await app.waitFor(`!!document.querySelector('#empty-state') && !document.querySelector('#empty-state').hidden`);
    // The window is created hidden and shown by app_ready: the page is visible only then.
    await app.waitFor(`document.visibilityState === 'visible'`);
    const text = await app.eval(`document.querySelector('#empty-state').textContent`);
    assert.match(text, /Open a Markdown file/);
    assert.match(text, /Ctrl\+O/);
    for (const id of ["toolbar", "tabs", "outline", "banner", "content", "status"]) {
      assert.equal(await app.eval(`!!document.getElementById('${id}')`), true, `#${id} exists`);
    }
    const m = await app.waitForLog(/INFO ready ProcessMs=(\d+) FrontMs=(\d+)/);
    console.log(`  ready: ProcessMs=${m[1]} FrontMs=${m[2]}`);
    assert.doesNotMatch(app.log(), /front end not ready/);
  });

  it("2. writes into MDTIGER_PROFILE_DIR and leaves the real profile alone", async () => {
    assert.ok(existsSync(join(app.profile, "logs", "mdtiger.log")), "log in the profile folder");
    assert.ok(existsSync(join(app.profile, "webview")), "WebView2 data in the profile folder");
    assert.deepEqual(realProfile(), realBefore, "real %APPDATA%\\MdTiger and %LOCALAPPDATA%\\MdTiger\\logs unchanged");
  });

  it("3. logs uncaught errors and rejections; the page keeps working", async () => {
    await app.eval(`setTimeout(() => { throw new Error('e2e-boom'); }, 0); true`);
    await app.waitForLog(/ERROR uncaught error: .*e2e-boom/);
    await app.eval(`Promise.reject(new Error('e2e-reject')); true`);
    await app.waitForLog(/ERROR unhandled rejection: .*e2e-reject/);
    assert.equal(await app.eval(`1 + 1`), 2);
    assert.equal(await app.eval(`!!document.getElementById('layout')`), true);
  });

  it("4. logs a panic from a worker thread; the app keeps running", async () => {
    await app.eval(`window.__TAURI_INTERNALS__.invoke('test_panic')`);
    await app.waitForLog(/ERROR panic: .*e2e-test-panic/);
    assert.ok(app.alive, "process still running");
    assert.equal(await app.eval(`1 + 1`), 2);
  });

  it("4b. test_panic does not exist without MDTIGER_TEST=1", async () => {
    // Only one instance can run at a time: close the first one.
    await app.close();
    const plain = await start({ env: { MDTIGER_TEST: "0" } });
    try {
      await plain.waitFor(`!!window.__mdtiger`);
      const err = await plain.eval(`window.__TAURI_INTERNALS__.invoke('test_panic').then(() => 'ran', (e) => String(e))`);
      assert.notEqual(err, "ran");
      assert.match(err, /not found|not allowed|unknown/i);
      assert.doesNotMatch(plain.log(), /test_panic command registered/);
    } finally {
      await plain.close();
    }
  });

  it("5. settings round trip across a restart", async () => {
    const profile = newProfileDir();
    const a = await start({ profile });
    try {
      await a.waitFor(`!!window.__mdtiger`);
      assert.equal(await a.eval(`window.__mdtiger.settings.get('theme')`), "system");
      await a.eval(`window.__mdtiger.settings.set('theme', 'dark'); true`);
      await sleep(600);
      const file = readFileSync(join(profile, "settings.json"), "utf8");
      assert.equal(JSON.parse(file).theme, "dark");
      assert.ok(file.includes("\n"), "human-readable (multi-line)");
    } finally {
      await a.close();
    }

    const b = await start({ profile });
    try {
      await b.waitFor(`!!window.__mdtiger`);
      assert.equal(await b.eval(`window.__mdtiger.settings.get('theme')`), "dark");
    } finally {
      await b.close();
    }
  });

  it("6. recovers from a dead renderer", async () => {
    app = await start();
    await app.waitFor(`document.visibilityState === 'visible'`);
    // A marker that only survives if the page is NOT reloaded.
    await app.eval(`window.__marker = 'old page'; true`);
    const pids = app.rendererPids();
    assert.ok(pids.length > 0, "found renderer processes to kill");
    const t0 = Date.now();
    for (const pid of pids) {
      try {
        process.kill(pid);
      } catch {
        /* already gone */
      }
    }
    // The old page target is gone: reconnect and ask the new page.
    let ms = null;
    while (Date.now() - t0 < 10000) {
      try {
        await app.connect(500);
        if ((await app.eval(`!!document.getElementById('layout')`)) === true) {
          ms = Date.now() - t0;
          break;
        }
      } catch {
        await sleep(100);
      }
    }
    assert.notEqual(ms, null, "page answered again");
    assert.equal(await app.eval(`window.__marker === undefined`), true, "the page was reloaded (marker is gone)");
    await app.waitForLog(/ERROR WebView2 process failed, kind \d+/);
    console.log(`  page answered again after ${ms} ms`);
    assert.ok(ms <= 3000, `recovered within 3 s (took ${ms} ms)`);
    await app.waitForLog(/INFO recovery: reloading the page/);
    assert.ok(app.alive);
  });

  it("7. a second launch hands its file to the first instance and exits", async () => {
    const path = fixture("plain.md");
    const t0 = Date.now();
    const second = app.launchSecond([path]);
    const code = await Promise.race([second.exited, sleep(2000).then(() => "timeout")]);
    assert.notEqual(code, "timeout", "second process exits within 2 s");
    console.log(`  second process exited with code ${code} after ${Date.now() - t0} ms`);
    await app.waitForLog(/INFO open event: .*plain\.md/);
    await app.waitForLog(/INFO host event: open .*plain\.md/);
    assert.ok(app.alive);
  });

  it("8. the real profile was untouched by the whole run", () => {
    assert.deepEqual(realProfile(), realBefore);
  });
});
