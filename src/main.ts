// Bootstrap only: pick the host, load settings, build the layout, wire the
// workspace, report ready.

import "./styles/base.css";
import { commands } from "./core/commands";
import { installLogging, log } from "./core/log";
import { isMarkdownPath, fileName } from "./core/paths";
import { SettingsStore } from "./core/settings";
import { Workspace, type CloseChoice } from "./core/workspace";
import { SourceFindBackend } from "./editor/find";
import { detectHost } from "./host";
import type { HostEvent } from "./host/host";
import { redo, undo } from "@codemirror/commands";
import { showDialog, isDialogOpen } from "./ui/dialog";
import { mountFindBar } from "./ui/findBar";
import { mountGotoLine } from "./ui/gotoLine";
import { buildLayout } from "./ui/layout";
import { createMenu } from "./ui/menu";
import { mountTabs } from "./ui/tabs";
import { mountViews } from "./ui/views";

async function main(): Promise<void> {
  const host = await detectHost();
  installLogging(host);

  const settings = new SettingsStore(host);
  await settings.load();

  const layout = buildLayout(document.getElementById("app")!, settings);
  const testMode = await host.testMode();
  const overrides = testMode ? { nextPickPath: null as string[] | null, nextSavePath: null as string | null } : undefined;

  const ws = new Workspace({
    host,
    drafts: { get: (k) => host.draftGet(k), set: (k, v) => host.draftSet(k, v), remove: (k) => host.draftRemove(k) },
    session: sessionStorage,
    hint: (t) => layout.setStatus(t),
    notify: (t) => layout.notify(t),
    overrides,
    editorOptions: () => ({ lineNumbers: settings.get("editor.lineNumbers"), livePreview: settings.get("experimental.livePreview") }),
    async confirmClose(doc, othersDirty): Promise<CloseChoice> {
      const buttons: { id: CloseChoice; label: string; primary?: boolean }[] = [{ id: "save", label: "Save", primary: true }];
      if (othersDirty > 0) buttons.push({ id: "saveAll", label: "Save all" });
      buttons.push({ id: "discard", label: "Don't save" }, { id: "cancel", label: "Cancel" });
      return showDialog<CloseChoice>({
        title: "Unsaved changes",
        message: `Save changes to ${doc.title}?`,
        buttons,
        cancelId: "cancel",
      });
    },
  });

  mountTabs(layout.tabs, ws);
  mountViews(layout, ws, host);

  // ---- commands (a dialog freezes them all: they are disabled while it shows)
  const idle = () => !isDialogOpen();
  const hasDoc = () => idle() && !!ws.active;
  commands.register({ id: "file.new", label: "New", shortcut: "Mod-n", enabled: idle, run: () => void ws.newDoc() });
  commands.register({ id: "file.open", label: "Open…", shortcut: "Mod-o", enabled: idle, run: () => ws.openDialog() });
  commands.register({ id: "file.save", label: "Save", shortcut: "Mod-s", enabled: hasDoc, run: async () => void (await ws.save()) });
  commands.register({ id: "file.saveAs", label: "Save as…", shortcut: "Mod-Shift-s", enabled: hasDoc, run: async () => void (await ws.saveAs()) });
  commands.register({ id: "tab.close", label: "Close tab", shortcut: "Mod-w", altShortcuts: ["Mod-F4"], enabled: hasDoc, run: () => void ws.closeActive() });
  commands.register({ id: "tab.closeAll", label: "Close all tabs", enabled: hasDoc, run: () => void ws.closeAll() });
  commands.register({ id: "tab.closeOthers", label: "Close other tabs", enabled: () => idle() && ws.docs.length > 1, run: () => void ws.closeOthers() });
  const multi = () => idle() && ws.docs.length > 1;
  commands.register({ id: "tab.next", label: "Next tab", shortcut: "Mod-Tab", altShortcuts: ["Mod-PageDown"], enabled: multi, run: () => ws.cycle(1) });
  commands.register({ id: "tab.prev", label: "Previous tab", shortcut: "Mod-Shift-Tab", altShortcuts: ["Mod-PageUp"], enabled: multi, run: () => ws.cycle(-1) });
  // ---- editing: find, replace, go to line, undo/redo (S03)
  const activeView = () => ws.active?.view ?? null;
  const goto = mountGotoLine(layout.dock, activeView, () => find.close(false));
  const find = mountFindBar(layout.dock, {
    backend: new SourceFindBackend(activeView),
    selectedText() {
      const v = activeView();
      if (!v) return null;
      const { from, to } = v.state.selection.main;
      if (from === to || to - from > 300) return null;
      const text = v.state.sliceDoc(from, to);
      return text.includes(String.fromCharCode(10)) || text.includes(String.fromCharCode(13)) ? null : text;
    },
    focusEditor: () => activeView()?.focus(),
    setStatus: (t) => layout.setStatus(t),
    onOpen: () => goto.close(false),
  });
  let lastActive: string | null = null;
  ws.onChange(() => {
    if (ws.activeId === lastActive) return;
    lastActive = ws.activeId;
    goto.close(false);
    if (ws.active) find.retarget();
    else find.close(false);
  });
  commands.register({ id: "find.open", label: "Find", shortcut: "Mod-f", enabled: hasDoc, run: () => find.open() });
  commands.register({ id: "find.replace", label: "Replace", shortcut: "Mod-h", enabled: hasDoc, run: () => find.open({ replace: true }) });
  commands.register({ id: "find.next", label: "Find next", shortcut: "F3", enabled: hasDoc, run: () => find.next() });
  commands.register({ id: "find.prev", label: "Find previous", shortcut: "Shift-F3", enabled: hasDoc, run: () => find.prev() });
  commands.register({ id: "edit.goToLine", label: "Go to line", shortcut: "Mod-g", enabled: hasDoc, run: () => goto.open() });
  // No shortcuts on undo/redo: CodeMirror owns Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z while the
  // editor has focus, and a global shortcut would hijack them in the find bar's own fields.
  commands.register({ id: "edit.undo", label: "Undo", enabled: hasDoc, run: () => { const v = activeView(); if (v) { undo(v); v.focus(); } } });
  commands.register({ id: "edit.redo", label: "Redo", enabled: hasDoc, run: () => { const v = activeView(); if (v) { redo(v); v.focus(); } } });
  commands.register({
    id: "app.about",
    label: "About MdTiger",
    shortcut: "F1",
    run: () => layout.setStatus(`MdTiger ${__APP_VERSION__}`),
  });
  commands.attach(document);

  createMenu(layout.toolbar, commands, [
    { command: "file.new" },
    { command: "file.open" },
    { command: "file.save", separator: true },
    { command: "file.saveAs" },
    { command: "tab.close", separator: true },
    { command: "tab.closeOthers" },
    { command: "tab.closeAll" },
    { command: "app.about", separator: true },
  ], { id: "app-menu", label: "Menu" });

  // ---- host events: second instance, drag and drop, window close
  const handleHostEvent = (e: HostEvent) => {
    log.info(`host event: ${e.type} ${e.path}`);
    // A file named by another launch is opened as asked; a dropped one must be Markdown.
    if (e.type === "open" || isMarkdownPath(e.path)) void ws.open(e.path);
    else layout.setStatus(`Not a Markdown file: ${fileName(e.path)}`);
  };
  host.onEvent(handleHostEvent);
  host.onCloseRequest(async () => {
    const ok = await ws.confirmWindowClose();
    if (ok) for (const d of ws.docs) ws.flushDraft(d); // nothing pending is lost
    return ok;
  });

  // Don't lose a pending setting change or draft when the window goes away.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void settings.flush();
      for (const d of ws.docs) if (d.draftTimer) ws.flushDraft(d);
    }
  });

  // Handle for the end-to-end tests and the developer console.
  const handle: Record<string, unknown> = {
    host,
    settings,
    commands,
    layout,
    workspace: ws,
    get docs() {
      return ws.snapshot();
    },
  };
  if (testMode) {
    handle.testHooks = overrides;
    // Simulates a host event (a drop or a second instance) without the OS.
    handle.emitHostEvent = handleHostEvent;
  }
  (window as unknown as { __mdtiger: unknown }).__mdtiger = handle;

  // ---- what to open: the tabs of this page's previous life (renderer
  // restart), else the command-line files; the last one is active.
  if (!(await ws.restoreSession())) {
    await ws.openMany(await host.initialFiles());
  }

  // "Ready" = first frame painted: two animation frames.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => host.ready({ msSinceNavigation: performance.now() })),
  );
}

main().catch((e) => {
  log.error(`startup failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
});
