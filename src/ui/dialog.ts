// In-app modal dialog (themed and testable, unlike a native message box).
// Used only when the user must decide something (NFR-11): errors never use it.

export interface DialogButton<T extends string> {
  id: T;
  label: string;
  primary?: boolean;
}

export interface DialogOptions<T extends string> {
  title: string;
  message: string;
  buttons: DialogButton<T>[];
  /** Result for Escape. */
  cancelId: T;
}

let open = 0;

/** True while a dialog is showing: commands and shortcuts should stand still. */
export function isDialogOpen(): boolean {
  return open > 0;
}

/** Shows the dialog and resolves with the id of the chosen button. */
export function showDialog<T extends string>(opts: DialogOptions<T>): Promise<T> {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overlay = document.createElement("div");
    overlay.id = "dialog-overlay";
    const box = document.createElement("div");
    box.id = "dialog";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "dialog-title");
    const title = document.createElement("h2");
    title.id = "dialog-title";
    title.textContent = opts.title;
    const message = document.createElement("p");
    message.id = "dialog-message";
    message.textContent = opts.message;
    const row = document.createElement("div");
    row.id = "dialog-buttons";
    const buttons: HTMLButtonElement[] = [];

    const finish = (id: T) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      open--;
      previousFocus?.focus?.();
      resolve(id);
    };
    for (const b of opts.buttons) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = `dialog-${b.id}`;
      btn.textContent = b.label;
      if (b.primary) btn.className = "primary";
      btn.addEventListener("click", () => finish(b.id));
      row.append(btn);
      buttons.push(btn);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(opts.cancelId);
      } else if (e.key === "Tab") {
        // Keep focus inside the dialog.
        e.preventDefault();
        e.stopPropagation();
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = (i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next].focus();
      } else if (e.ctrlKey || e.metaKey) {
        // The app's own shortcuts must not act behind the dialog.
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKey, true);

    box.append(title, message, row);
    overlay.append(box);
    document.body.append(overlay);
    open++;
    (buttons.find((_, i) => opts.buttons[i].primary) ?? buttons[0])?.focus();
  });
}
