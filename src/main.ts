// Bootstrap only: pick the host, load settings, build the layout, report ready.

import "./styles/base.css";
import { commands } from "./core/commands";
import { installLogging, log } from "./core/log";
import { SettingsStore } from "./core/settings";
import { detectHost } from "./host";
import { buildLayout } from "./ui/layout";

async function main(): Promise<void> {
  const host = await detectHost();
  installLogging(host);

  const settings = new SettingsStore(host);
  await settings.load();

  const layout = buildLayout(document.getElementById("app")!, settings);
  layout.showEmptyState(true);

  commands.register({
    id: "app.about",
    label: "About MdTiger",
    shortcut: "F1",
    run: () => layout.setStatus(`MdTiger ${__APP_VERSION__}`),
  });
  commands.attach(document);

  host.onEvent((e) => log.info(`host event: ${e.type} ${e.path}`));

  // Don't lose a pending setting change when the window goes away.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void settings.flush();
  });

  // Handle for the end-to-end tests and the developer console.
  (window as unknown as { __mdtiger: unknown }).__mdtiger = { host, settings, commands, layout };

  // "Ready" = first frame painted: two animation frames.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => host.ready({ msSinceNavigation: performance.now() })),
  );
}

main().catch((e) => {
  log.error(`startup failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
});
