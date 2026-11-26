// S02 end-to-end suite: files and tabs, against the real release exe.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fixture, getRunDir, launchApp, sleep } from "./lib/app.mjs";

const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const apps = [];
// One app at a time (single instance): starting a test's app ends the previous one.
const start = async (opts) => {
  for (const old of apps) await old.close();
  const a = await launchApp(opts);
  apps.push(a);
  await a.waitFor(`document.visibilityState === 'visible'`);
  return a;
};
const docs = (app) => app.eval(`window.__mdtiger.docs`);
const waitDocs = (app, n) => app.waitFor(`window.__mdtiger.docs.length === ${n}`);
const activeDoc = async (app) => (await docs(app)).find((d) => d.active);
const hasDialog = (app) => app.eval(`!!document.getElementById('dialog')`);
/** Focuses the editor and puts the caret at the very start. */
async function caretToStart(app) {
  await app.click(".cm-content");
  await app.key("Ctrl+Home");
}
/** Waits for a tab that is not dirty any more. */
const waitClean = (app) => app.waitFor(`(() => { const a = window.__mdtiger.docs.find(d => d.active); return a && !a.dirty; })()`);

describe("S02 files and tabs", () => {
  after(async () => {
    for (const a of apps) await a.close();
  });

  it("1. starts with three files: three tabs, the last active, titles and tooltips", async () => {
    const files = ["plain.md", "hungarian.md", "crlf-bom.md"].map(fixture);
    const app = await start({ files });
    await waitDocs(app, 3);
    const d = await docs(app);
    assert.deepEqual(d.map((x) => x.title), ["plain.md", "hungarian.md", "crlf-bom.md"]);
    assert.deepEqual(d.map((x) => x.active), [false, false, true]);
    const tabs = await app.eval(`[...document.querySelectorAll('#tabs .tab')].map(t => ({ text: t.querySelector('.tab-title').textContent, tip: t.title, active: t.classList.contains('active') }))`);
    assert.deepEqual(tabs.map((t) => t.text), ["plain.md", "hungarian.md", "crlf-bom.md"]);
    assert.deepEqual(tabs.map((t) => t.tip), files);
    assert.deepEqual(tabs.map((t) => t.active), [false, false, true]);
    assert.equal(await app.eval(`document.title`), "crlf-bom.md – MdTiger");
    assert.equal(await app.eval(`document.getElementById('empty-state').hidden`), true);
    // Hungarian text is shown as typed in the file.
    const hu = d[1].text;
    assert.match(hu, /árvíztűrő tükörfúrógép/);
  });

  it("2. byte fidelity: open and save without edits leaves every fixture identical", async () => {
    const names = ["plain.md", "crlf-bom.md", "mixed-eol.md", "no-final-newline.md", "hungarian.md"];
    const files = names.map(fixture);
    const before = files.map(sha);
    const app = await start({ files });
    await waitDocs(app, names.length);
    for (const [i, f] of files.entries()) {
      await app.eval(`window.__mdtiger.workspace.activate(window.__mdtiger.docs[${i}].id)`);
      await app.eval(`window.__mdtiger.commands.run('file.save')`); // resolves when the file is written
      assert.equal(sha(f), before[i], `${names[i]} changed by an open-save round trip`);
    }
  });

  it("3. one typed character: dirty marker, window title, then a save changes only that character", async () => {
    const f = fixture("plain.md");
    const original = readFileSync(f);
    const app = await start({ files: [f] });
    await waitDocs(app, 1);
    await caretToStart(app);
    await app.type("X");
    await app.waitFor(`!document.querySelector('#tabs .tab.active .tab-dirty').hidden`);
    assert.equal(await app.eval(`document.title`), "● plain.md – MdTiger");
    await app.key("Ctrl+S");
    await waitClean(app);
    assert.equal(await app.eval(`document.querySelector('#tabs .tab.active .tab-dirty').hidden`), true);
    assert.equal(await app.eval(`document.title`), "plain.md – MdTiger");
    const after = readFileSync(f);
    assert.equal(after.length, original.length + 1);
    assert.deepEqual([...after.subarray(0, 1)], [0x58]);
    assert.deepEqual([...after.subarray(1)], [...original], "everything but the new character is unchanged");
  });

  it("4. CRLF + BOM: a new line in the middle is CRLF, BOM stays", async () => {
    const f = fixture("crlf-bom.md");
    const original = readFileSync(f);
    const app = await start({ files: [f] });
    await waitDocs(app, 1);
    await caretToStart(app);
    await app.key("ArrowDown");
    await app.key("ArrowDown");
    await app.key("Enter");
    await app.waitFor(`window.__mdtiger.docs[0].dirty`);
    await app.key("Ctrl+S");
    await waitClean(app);
    const after = readFileSync(f);
    assert.deepEqual([...after.subarray(0, 3)], [0xef, 0xbb, 0xbf], "BOM kept");
    const lf = (b) => [...b].filter((x) => x === 0x0a).length;
    const crlf = (b) => b.toString("latin1").split("\r\n").length - 1;
    assert.equal(lf(after), crlf(after), "every LF is part of a CRLF");
    assert.equal(crlf(after), crlf(original) + 1, "one line break added");
  });

  it("4b. S02-01: mixed line endings round-trip; an edit does not touch the other kind", async () => {
    const f = fixture("mixed-eol.md");
    const original = readFileSync(f);
    const app = await start({ files: [f] });
    await waitDocs(app, 1);
    assert.equal((await docs(app))[0].lineSeparator, "\r\n", "the first line break decides");
    await caretToStart(app);
    await app.key("Enter"); // inserts the file's own separator
    await app.type("X");
    await app.key("Ctrl+S");
    await waitClean(app);
    const after = readFileSync(f);
    assert.deepEqual([...after], [...Buffer.concat([Buffer.from("\r\nX"), original])], "only the typed text was added; lone LFs stay lone LFs");
  });

  it("5. second instance: an open path switches to its tab, a new path adds one", async () => {
    const a = fixture("plain.md");
    const b = fixture("hungarian.md");
    const c = fixture("tables.md");
    const app = await start({ files: [a, b] });
    await waitDocs(app, 2);
    assert.equal((await activeDoc(app)).path, b);
    const second = app.launchSecond([a.toLowerCase().replace(/\\/g, "/")]); // another spelling of the same path
    await second.exited;
    await app.waitFor(`window.__mdtiger.docs.find(d => d.active).title === 'plain.md'`);
    assert.equal((await docs(app)).length, 2, "no new tab");
    const third = app.launchSecond([c]);
    await third.exited;
    await waitDocs(app, 3);
    assert.equal((await activeDoc(app)).path, c);
  });

  it("6. invalid UTF-8 opens lossily with a notice on save; a missing file gives a hint", async () => {
    const f = fixture("latin2.md");
    const original = readFileSync(f);
    const app = await start({ files: [f] });
    await waitDocs(app, 1);
    const d = (await docs(app))[0];
    assert.equal(d.lossy, true);
    assert.equal(await hasDialog(app), false, "no dialog");
    assert.match(d.text, /\uFFFD/);
    await app.waitForLog(/WARN opened with invalid UTF-8/);
    await app.click(".cm-content");
    await app.key("Ctrl+S");
    await app.waitFor(`!document.getElementById('toast').hidden`);
    assert.match(await app.eval(`document.getElementById('toast').textContent`), /replaced/i);
    await app.waitForLog(/WARN saved with invalid UTF-8 bytes replaced/);
    assert.equal(await hasDialog(app), false, "still no dialog");
    assert.ok(readFileSync(f).includes(Buffer.from([0xef, 0xbf, 0xbd])), "the file now holds U+FFFD");
    assert.notDeepEqual([...readFileSync(f)], [...original]);

    const missing = join(dirname(f), "does-not-exist.md");
    const second = app.launchSecond([missing]);
    await second.exited;
    await app.waitFor(`/Cannot open does-not-exist\\.md/.test(document.getElementById('status').textContent)`);
    await app.waitForLog(/ERROR open failed: .*does-not-exist\.md/);
    assert.equal((await docs(app)).length, 1, "no tab for a missing file");
    assert.equal(await hasDialog(app), false);
  });

  it("7. closing a dirty tab asks: Cancel keeps it, Don't save drops it, Save saves it", async () => {
    const f = fixture("plain.md");
    const g = fixture("hungarian.md");
    const originalF = sha(f);
    const originalText = readFileSync(f, "utf8");
    const app = await start({ files: [f, g] });
    await waitDocs(app, 2);
    await app.eval(`window.__mdtiger.workspace.activate(window.__mdtiger.docs[0].id)`);
    await caretToStart(app);
    await app.type("Q");
    await app.waitFor(`window.__mdtiger.docs[0].dirty`);
    await app.key("Ctrl+W");
    await app.waitFor(`!!document.getElementById('dialog')`);
    assert.match(await app.eval(`document.getElementById('dialog').textContent`), /Save changes to plain\.md/);
    await app.click("#dialog-cancel");
    await app.waitFor(`!document.getElementById('dialog')`);
    assert.equal((await docs(app)).length, 2, "Cancel keeps the tab");
    assert.equal((await docs(app))[0].dirty, true);

    await app.key("Ctrl+W");
    await app.waitFor(`!!document.getElementById('dialog')`);
    await app.click("#dialog-discard");
    await waitDocs(app, 1);
    assert.equal(sha(f), originalF, "Don't save leaves the file alone");

    // Save: reopen the file, edit, close with Save.
    await app.eval(`window.__mdtiger.testHooks.nextPickPath = [${JSON.stringify(f)}]; window.__mdtiger.commands.run('file.open')`);
    await waitDocs(app, 2);
    await caretToStart(app);
    await app.type("S");
    await app.waitFor(`window.__mdtiger.docs.find(d => d.active).dirty`);
    await app.key("Ctrl+W");
    await app.waitFor(`!!document.getElementById('dialog')`);
    await app.click("#dialog-save");
    await waitDocs(app, 1);
    assert.equal(readFileSync(f, "utf8"), "S" + originalText, "Save wrote the change");
  });

  it("8. Save As writes a new file, retitles the tab and leaves the old file alone", async () => {
    const f = fixture("plain.md");
    const originalSha = sha(f);
    const app = await start({ files: [f] });
    await waitDocs(app, 1);
    await caretToStart(app);
    await app.type("Z");
    const target = join(getRunDir(), "files", "copy.md");
    await app.eval(`window.__mdtiger.testHooks.nextSavePath = ${JSON.stringify(target)}; true`);
    await app.key("Ctrl+Shift+S");
    await app.waitFor(`window.__mdtiger.docs[0].title === 'copy.md'`);
    assert.equal(readFileSync(target, "utf8").startsWith("Z"), true);
    assert.equal(sha(f), originalSha, "old file unchanged");
    assert.equal(await app.eval(`document.title`), "copy.md – MdTiger");

    // An untitled document gets .md when the chosen name has no extension.
    await app.key("Ctrl+N");
    await app.waitFor(`window.__mdtiger.docs.length === 2 && window.__mdtiger.docs[1].title === 'Untitled'`);
    await app.click(".cm-content");
    await app.type("new");
    const bare = join(getRunDir(), "files", "bare");
    await app.eval(`window.__mdtiger.testHooks.nextSavePath = ${JSON.stringify(bare)}; true`);
    await app.key("Ctrl+Shift+S");
    await app.waitFor(`window.__mdtiger.docs[1].title === 'bare.md'`);
    assert.equal(readFileSync(bare + ".md", "utf8"), "new");
  });

  it("9. tabs reorder by dragging, and Ctrl+Tab follows the new order", async () => {
    const files = ["plain.md", "hungarian.md", "tables.md"].map(fixture);
    const app = await start({ files });
    await waitDocs(app, 3);
    // Drag the first tab past the last.
    await app.drag('#tabs .tab:nth-child(1)', '#tabs .tab:nth-child(3)', { toEdge: "right" });
    await app.waitFor(`window.__mdtiger.docs.map(d => d.title).join() === 'hungarian.md,tables.md,plain.md'`);
    assert.deepEqual(
      await app.eval(`[...document.querySelectorAll('#tabs .tab-title')].map(t => t.textContent)`),
      ["hungarian.md", "tables.md", "plain.md"],
    );
    assert.equal((await activeDoc(app)).title, "plain.md", "the dragged tab is the active one");
    await app.key("Ctrl+Tab");
    assert.equal((await activeDoc(app)).title, "hungarian.md", "wraps to the first");
    await app.key("Ctrl+Tab");
    assert.equal((await activeDoc(app)).title, "tables.md");
    await app.key("Ctrl+Shift+Tab");
    assert.equal((await activeDoc(app)).title, "hungarian.md");
    await app.key("Ctrl+PageDown");
    assert.equal((await activeDoc(app)).title, "tables.md");
    await app.key("Ctrl+PageUp");
    assert.equal((await activeDoc(app)).title, "hungarian.md");
  });

  it("10. a killed renderer: the same tabs come back, the edited one dirty, with the banner", async () => {
    const files = ["plain.md", "hungarian.md"].map(fixture);
    const app = await start({ files });
    await waitDocs(app, 2);
    await app.eval(`window.__mdtiger.workspace.activate(window.__mdtiger.docs[0].id)`);
    await caretToStart(app);
    await app.type("EDIT");
    await app.waitFor(`window.__mdtiger.docs[0].dirty`);
    await app.eval(`window.__mdtiger.workspace.activate(window.__mdtiger.docs[1].id)`); // another tab is active
    await sleep(1500);
    for (const pid of app.rendererPids()) {
      try {
        process.kill(pid);
      } catch {
        /* gone */
      }
    }
    const t0 = Date.now();
    let ok = false;
    while (Date.now() - t0 < 15000 && !ok) {
      try {
        await app.connect(500);
        ok = (await app.eval(`window.__mdtiger && window.__mdtiger.docs.length === 2`)) === true;
      } catch {
        await sleep(150);
      }
    }
    assert.ok(ok, "the two tabs are back");
    const d = await docs(app);
    assert.deepEqual(d.map((x) => x.title), ["plain.md", "hungarian.md"]);
    assert.equal(d[0].dirty, true);
    assert.ok(d[0].text.startsWith("EDIT"), "the edit survived");
    assert.equal(d[1].active, true, "the active tab is the same");
    assert.equal(d[1].dirty, false);
    await app.eval(`window.__mdtiger.workspace.activate(window.__mdtiger.docs[0].id)`);
    await app.waitFor(`!document.getElementById('banner').hidden`);
    assert.match(await app.eval(`document.getElementById('banner').textContent`), /Unsaved changes restored/);
    assert.match(app.log(), /session restored: 2 tab/);
  });

  it("11. a draft of a file that changed meanwhile is offered, not applied", async () => {
    const f = fixture("plain.md");
    const profile = join(getRunDir(), "profile-stale");
    const app = await start({ files: [f], profile });
    await waitDocs(app, 1);
    await caretToStart(app);
    await app.type("DRAFT");
    await app.waitFor(`window.__mdtiger.docs[0].dirty`);
    await sleep(1500);
    await app.close(); // killed: no clean shutdown
    writeFileSync(f, "changed on disk\n");
    const again = await start({ files: [f], profile });
    await waitDocs(again, 1);
    const d = (await docs(again))[0];
    assert.equal(d.text, "changed on disk\n", "the disk content is shown");
    assert.equal(d.dirty, false);
    await again.waitFor(`!document.getElementById('banner').hidden`);
    assert.match(await again.eval(`document.getElementById('banner').textContent`), /older unsaved draft/);
    await again.click("#banner-use-draft");
    await again.waitFor(`window.__mdtiger.docs[0].dirty`);
    assert.ok((await docs(again))[0].text.startsWith("DRAFT"), "Use draft applies it");
    assert.equal(await again.eval(`document.getElementById('banner').hidden`), true);
  });

  it("13. closing the window asks about unsaved tabs; a frozen page does not block the close", async () => {
    const f = fixture("plain.md");
    const app = await start({ files: [f] });
    await waitDocs(app, 1);
    await caretToStart(app);
    await app.type("W");
    await app.waitFor(`window.__mdtiger.docs[0].dirty`);
    closeMainWindow(app.pid);
    await app.waitFor(`!!document.getElementById('dialog')`);
    await app.click("#dialog-cancel");
    await app.waitFor(`!document.getElementById('dialog')`);
    await sleep(300);
    assert.equal(app.alive, true, "Cancel keeps the window open");
    // Freeze the page (JavaScript paused): the shell must still close the window.
    await app.cdp("Debugger.enable");
    await app.cdp("Debugger.pause");
    await sleep(200);
    const t0 = Date.now();
    const exited = new Promise((r) => app.child.once("exit", r));
    closeMainWindow(app.pid);
    await Promise.race([exited, sleep(10000)]);
    assert.equal(app.alive, false, "the window closed");
    const ms = Date.now() - t0;
    assert.ok(ms >= 2500 && ms < 9000, `closed after the 3 s timeout (${ms} ms)`);
    assert.match(app.log(), /did not answer the close request in 3 s/);
  });

  it("14. a clean window closes at once; drop of a non-Markdown file gives a hint", async () => {
    const app = await start({ files: [fixture("plain.md")] });
    await waitDocs(app, 1);
    await app.eval(`window.__mdtiger.emitHostEvent({ type: 'drop', path: 'C:\\\\x\\\\notes.txt' }); true`);
    await app.waitFor(`/Not a Markdown file: notes\\.txt/.test(document.getElementById('status').textContent)`);
    assert.equal((await docs(app)).length, 1);
    const f = fixture("tables.md");
    await app.eval(`window.__mdtiger.emitHostEvent({ type: 'drop', path: ${JSON.stringify(f)} }); true`);
    await waitDocs(app, 2);
    const exited = new Promise((r) => app.child.once("exit", r));
    closeMainWindow(app.pid);
    await Promise.race([exited, sleep(5000)]);
    assert.equal(app.alive, false, "closed without a dialog");
    assert.match(app.log(), /window close confirmed by the front end/);
  });
});

/** Like clicking the window's X: WM_CLOSE to the main window. */
function closeMainWindow(pid) {
  execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).CloseMainWindow() | Out-Null`]);
}
