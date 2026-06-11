// Focus-ring keyboard navigation over the visible native rows. Scoped to the
// document but inert while typing in an input/textarea/contenteditable.

export interface KeyboardNavHandlers {
  /** Visible (non-hidden) rows in display order, for j/k/g/G + Enter/x/y. */
  visibleRows: () => HTMLElement[];
  /** Our own shadow host — events originating inside it (toolbar input, modal)
   *  are ignored so typing in our search box never triggers navigation. */
  ownRoot: HTMLElement;
  focusSearch: () => void;
  onOpen: (row: HTMLElement) => void;
  onToggleSelect: (row: HTMLElement) => void;
  onCopyLink: (row: HTMLElement) => void;
  setFocused: (row: HTMLElement | null) => void;
}

export function bindKeyboardNav(handlers: KeyboardNavHandlers): () => void {
  let focusedIndex = -1;

  const clamp = (i: number, len: number) => Math.max(0, Math.min(i, len - 1));

  const move = (delta: number | "top" | "bottom") => {
    const rows = handlers.visibleRows();
    if (rows.length === 0) return;
    if (delta === "top") focusedIndex = 0;
    else if (delta === "bottom") focusedIndex = rows.length - 1;
    else focusedIndex = clamp((focusedIndex < 0 ? 0 : focusedIndex) + delta, rows.length);
    const row = rows[focusedIndex];
    handlers.setFocused(row);
    row.scrollIntoView({ block: "nearest" });
  };

  const current = (): HTMLElement | null => {
    const rows = handlers.visibleRows();
    return focusedIndex >= 0 && focusedIndex < rows.length ? rows[focusedIndex] : null;
  };

  const onKey = (e: KeyboardEvent) => {
    const path = e.composedPath();
    // Ignore anything from our own shadow UI (toolbar input, export menu, modal).
    if (path.includes(handlers.ownRoot)) return;
    // composedPath()[0] is the true target even across shadow boundaries.
    const real = path[0] as HTMLElement | undefined;
    if (real && (real.tagName === "INPUT" || real.tagName === "TEXTAREA" || real.isContentEditable)) {
      return;
    }
    switch (e.key) {
      case "j": e.preventDefault(); move(1); break;
      case "k": e.preventDefault(); move(-1); break;
      case "g": e.preventDefault(); move("top"); break;
      case "G": e.preventDefault(); move("bottom"); break;
      case "/": e.preventDefault(); handlers.focusSearch(); break;
      case "Enter": { const r = current(); if (r) { e.preventDefault(); handlers.onOpen(r); } break; }
      case "x": { const r = current(); if (r) { e.preventDefault(); handlers.onToggleSelect(r); } break; }
      case "y": { const r = current(); if (r) { e.preventDefault(); handlers.onCopyLink(r); } break; }
    }
  };

  document.addEventListener("keydown", onKey, true);
  return () => document.removeEventListener("keydown", onKey, true);
}
