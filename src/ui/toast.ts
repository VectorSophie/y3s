// Toast notifications, stacked bottom of the drawer. Auto-dismiss with a
// manual close affordance.

import { h, icon } from "./components";

export type ToastKind = "info" | "success" | "error";

export class Toast {
  private container: HTMLElement;

  constructor(mount: HTMLElement) {
    this.container = h("div", { class: "pf-toasts" });
    mount.append(this.container);
  }

  show(message: string, kind: ToastKind = "info", durationMs = 4000): void {
    const el = h(
      "div",
      { class: `pf-toast pf-toast--${kind}`, role: "status" },
      h("span", { class: "pf-toast__msg" }, message),
      h(
        "button",
        { class: "pf-toast__close", "aria-label": "Dismiss", onClick: () => remove() },
        icon("close", 12),
      ),
    );
    const remove = () => {
      el.classList.add("pf-toast--out");
      setTimeout(() => el.remove(), 180);
    };
    this.container.append(el);
    if (durationMs > 0) setTimeout(remove, durationMs);
  }

  success(message: string): void {
    this.show(message, "success");
  }
  error(message: string): void {
    this.show(message, "error", 6000);
  }
}
