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
  // Focus the marked control, else the first button. (Not `a?.focus() ?? b`:
  // focus() returns undefined, so that would always move on to the button.)
  const auto = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>("button");
  auto?.focus();
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

export interface PickItem {
  id: string;
  label: string;
  meta?: string;
}

/** A searchable list to pick one item from (like YouTube's "Save to…" sheet). */
export function pickDialog(o: { title: string; items: PickItem[]; placeholder: string; empty: string }): Promise<string | null> {
  return new Promise((resolve) => {
    let picked: string | null = null;
    modal(
      o.title,
      (close) => {
        const list = h("div", { class: "y3s-pick-list", role: "listbox", "aria-label": o.title });
        const buttons = o.items.map((it) =>
          h(
            "button",
            {
              class: "y3s-pick-item",
              role: "option",
              "data-label": it.label.toLowerCase(),
              onclick: () => {
                picked = it.id;
                close();
              },
            },
            h("span", { class: "y3s-pick-label", text: it.label }),
            it.meta ? h("span", { class: "y3s-pick-meta", text: it.meta }) : null,
          ),
        );
        const none = h("p", { class: "y3s-dialog-text", text: o.empty, hidden: buttons.length > 0 });
        list.append(...buttons);
        const input = h("input", {
          class: "y3s-pick-search",
          type: "text",
          placeholder: o.placeholder,
          "aria-label": o.placeholder,
          "data-autofocus": true,
          oninput: () => {
            const q = input.value.trim().toLowerCase();
            let n = 0;
            for (const b of buttons) {
              const ok = !q || (b.dataset.label ?? "").includes(q);
              b.hidden = !ok;
              if (ok) n++;
            }
            none.hidden = n > 0;
          },
          onkeydown: (e: KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === "Enter") buttons.find((b) => !b.hidden)?.click();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              buttons.find((b) => !b.hidden)?.focus();
            } else if (e.key === "Escape") close();
          },
        });
        list.addEventListener("keydown", (e) => {
          const vis = buttons.filter((b) => !b.hidden);
          const i = vis.indexOf(document.activeElement as HTMLButtonElement);
          if (e.key === "ArrowDown") vis[Math.min(vis.length - 1, i + 1)]?.focus();
          else if (e.key === "ArrowUp") (i <= 0 ? input : vis[i - 1]).focus();
          else return;
          e.preventDefault();
        });
        return [
          h(
            "div",
            { class: "y3s-dialog-head" },
            h("h2", { text: o.title }),
            h("button", { class: "y3s-icon-btn", "aria-label": "Close", onclick: close }, icon(ICONS.close)),
          ),
          input,
          list,
          none,
        ];
      },
      () => resolve(picked),
    );
  });
}
