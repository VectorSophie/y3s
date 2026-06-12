// The slim sticky toolbar (Shadow-DOM hosted). Callback-driven; no state.

export type ExportFormat = "json" | "csv" | "md";
export type ExportTarget = "copy" | "download";

export interface ToolbarCallbacks {
  onSearch: (q: string) => void;
  onJumpDup: () => void;
  onDelete: () => void;
  onOpenTabs: () => void;
  onExport: (format: ExportFormat, target: ExportTarget) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}

export class QolToolbar {
  readonly el: HTMLElement;
  private runtime: HTMLElement;
  private dup: HTMLElement;
  private selBtnDelete: HTMLButtonElement;
  private selBtnTabs: HTMLButtonElement;
  private input: HTMLInputElement;

  constructor(cb: ToolbarCallbacks) {
    this.input = el("input", {
      class: "q-search",
      type: "search",
      placeholder: "Filter this playlist…  ( / )",
    }) as HTMLInputElement;
    this.input.addEventListener("input", () => cb.onSearch(this.input.value));

    this.runtime = el("span", { class: "q-badge" });
    this.dup = el("span", { class: "q-dup", hidden: "true", title: "Jump to next duplicate" });
    this.dup.addEventListener("click", () => cb.onJumpDup());

    this.selBtnTabs = el("button", { class: "q-btn", disabled: "true" }, "Open in tabs") as HTMLButtonElement;
    this.selBtnTabs.addEventListener("click", () => cb.onOpenTabs());
    this.selBtnDelete = el("button", { class: "q-btn q-btn--danger", disabled: "true" }, "Delete") as HTMLButtonElement;
    this.selBtnDelete.addEventListener("click", () => cb.onDelete());

    const exportBtn = el("button", { class: "q-btn" }, "Export ▾") as HTMLButtonElement;
    const menu = el("div", { class: "q-menu" });
    const opt = (label: string, f: ExportFormat, t: ExportTarget) => {
      const b = el("button", {}, label);
      b.addEventListener("click", () => {
        menu.classList.remove("open");
        cb.onExport(f, t);
      });
      return b;
    };
    menu.append(
      opt("Copy JSON", "json", "copy"),
      opt("Copy CSV", "csv", "copy"),
      opt("Copy Markdown", "md", "copy"),
      opt("Download JSON", "json", "download"),
      opt("Download CSV", "csv", "download"),
      opt("Download Markdown", "md", "download"),
    );
    exportBtn.addEventListener("click", () => menu.classList.toggle("open"));
    const exportWrap = el("div", { class: "q-wrap" }, exportBtn, menu);

    this.el = el(
      "div",
      { class: "q-bar" },
      this.input,
      this.runtime,
      this.dup,
      el("span", { class: "q-spacer" }),
      this.selBtnTabs,
      this.selBtnDelete,
      exportWrap,
    );
  }

  focusSearch(): void {
    this.input.focus();
    this.input.select();
  }
  getSearch(): string {
    return this.input.value;
  }

  setRuntime(loadedSec: number, loaded: number, total: number, fmt: (s: number) => string): void {
    this.runtime.innerHTML = `<b>${fmt(loadedSec)}</b> · ${loaded}${total > loaded ? ` of ${total}` : ""} videos`;
  }
  setDupCount(n: number): void {
    this.dup.textContent = n > 0 ? `${n} duplicate${n === 1 ? "" : "s"}` : "";
    this.dup.toggleAttribute("hidden", n === 0);
  }
  setSelectedCount(n: number): void {
    const label = n > 0 ? ` (${n})` : "";
    this.selBtnDelete.textContent = `Delete${label}`;
    this.selBtnTabs.textContent = `Open in tabs${label}`;
    this.selBtnDelete.disabled = n === 0;
    this.selBtnTabs.disabled = n === 0;
  }
}
