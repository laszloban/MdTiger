// S04 end-to-end suite: rendered view, modes, split, sanitising, against the real release exe.

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
  const a = await launchApp(opts); // no settings: the default mode is Rendered
  apps.push(a);
  await a.waitFor(`document.visibilityState === 'visible'`);
  await a.waitFor(`window.__mdtiger && window.__mdtiger.docs.length === ${opts?.files?.length ?? 0}`);
  await a.focusWindow();
  return a;
};
function tmpDoc(name, text) {
  const p = join(getRunDir(), "files", name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
}
const view = `window.__mdtiger.workspace.active.view`;
const rendered = `window.__mdtiger.workspace.active.rendered`;

/** The pressed buttons, and the mode the panes show. */
const modeState = (app) =>
  app.eval(`(() => {
    const pressed = [...document.querySelectorAll('#mode-switch button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.mode);
    const shown = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; };
    return { pressed, mode: document.getElementById('workarea').dataset.mode, source: shown('pane-source'), rendered: shown('pane-rendered'), docMode: window.__mdtiger.workspace.active.mode };
  })()`);

async function assertMode(app, mode) {
  await app.waitFor(`document.getElementById('workarea').dataset.mode === ${JSON.stringify(mode)}`);
  const s = await modeState(app);
  assert.deepEqual(s.pressed, [mode], "exactly one button is pressed and it is the active mode");
  assert.equal(s.docMode, mode);
  assert.equal(s.source, mode !== "rendered", `source pane visible in ${mode}`);
  assert.equal(s.rendered, mode !== "source", `rendered pane visible in ${mode}`);
}

/** The top-level rendered block at the top of the rendered pane. */
const renderedTopBlock = `(() => {
  const pane = document.querySelector('#pane-rendered .rendered-pane');
  const top = pane.getBoundingClientRect().top + 4;
  const b = [...pane.querySelectorAll('.rendered-doc > [data-from]')].find((e) => e.getBoundingClientRect().bottom > top);
  return b ? { from: +b.dataset.from, to: +b.dataset.to } : null;
})()`;
const editorTop = `(() => { const v = ${view}; return v.lineBlockAtHeight(v.scrollDOM.scrollTop).from; })()`;

describe("S04 rendered view and modes", () => {
  after(async () => {
    for (const a of apps) await a.close();
  });

  it("1. showcase.md opens in Rendered mode and the Rendered button is pressed and visibly different", async () => {
    const app = await start({ files: [fixture("showcase.md")] });
    await app.waitFor(`document.querySelectorAll('#pane-rendered h1').length === 1`);
    await assertMode(app, "rendered");
    const bg = await app.eval(`[...document.querySelectorAll('#mode-switch button')].map((b) => ({ mode: b.dataset.mode, bg: getComputedStyle(b).backgroundColor, fg: getComputedStyle(b).color }))`);
    const on = bg.find((b) => b.mode === "rendered");
    for (const other of bg.filter((b) => b.mode !== "rendered")) {
      assert.notEqual(on.bg, other.bg, `pressed background differs from ${other.mode}`);
    }
    assert.notEqual(on.bg, on.fg);
    assert.equal(await app.eval(`document.querySelector('#pane-rendered details.front-matter').open`), false);
    assert.equal(await app.eval(`document.querySelector('#pane-rendered h2').id`), "1-code-blocks-s2");
    // Headings differ clearly in size.
    const sizes = await app.eval(`['h1','h2','h3','h4'].map((t) => parseFloat(getComputedStyle(document.querySelector('#pane-rendered ' + t)).fontSize))`);
    assert.ok(sizes[0] > sizes[1] && sizes[1] > sizes[2] && sizes[2] > sizes[3], `heading sizes ${sizes}`);
  });

  it("2. Ctrl+2, Ctrl+3, Ctrl+1 and Ctrl+E switch modes; one button is always pressed", async () => {
    const app = await start({ files: [fixture("showcase.md")] });
    await assertMode(app, "rendered");
    await app.key("Ctrl+2");
    await assertMode(app, "source");
    assert.equal(await app.eval(`!!document.activeElement.closest('.cm-editor')`), true, "the editor has the focus in Source");
    await app.key("Ctrl+3");
    await assertMode(app, "split");
    await app.key("Ctrl+1");
    await assertMode(app, "rendered");
    assert.equal(await app.eval(`!!document.activeElement.closest('.rendered-pane')`), true, "the rendered pane has the focus");
    await app.key("Ctrl+E");
    await assertMode(app, "source");
    await app.key("Ctrl+E");
    await assertMode(app, "rendered");
    await app.key("Ctrl+3");
    await app.key("Ctrl+E"); // from Split: to Source? no: Split is neither, so it goes to Source
    await assertMode(app, "source");
    // Clicking the buttons works too, and the focus ring on another button doesn't move the highlight.
    await app.click("#mode-split");
    await assertMode(app, "split");
    await app.eval(`document.getElementById('mode-source').focus()`);
    assert.deepEqual((await modeState(app)).pressed, ["split"]);
  });

  it("3. the mode is per tab: tab A in Source, tab B in Rendered", async () => {
    const app = await start({ files: [fixture("showcase.md"), fixture("tables.md")] });
    const ids = await app.eval(`window.__mdtiger.docs.map((d) => d.id)`);
    await app.eval(`window.__mdtiger.workspace.activate(${JSON.stringify(ids[0])})`);
    await app.key("Ctrl+2");
    await assertMode(app, "source");
    await app.eval(`window.__mdtiger.workspace.activate(${JSON.stringify(ids[1])})`);
    await assertMode(app, "rendered"); // a new tab opened in the default mode
    await app.eval(`window.__mdtiger.workspace.activate(${JSON.stringify(ids[0])})`);
    await assertMode(app, "source");
    await app.eval(`window.__mdtiger.workspace.activate(${JSON.stringify(ids[1])})`);
    await assertMode(app, "rendered");
    await app.key("Ctrl+3");
    await assertMode(app, "split");
    await app.eval(`window.__mdtiger.workspace.activate(${JSON.stringify(ids[0])})`);
    await assertMode(app, "source");
  });

  it("4. switching modes keeps the position: a heading in the middle stays at the top", async () => {
    const app = await start({ files: [fixture("showcase.md")] });
    await app.waitFor(`document.querySelectorAll('#pane-rendered h2').length > 5`);
    const target = '#pane-rendered [id="4-tables"]';
    const from = await app.eval(`+document.querySelector(${JSON.stringify(target)}).dataset.from`);
    // Scroll the rendered pane so the heading is at the top.
    await app.eval(`(() => { const p = document.querySelector('#pane-rendered .rendered-pane'); const h = document.querySelector(${JSON.stringify(target)}); p.scrollTop += h.getBoundingClientRect().top - p.getBoundingClientRect().top - 4; })()`);
    await sleep(200);
    assert.ok(await app.eval(`document.querySelector('#pane-rendered .rendered-pane').scrollTop`) > 200, "the pane really scrolled");
    await app.key("Ctrl+2");
    await assertMode(app, "source");
    // The heading's line is within the top 20 % of the editor.
    const frac = () =>
      app.eval(`(() => { const v = ${view}; const c = v.coordsAtPos(${from}); const r = v.scrollDOM.getBoundingClientRect(); return c ? (c.top - r.top) / r.height : null; })()`);
    await app.waitFor(`(() => { const v = ${view}; const c = v.coordsAtPos(${from}); const r = v.scrollDOM.getBoundingClientRect(); return c && (c.top - r.top) / r.height <= 0.2 && (c.top - r.top) >= -4; })()`, 5000);
    const f1 = await frac();
    assert.ok(f1 >= -0.01 && f1 <= 0.2, `source: heading at ${f1}`);
    // And back to Rendered: the heading is at the top again.
    await app.key("Ctrl+1");
    await assertMode(app, "rendered");
    await app.waitFor(`(() => { const p = document.querySelector('#pane-rendered .rendered-pane'); const h = document.querySelector(${JSON.stringify(target)}); const t = (h.getBoundingClientRect().top - p.getBoundingClientRect().top) / p.getBoundingClientRect().height; return t >= -0.01 && t <= 0.2; })()`, 5000);
    // Source to Split keeps it too.
    await app.key("Ctrl+2");
    await app.key("Ctrl+3");
    await assertMode(app, "split");
    await app.waitFor(`(() => { const p = document.querySelector('#pane-rendered .rendered-pane'); const h = document.querySelector(${JSON.stringify(target)}); const t = (h.getBoundingClientRect().top - p.getBoundingClientRect().top) / p.getBoundingClientRect().height; return t >= -0.01 && t <= 0.2; })()`, 5000);
  });

  it("5. Split: typing updates the rendered side within 1 s, and scrolling either side moves the other", async () => {
    const app = await start({ files: [fixture("showcase.md")] });
    await app.key("Ctrl+3");
    await assertMode(app, "split");
    // Typing in the source.
    await app.eval(`(() => { const v = ${view}; v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); })()`);
    await app.type("\n\nTYPEDMARKER here");
    await app.waitFor(`document.querySelector('#pane-rendered .rendered-doc').textContent.includes('TYPEDMARKER here')`, 1000);
    // Source drives rendered.
    await app.eval(`(() => { const s = ${view}.scrollDOM; s.scrollTop = s.scrollHeight * 0.45; })()`);
    await app.waitFor(`(() => { const t = ${renderedTopBlock}; const e = ${editorTop}; return t && t.from - 3 <= e && e <= t.to; })()`, 3000);
    const r1 = await app.eval(`document.querySelector('#pane-rendered .rendered-pane').scrollTop`);
    assert.ok(r1 > 100, `rendered side moved (${r1})`);
    // Rendered drives source.
    await app.eval(`(() => { const p = document.querySelector('#pane-rendered .rendered-pane'); p.scrollTop = 0; })()`);
    await app.waitFor(`${view}.scrollDOM.scrollTop < 20`, 3000);
    await app.eval(`(() => { const p = document.querySelector('#pane-rendered .rendered-pane'); p.scrollTop = p.scrollHeight * 0.6; })()`);
    await app.waitFor(`(() => { const t = ${renderedTopBlock}; const e = ${editorTop}; return t && t.from - 3 <= e && e <= t.to; })()`, 3000);
    assert.ok((await app.eval(`${view}.scrollDOM.scrollTop`)) > 100, "source side moved");
    // Dragging the divider changes the ratio (and the setting).
    const before = await app.eval(`document.getElementById('pane-source').getBoundingClientRect().width`);
    await app.drag("#split-divider", "#workarea", { toEdge: "right" });
    await sleep(200);
    const after = await app.eval(`document.getElementById('pane-source').getBoundingClientRect().width`);
    assert.ok(after > before + 50, `divider moved: ${before} -> ${after}`);
    const ratio = await app.eval(`window.__mdtiger.settings.get('split.ratio')`);
    assert.ok(ratio > 0.5 && ratio <= 0.85, `ratio ${ratio}`);
  });

  it("6. malformed tables from tables.md render as tables", async () => {
    const app = await start({ files: [fixture("tables.md")] });
    await app.waitFor(`document.querySelectorAll('#pane-rendered table').length > 0`);
    assert.equal(await app.eval(`document.querySelectorAll('#pane-rendered table').length`), 3);
    // Ragged rows are padded or cut to the header.
    const cells = await app.eval(`[...document.querySelectorAll('#pane-rendered table')[1].querySelectorAll('tbody tr')].map((r) => r.children.length)`);
    assert.deepEqual(cells, [2, 2, 2]);
    // The wide table scrolls inside its wrapper and does not widen the page.
    const wide = await app.eval(`(() => { const w = document.querySelectorAll('#pane-rendered .table-wrap')[2]; return { scroll: w.scrollWidth > w.clientWidth, page: document.documentElement.scrollWidth <= document.documentElement.clientWidth }; })()`);
    assert.equal(wide.scroll, true, "the wrapper scrolls");
    assert.equal(wide.page, true, "the page does not");
  });

  it("7. sanitising in the real app: nothing runs, no dialog, no error in the log", async () => {
    const xss = [
      "# XSS",
      "",
      "<script>window.__pwned = 'script'</script>",
      "",
      '<img src="x" onerror="window.__pwned = \'onerror\'">',
      "",
      '<a href="javascript:window.__pwned=\'link\'" id="jslink">click</a>',
      "",
      "[md](javascript:window.__pwned='md')",
      "",
      '<iframe src="https://evil.example/" id="frame"></iframe>',
      "",
      '<svg onload="window.__pwned = \'svg\'"><circle r="1"/></svg>',
      "",
      "Inline <b onmouseover=\"window.__pwned='hover'\">bold</b> end.",
      "",
      "After.",
      "",
    ].join("\n");
    const app = await start({ files: [tmpDoc("xss.md", xss)] });
    await app.waitFor(`document.querySelector('#pane-rendered .rendered-doc').textContent.includes('After.')`);
    await sleep(500); // an img onerror would have fired by now
    assert.equal(await app.eval(`typeof window.__pwned`), "undefined");
    const html = await app.eval(`document.querySelector('#pane-rendered .rendered-doc').innerHTML`);
    assert.ok(!/<script|onerror|onload|onmouseover|javascript:|<iframe/i.test(html), html);
    assert.equal(await app.eval(`document.getElementById('frame')`), null);
    assert.equal(await app.eval(`!!document.getElementById('dialog')`), false);
    // Clicking a link does not navigate the window.
    await app.eval(`window.__marker = 1`);
    await app.click("#pane-rendered a");
    await sleep(300);
    assert.equal(await app.eval(`window.__marker`), 1, "the page did not navigate");
    assert.ok(!/ERROR/.test(app.log()), app.log());
  });

  it("8. Split mode on the 2 MB document: typing p90 < 50 ms, the rendered side catches up within 2 s", async () => {
    if (!existsSync(join(ROOT, "tests", "fixtures", "big.md"))) execFileSync("node", [join(ROOT, "tools", "make-big.mjs")], { stdio: "ignore" });
    const app = await start({ files: [fixture("big.md")] });
    await app.key("Ctrl+3");
    await assertMode(app, "split");
    // The first render of a 2 MB document is a full one: wait for it.
    const t0 = Date.now();
    await app.waitFor(`${rendered}.upToDate`, 60000);
    console.log(`      first full render (2 MB): ${Date.now() - t0} ms after the mode switch, ${await app.eval(`${rendered}.stats.lastMs | 0`)} ms of rendering`);
    // Put the caret into the middle of the document, at the start of a paragraph.
    await app.eval(`(() => {
      const v = ${view};
      const t = v.state.doc.toString();
      let at = t.indexOf('This document exercises', Math.floor(t.length / 2));
      v.focus();
      v.dispatch({ selection: { anchor: at }, effects: v.constructor.scrollIntoView(at, { y: 'center' }) });
    })()`);
    await sleep(1500);
    await app.eval(`(() => {
      window.__lat = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'keydown') window.__lat.push(e.duration); }).observe({ type: 'event', durationThreshold: 16 });
    })()`);
    const before = await app.eval(`${view}.state.doc.length`);
    for (let i = 0; i < 200; i++) {
      await app.type("a");
      await sleep(25);
    }
    const stopped = Date.now();
    assert.equal(await app.eval(`${view}.state.doc.length`), before + 200);
    await app.waitFor(`document.querySelector('#pane-rendered .rendered-doc').textContent.includes('a'.repeat(200) + 'This document exercises')`, 2000);
    const caughtUp = Date.now() - stopped;
    const slow = await app.eval(`window.__lat`);
    const all = [...slow.sort((a, b) => a - b)];
    while (all.length < 200) all.unshift(0);
    const p90 = all[Math.floor(200 * 0.9)];
    const stats = await app.eval(`${rendered}.stats`);
    console.log(`      typing latency: p90 ${p90} ms, max ${all[199]} ms; rendered side caught up ${caughtUp} ms after the last key; renders: ${JSON.stringify(stats)}`);
    assert.ok(p90 < 50, `p90 ${p90} ms`);
    assert.ok(stats.incremental >= 1, "edits were rendered incrementally");
  });

  it("9. a killed renderer keeps each tab's mode", async () => {
    const files = [fixture("showcase.md"), fixture("tables.md")];
    const app = await start({ files });
    const ids = await app.eval(`window.__mdtiger.docs.map((d) => d.id)`);
    await app.eval(`window.__mdtiger.workspace.activate(${JSON.stringify(ids[0])})`);
    await app.key("Ctrl+3");
    await assertMode(app, "split");
    await app.eval(`window.__mdtiger.workspace.activate(${JSON.stringify(ids[1])})`);
    await app.key("Ctrl+2");
    await assertMode(app, "source");
    await sleep(500);
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
    await app.waitFor(`document.getElementById('workarea') && !document.getElementById('workarea').hidden`);
    await assertMode(app, "source"); // the active tab (tables.md)
    await app.eval(`window.__mdtiger.workspace.activate(${JSON.stringify(ids[0])})`);
    await assertMode(app, "split");
  });

  it("10. the Content Security Policy is in force", async () => {
    const app = await start({ files: [fixture("plain.md")] });
    // An inline script is refused, a handler attribute too.
    const r = await app.eval(`(async () => {
      const violations = [];
      document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective));
      const s = document.createElement('script');
      s.textContent = 'window.__inline = 1';
      document.head.append(s);
      const d = document.createElement('div');
      d.innerHTML = '<img src="x" onerror="window.__handler = 1">';
      document.body.append(d);
      await new Promise((r) => setTimeout(r, 400));
      return { inline: typeof window.__inline, handler: typeof window.__handler, violations };
    })()`);
    assert.equal(r.inline, "undefined");
    assert.equal(r.handler, "undefined");
    assert.ok(r.violations.some((v) => v.startsWith("script-src")), JSON.stringify(r.violations));
  });
});
