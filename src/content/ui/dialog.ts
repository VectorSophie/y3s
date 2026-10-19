// Modal dialogs styled like YouTube's: the keyboard-shortcuts sheet and a
// confirm for large saves.

import { h, icon, ICONS } from "./dom";

export const isDialogOpen = () => !!document.querySelector(".y3s-dialog-backdrop");

function modal(label: string, body: (close: () => void) => Node[], onClose?: () => void): () => void {
  const prev = document.activeElement as HTMLElement | null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    bd.remove();
    prev?.focus?.();
    onClose?.();
  };
  const dialog = h("div", { class: "y3s-dialog", role: "dialog", "aria-modal": "true", "aria-label": label });
  const bd = h(
    "div",
    {
      class: "y3s-dialog-backdrop",
      onclick: (e: Event) => {
        if (e.target === bd) close();
      },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      },
    },
    dialog,
  );
  dialog.append(...body(close));
  document.body.append(bd);
  (dialog.querySelector("[data-autofocus]") as HTMLElement | null)?.focus() ??
    (dialog.querySelector("button") as HTMLElement | null)?.focus();
  return close;
}

export const SHORTCUTS: [string[], string][] = [
  [["j"], "Next video"],
  [["k"], "Previous video"],
  [["Shift", "j / k"], "Extend selection"],
  [["x"], "Select or deselect"],
  [["Enter"], "Play"],
  [["/"], "Filter this playlist"],
  [["g"], "First video"],
  [["Shift", "g"], "Last video"],
  [["t"], "Move selection to top"],
  [["b"], "Move selection to bottom"],
  [["Delete"], "Remove selection"],
  [["p"], "New phase: split at the selection, or gather a scattered one"],
  [["c"], "Collapse the focused video's phase"],
  [["Shift", "c"], "Collapse or expand all phases"],
  [["z"], "Undo"],
  [["Esc"], "Clear filter or selection"],
  [["?"], "Show keyboard shortcuts"],
];

export function openHelp(): void {
  if (isDialogOpen()) return;
  modal("Keyboard shortcuts", (close) => [
    h(
      "div",
      { class: "y3s-dialog-head" },
      h("h2", { text: "Keyboard shortcuts" }),
      h("button", { class: "y3s-icon-btn", "aria-label": "Close", onclick: close }, icon(ICONS.close)),
    ),
    h("p", { class: "y3s-dialog-text", text: "Drag across videos with the left mouse button to select them. Hold Ctrl or Shift to add to the selection." }),
    h(
      "div",
      { class: "y3s-sc-list" },
      SHORTCUTS.map(([keys, desc]) =>
        h(
          "div",
          { class: "y3s-sc-row" },
          h("span", { text: desc }),
          h(
            "span",
            { class: "y3s-sc-keys" },
            keys.map((k, i) => [i ? h("span", { class: "y3s-plus", text: "+" }) : null, h("kbd", { text: k })]),
          ),
        ),
      ),
    ),
  ]);
}

export interface ConfirmOptions {
  title: string;
  body: string[];
  confirm: string;
  cancel: string;
}

/** Resolves true on confirm, false on cancel / Esc / backdrop. */
export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v: boolean, close: () => void) => {
      answered = true;
      resolve(v);
      close();
    };
    modal(
      o.title,
      (close) => [
        h("div", { class: "y3s-dialog-head" }, h("h2", { text: o.title })),
        ...o.body.map((p) => h("p", { class: "y3s-dialog-text", text: p })),
        h(
          "div",
          { class: "y3s-dialog-actions" },
          h("button", { class: "y3s-btn y3s-btn-plain", text: o.cancel, onclick: () => answer(false, close) }),
          h("button", {
            class: "y3s-btn y3s-btn-primary",
            text: o.confirm,
            "data-autofocus": true,
            onclick: () => answer(true, close),
          }),
        ),
      ],
      () => {
        if (!answered) resolve(false);
      },
    );
  });
}
