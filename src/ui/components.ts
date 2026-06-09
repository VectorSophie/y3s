// Small DOM toolkit: an `h` element helper, inline SVG icons, and a reusable
// confirmation modal. No framework — plain DOM, scoped inside the shadow root.

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

/** Hyperscript-ish element builder. `on*` keys attach listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "class") {
      el.className = String(value);
    } else if (key === "html") {
      el.innerHTML = String(value);
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Inline icons as SVG strings (16px, currentColor stroke). */
const ICONS: Record<string, string> = {
  search: `<circle cx="7" cy="7" r="5"/><path d="M11 11l4 4"/>`,
  close: `<path d="M4 4l8 8M12 4l-8 8"/>`,
  trash: `<path d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5 4l1 9h4l1-9"/>`,
  plus: `<path d="M8 3v10M3 8h10"/>`,
  chevron: `<path d="M5 6l3 3 3-3"/>`,
  check: `<path d="M3 8l3 3 7-7"/>`,
  sort: `<path d="M4 5h8M4 8h5M4 11h3"/>`,
  top: `<path d="M8 13V4M4 7l4-3 4 3"/>`,
  bottom: `<path d="M8 3v9M4 9l4 3 4-3"/>`,
  logo: `<rect x="2" y="2" width="12" height="12" rx="3" fill="none"/><path d="M5 11l6-6"/>`,
  layers: `<path d="M8 2l6 3-6 3-6-3 6-3zM2 8l6 3 6-3M2 11l6 3 6-3"/>`,
  link: `<path d="M6 10a3 3 0 0 0 4 0l2-2a3 3 0 0 0-4-4M10 6a3 3 0 0 0-4 0L4 8a3 3 0 0 0 4 4"/>`,
};

export function icon(name: keyof typeof ICONS | string, size = 16): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.classList.add("pf-icon");
  svg.innerHTML = ICONS[name] ?? "";
  return svg;
}

export interface ConfirmOptions {
  title: string;
  body: Node | string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * Show a modal inside `mount` and resolve true/false. Esc / backdrop = cancel.
 */
export function confirmModal(mount: HTMLElement, opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (result: boolean) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(false);
      } else if (e.key === "Enter") {
        e.stopPropagation();
        close(true);
      }
    };

    const confirmBtn = h(
      "button",
      {
        class: `pf-btn ${opts.danger ? "pf-btn--danger" : "pf-btn--primary"}`,
        onClick: () => close(true),
      },
      opts.confirmLabel ?? "Confirm",
    );

    const backdrop = h(
      "div",
      { class: "pf-modal-backdrop", onClick: (e: Event) => e.target === backdrop && close(false) },
      h(
        "div",
        { class: "pf-modal", role: "dialog", "aria-modal": "true" },
        h("div", { class: "pf-modal__title" }, opts.title),
        h("div", { class: "pf-modal__body" }, opts.body),
        h(
          "div",
          { class: "pf-modal__actions" },
          h("button", { class: "pf-btn pf-btn--ghost", onClick: () => close(false) }, opts.cancelLabel ?? "Cancel"),
          confirmBtn,
        ),
      ),
    );

    mount.append(backdrop);
    document.addEventListener("keydown", onKey, true);
    confirmBtn.focus();
  });
}
