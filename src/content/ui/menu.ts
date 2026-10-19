// Popup menu styled like YouTube's ⋮ / sort menus.

import { h, icon, ICONS } from "./dom";

export type MenuItem =
  | { label: string; checked?: boolean; disabled?: boolean; run: () => void }
  | { sep: true }
  | { heading: string };

let menuEl: HTMLElement | null = null;
let menuAnchor: HTMLElement | null = null;

export const isMenuOpen = () => !!menuEl;

export function closeMenu(): void {
  menuEl?.remove();
  menuEl = null;
  menuAnchor = null;
  document.removeEventListener("pointerdown", onDocDown, true);
}

function onDocDown(e: Event): void {
  const t = e.target as Node;
  if (menuEl && !menuEl.contains(t) && !menuAnchor?.contains(t)) closeMenu();
}

export function toggleMenu(anchor: HTMLElement, items: MenuItem[]): void {
  if (menuAnchor === anchor) return closeMenu();
  closeMenu();
  const checks = items.some((it) => "label" in it && it.checked !== undefined);
  const buttons: HTMLButtonElement[] = [];
  const nodes = items.map((it) => {
    if ("sep" in it) return h("div", { class: "y3s-menu-sep", role: "separator" });
    if ("heading" in it) return h("div", { class: "y3s-menu-heading", text: it.heading });
    const b = h(
      "button",
      {
        class: "y3s-menu-item",
        role: checks ? "menuitemradio" : "menuitem",
        "aria-checked": checks ? String(!!it.checked) : null,
        disabled: it.disabled,
        onclick: () => {
          closeMenu();
          anchor.focus();
          it.run();
        },
      },
      checks ? (it.checked ? icon(ICONS.check) : h("span", { class: "y3s-icon-spacer" })) : null,
      h("span", { text: it.label }),
    );
    if (!it.disabled) buttons.push(b);
    return b;
  });
  const menu = h("div", { class: "y3s-menu", role: "menu" }, nodes);
  menu.addEventListener("keydown", (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") buttons[(i + 1) % buttons.length]?.focus();
    else if (e.key === "ArrowUp") buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    else if (e.key === "Escape" || e.key === "Tab") {
      closeMenu();
      anchor.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8))}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
  menuEl = menu;
  menuAnchor = anchor;
  document.addEventListener("pointerdown", onDocDown, true);
  (buttons.find((b) => b.getAttribute("aria-checked") === "true") ?? buttons[0])?.focus();
}
