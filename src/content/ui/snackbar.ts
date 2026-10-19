// Bottom-left message with an optional action, like YouTube's own
// "Removed from Watch later · Undo".

import { h } from "./dom";

export interface SnackAction {
  label: string;
  run: () => void;
}

let el: HTMLElement | null = null;
let timer = 0;

export function showSnack(message: string, action?: SnackAction, ms = 6000): void {
  if (!el || !el.isConnected) {
    el = h("div", { class: "y3s-snackbar", role: "status", "aria-live": "polite" });
    document.body.append(el);
  }
  const text = h("span", { class: "y3s-snackbar-text", text: message });
  el.replaceChildren(text);
  if (action)
    el.append(
      h("button", {
          class: "y3s-snackbar-action",
          text: action.label,
          onclick: () => {
            hideSnack();
            action.run();
          },
        }),
    );
  void el.offsetWidth; // restart the slide-in
  el.classList.add("y3s-open");
  clearTimeout(timer);
  if (ms > 0) timer = window.setTimeout(hideSnack, ms);
}

export function hideSnack(): void {
  clearTimeout(timer);
  el?.classList.remove("y3s-open");
}

export function snackText(): string {
  return el?.classList.contains("y3s-open") ? (el.textContent ?? "") : "";
}
