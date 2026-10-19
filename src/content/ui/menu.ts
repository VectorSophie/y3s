// Popup menu styled like YouTube's ⋮ / sort menus.

import { h, icon, ICONS } from "./dom";

export interface MenuItem {
  label: string;
  checked?: boolean;
  run: () => void;
}

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
  const buttons = items.map((it) =>
    h(
      "button",
      {
        class: "y3s-menu-item",
        role: "menuitemradio",
        "aria-checked": String(!!it.checked),
        onclick: () => {
          closeMenu();
          anchor.focus();
          it.run();
        },
      },
      it.checked ? icon(ICONS.check) : h("span", { class: "y3s-icon-spacer" }),
      h("span", { text: it.label }),
    ),
  );
  const menu = h("div", { class: "y3s-menu", role: "menu" }, buttons);
  menu.addEventListener("keydown", (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") buttons[(i + 1) % buttons.length].focus();
    else if (e.key === "ArrowUp") buttons[(i - 1 + buttons.length) % buttons.length].focus();
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
