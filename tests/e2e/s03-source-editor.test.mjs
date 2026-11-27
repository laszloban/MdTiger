// S03 end-to-end suite: source editor, find and replace, against the real release exe.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { fixture, getRunDir, launchApp, sleep } from "./lib/app.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const apps = [];
// One app at a time (single instance): starting a test's app ends the previous one.
const start = async (opts) => {
  for (const old of apps) await old.close();
  // These suites test the editor: tabs open in Source mode (S04 made Rendered the default).
  const a = await launchApp({ settings: { defaultMode: "source" }, ...opts });
  apps.push(a);
  await a.waitFor(`document.visibilityState === 'visible'`);
  await a.waitFor(`window.__mdtiger && window.__mdtiger.docs.length === ${opts?.files?.length ?? 0}`);
  await a.focusWindow();
  return a;
};
/** Writes a test document into this run's temp folder; returns its path. */
function tmpDoc(name, text) {
  const p = join(getRunDir(), "files", name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
}
const view = `window.__mdtiger.workspace.active.view`;
const docText = (app) => app.eval(`${view}.state.doc.toString()`);
const count = (app) => app.eval(`document.getElementById('find-count').textContent`);
const bar = (app, id) => app.eval(`!document.getElementById(${JSON.stringify(id)}).hidden`);
/** Selects [from, to) in the editor and gives it focus. */
async function select(app, from, to = from) {
  await app.eval(`(() => { const v = ${view}; v.focus(); v.dispatch({ selection: { anchor: ${from}, head: ${to} } }); })()`);
}
const FIND_DOC = "# Find test\nalpha beta alpha\ngamma alpha\nann@x and bob@x\nlast line\n";

describe("S03 source editor", () => {
  after(async () => {
    for (const a of apps) await a.close();
  });

  it("1. fenced code blocks get language-specific highlighting (lazy load within 2 s)", async () => {
    const text = [
      "# Code",
      "",
      "```csharp",
      'public class A { string s = "x"; int n = 1; }',
      "```",
      "",
      "```powershell",
      'function Get-X { param($a) "hi" }',
      "```",
      "",
      "```json",
      '{"a": 1, "b": "s"}',
      "```",
      "",
      "```yaml",
      "key: value",
      "list:",
      "  - 1",
      "```",
      "",
      "```nosuchlanguage",
      "plain text here",
      "```",
      "",
    ].join("\n");
    const app = await start({ files: [tmpDoc("code.md", text)] });
    // 1-based source lines of each block's content.
    const blocks = { csharp: [4], powershell: [8], json: [12], yaml: [16, 17, 18], nosuchlanguage: [22] };
    const classesOf = (lines) =>
      app.eval(`(() => {
        const v = ${view};
        const out = new Set();
        for (const n of ${JSON.stringify(lines)}) {
          const pos = v.state.doc.line(n).from;
          const { node } = v.domAtPos(pos);
          const line = (node.nodeType === 1 ? node : node.parentElement).closest('.cm-line');
          if (!line) { out.add('NOLINE'); continue; }
          for (const s of line.querySelectorAll('span')) for (const c of s.classList) if (c.startsWith('tok-')) out.add(c);
        }
        return [...out].filter(c => c !== 'tok-monospace');
      })()`);
    for (const lang of ["csharp", "powershell", "json", "yaml"]) {
      const deadline = Date.now() + 2000;
      let classes = [];
      while (Date.now() < deadline) {
        classes = await classesOf(blocks[lang]);
        if (classes.length) break;
        await sleep(100);
      }
      assert.ok(classes.length > 0 && !classes.includes("NOLINE"), `${lang}: no language tokens within 2 s (${classes})`);
    }
    // Without a parser for the language only the Markdown "monospace" class appears.
    assert.deepEqual(await classesOf(blocks.nosuchlanguage), []);
  });

  it("2. Ctrl+F takes the selected word; the counter shows 1 of N", async () => {
    const f = tmpDoc("find.md", FIND_DOC);
    const app = await start({ files: [f] });
    const from = FIND_DOC.indexOf("alpha");
    await select(app, from, from + 5);
    await app.key("Ctrl+F");
    await app.waitFor(`!document.getElementById('find-bar').hidden`);
    assert.equal(await app.eval(`document.getElementById('find-input').value`), "alpha");
    assert.equal(await app.eval(`document.activeElement.id`), "find-input");
    assert.equal(await count(app), "1 of 3");
    assert.equal(await bar(app, "find-replace-row"), false, "the replace row is closed with Ctrl+F");
    // All matches are highlighted, the current one differently.
    assert.equal(await app.eval(`document.querySelectorAll('.cm-find-match').length`), 3);
    assert.equal(await app.eval(`document.querySelectorAll('.cm-find-current').length`), 1);
  });

  it("3. F3, Shift+F3, Enter and Shift+Enter move the current match and the counter", async () => {
    const f = tmpDoc("find3.md", FIND_DOC);
    const app = await start({ files: [f] });
    const from = FIND_DOC.indexOf("alpha");
    await select(app, from, from + 5);
    await app.key("Ctrl+F");
    await app.waitFor(`document.getElementById('find-count').textContent === '1 of 3'`);
    await app.key("F3");
    assert.equal(await count(app), "2 of 3");
    await app.key("F3");
    assert.equal(await count(app), "3 of 3");
    await app.key("F3"); // wraps
    assert.equal(await count(app), "1 of 3");
    await app.key("Shift+F3");
    assert.equal(await count(app), "3 of 3");
    await app.key("Enter");
    assert.equal(await count(app), "1 of 3");
    await app.key("Enter");
    assert.equal(await count(app), "2 of 3");
    await app.key("Shift+Enter");
    assert.equal(await count(app), "1 of 3");
    // The editor's selection follows.
    assert.equal(await app.eval(`${view}.state.selection.main.from`), from);
    // Typing a term that is not there, and an invalid regex.
    await app.eval(`(() => { const i = document.getElementById('find-input'); i.select(); })()`);
    await app.type("zzz");
    assert.equal(await count(app), "No results");
    await app.click("#find-regex");
    await app.eval(`document.getElementById('find-input').select()`);
    await app.type("(");
    assert.equal(await count(app), "Invalid regex");
  });

  it("4. Ctrl+H, Replace all with a regex: correct text, status message, one Ctrl+Z restores", async () => {
    const f = tmpDoc("replace.md", FIND_DOC);
    const app = await start({ files: [f] });
    await app.click(".cm-content");
    await app.key("Ctrl+H");
    await app.waitFor(`!document.getElementById('find-replace-row').hidden`);
    // Focus is in the find field; one Tab goes to the replace field, Shift+Tab back.
    assert.equal(await app.eval(`document.activeElement.id`), "find-input");
    await app.key("Tab");
    assert.equal(await app.eval(`document.activeElement.id`), "replace-input");
    await app.key("Shift+Tab");
    assert.equal(await app.eval(`document.activeElement.id`), "find-input");
    await app.click("#find-regex");
    await app.click("#find-input");
    await app.type("(\\w+)@x");
    await app.waitFor(`document.getElementById('find-count').textContent.endsWith(' of 2') || document.getElementById('find-count').textContent === '2 results'`);
    await app.click("#replace-input");
    await app.type("$1@y");
    await app.click("#replace-all");
    assert.equal(await docText(app), FIND_DOC.replace("ann@x", "ann@y").replace("bob@x", "bob@y"));
    assert.equal(await app.eval(`document.getElementById('status').textContent`), "Replaced 2 occurrences");
    await app.key("Escape"); // back to the editor
    await app.key("Ctrl+Z");
    assert.equal(await docText(app), FIND_DOC, "one undo step restores the original text exactly");
  });

  it("5. Escape closes the bar; the editor has focus and the match is selected", async () => {
    const f = tmpDoc("escape.md", FIND_DOC);
    const app = await start({ files: [f] });
    const from = FIND_DOC.indexOf("gamma");
    await select(app, from, from + 5);
    await app.key("Ctrl+F");
    await app.waitFor(`document.getElementById('find-count').textContent === '1 of 1'`);
    await app.key("Escape");
    await app.waitFor(`document.getElementById('find-bar').hidden`);
    assert.equal(await app.eval(`!!document.activeElement.closest('.cm-editor')`), true);
    assert.equal(await app.eval(`${view}.state.sliceDoc(${view}.state.selection.main.from, ${view}.state.selection.main.to)`), "gamma");
    assert.equal(await app.eval(`document.querySelectorAll('.cm-find-match').length`), 0, "highlighting is gone");
  });

  it("6. Ctrl+G 120 puts the cursor on line 120 and scrolls it into view", async () => {
    const text = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const app = await start({ files: [tmpDoc("lines.md", text)] });
    await app.click(".cm-content");
    await app.key("Ctrl+G");
    await app.waitFor(`!document.getElementById('goto-bar').hidden`);
    await app.type("120");
    await app.key("Enter");
    await app.waitFor(`document.getElementById('goto-bar').hidden`);
    assert.equal(await app.eval(`${view}.state.doc.lineAt(${view}.state.selection.main.head).number`), 120);
    await app.waitFor(`(() => {
      const v = ${view};
      const c = v.coordsAtPos(v.state.selection.main.head);
      const r = v.scrollDOM.getBoundingClientRect();
      return !!c && c.top >= r.top && c.bottom <= r.bottom;
    })()`);
    assert.equal(await app.eval(`!!document.activeElement.closest('.cm-editor')`), true);
    // line:column
    await app.key("Ctrl+G");
    await app.type("5:3");
    await app.key("Enter");
    assert.equal(await app.eval(`(() => { const s = ${view}.state; const l = s.doc.lineAt(s.selection.main.head); return l.number + ':' + (s.selection.main.head - l.from + 1); })()`), "5:3");
  });

  it("7. copying from the editor puts plain text only on the clipboard", async () => {
    const f = tmpDoc("copy.md", "# Title\n\n**bold** and `code`\n");
    const app = await start({ files: [f] });
    await select(app, 0, 7);
    await app.eval(`document.execCommand('copy')`);
    await sleep(300);
    const clip = app.clipboard();
    assert.equal(clip.text, "# Title");
    assert.ok(!clip.formats.some((x) => /html|rich/i.test(x)), `formats: ${clip.formats}`);
  });

  it("8. experimental.livePreview shows a heading without its # when the cursor is elsewhere", async () => {
    const f = tmpDoc("live.md", "# Heading\n\nbody text\n");
    const app = await start({ files: [f] });
    // Off by default: the # is in the line.
    assert.match(await app.eval(`document.querySelector('.cm-line').textContent`), /^# Heading/);
    await app.eval(`window.__mdtiger.settings.set('experimental.livePreview', true); window.__mdtiger.settings.flush()`);
    await app.eval(`location.reload()`);
    await sleep(500);
    await app.connect();
    await app.waitFor(`window.__mdtiger && window.__mdtiger.docs.length === 1`);
    await select(app, "# Heading\n\nbody".length);
    await app.waitFor(`document.querySelector('.cm-line')?.textContent === 'Heading'`);
    assert.equal(await app.eval(`document.querySelector('.cm-line').classList.contains('lp-h1')`), true);
    // On the heading line the raw Markdown is back.
    await select(app, 3);
    await app.waitFor(`document.querySelector('.cm-line')?.textContent === '# Heading'`);
    assert.match(app.log(), /^(?!.*ERROR)/s);
  });

  it("9. typing latency on the 2 MB document: p90 < 50 ms over 200 keystrokes", async () => {
    if (!existsSync(join(ROOT, "tests", "fixtures", "big.md"))) execFileSync("node", [join(ROOT, "tools", "make-big.mjs")], { stdio: "ignore" });
    const app = await start({ files: [fixture("big.md")] });
    await select(app, await app.eval(`Math.floor(${view}.state.doc.length / 2)`));
    await app.eval(`${view}.dispatch({ effects: window.__mdtiger.workspace.active.view.constructor.scrollIntoView(${view}.state.selection.main.head, { y: 'center' }) })`);
    await sleep(3000); // let the parser reach the middle
    await app.eval(`(() => {
      window.__lat = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'keydown') window.__lat.push(e.duration); }).observe({ type: 'event', durationThreshold: 16 });
    })()`);
    const before = await app.eval(`${view}.state.doc.length`);
    for (let i = 0; i < 200; i++) {
      await app.type("a");
      await sleep(25);
    }
    await sleep(500);
    assert.equal(await app.eval(`${view}.state.doc.length`), before + 200);
    const slow = await app.eval(`window.__lat`);
    // The observer reports only events of 16 ms or more; the rest count as 0.
    const all = [...slow.sort((a, b) => a - b)];
    while (all.length < 200) all.unshift(0);
    const p90 = all[Math.floor(200 * 0.9)];
    console.log(`      typing latency: p90 ${p90} ms, max ${all[199]} ms, ${slow.length} of 200 keystrokes at 16 ms or more`);
    assert.ok(p90 < 50, `p90 ${p90} ms`);
  });

  it("10. Enter continues a list and Tab stays in the editor", async () => {
    const f = tmpDoc("keys.md", "");
    const app = await start({ files: [f] });
    await app.click(".cm-content");
    await app.type("- a");
    await app.key("Enter");
    await app.type("b");
    await app.key("Tab");
    assert.equal(await docText(app), "- a\n  - b");
    assert.equal(await app.eval(`!!document.activeElement.closest('.cm-editor')`), true);
    await app.key("Shift+Tab");
    assert.equal(await docText(app), "- a\n- b");
    await app.key("Enter");
    await app.key("Enter"); // empty item: ends the list
    assert.equal(await docText(app), "- a\n- b\n");
    await app.key("Tab"); // not in a list: indent unit
    assert.equal(await docText(app), "- a\n- b\n  ");
    assert.equal(await app.eval(`!!document.activeElement.closest('.cm-editor')`), true);
  });
});
