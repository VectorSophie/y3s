// Keyboard shortcuts, active only while the drawer is open and focus is inside
// it. Bound to the drawer root so they don't leak into the YouTube page.

export interface ShortcutHandlers {
  clearOrClose: () => void; // Escape
  selectAll: () => void; // Ctrl/Cmd+A
  focusSearch: () => void; // /
  requestDelete: () => void; // Delete / Backspace
  createPhase: () => void; // P
  openSort: () => void; // S
}

/** Attach shortcuts to a root element. Returns a detach function. */
export function bindShortcuts(root: HTMLElement, handlers: ShortcutHandlers): () => void {
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const typing =
      target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

    // Escape always works (also from inputs) to clear/close.
    if (e.key === "Escape") {
      handlers.clearOrClose();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      handlers.selectAll();
      return;
    }

    // The rest are single-key shortcuts; ignore them while typing.
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case "/":
        e.preventDefault();
        handlers.focusSearch();
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        handlers.requestDelete();
        break;
      case "p":
      case "P":
        handlers.createPhase();
        break;
      case "s":
      case "S":
        handlers.openSort();
        break;
    }
  };

  root.addEventListener("keydown", onKey);
  return () => root.removeEventListener("keydown", onKey);
}
