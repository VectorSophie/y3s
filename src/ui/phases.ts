// Phase command surface: create / rename / delete dialogs and the "assign
// selected to phase" popover. Wraps PhaseStore and reports via Toast.

import type { PhaseStore } from "../state/phase-store";
import { count } from "../shared/utils";
import { confirmModal, h, icon } from "./components";
import type { Toast } from "./toast";

export class PhaseController {
  constructor(
    private mount: HTMLElement,
    private store: PhaseStore,
    private toast: Toast,
  ) {}

  async createAndAssign(videoIds: string[]): Promise<void> {
    const title = await this.promptText({ title: "New phase", placeholder: "Phase name" });
    if (title == null) return;
    const phase = await this.store.create(title);
    if (videoIds.length) {
      await this.store.assign(phase.id, videoIds);
      this.toast.success(`Created “${phase.title}” with ${count(videoIds.length, "track")}.`);
    } else {
      this.toast.success(`Created phase “${phase.title}”.`);
    }
  }

  async rename(phaseId: string): Promise<void> {
    const current = this.store.list().find((p) => p.id === phaseId);
    if (!current) return;
    const title = await this.promptText({ title: "Rename phase", value: current.title });
    if (title == null) return;
    await this.store.rename(phaseId, title);
  }

  async delete(phaseId: string): Promise<void> {
    const phase = this.store.list().find((p) => p.id === phaseId);
    if (!phase) return;
    const ok = await confirmModal(this.mount, {
      title: "Delete phase?",
      body: `“${phase.title}” will be removed. Its ${count(
        phase.trackVideoIds?.length ?? 0,
        "track",
      )} will move back to Unphased. The videos themselves are not deleted.`,
      confirmLabel: "Delete phase",
      danger: true,
    });
    if (ok) {
      await this.store.remove(phaseId);
      this.toast.show("Phase deleted.");
    }
  }

  /** Open a popover near `anchor` to assign the selected videos to a phase. */
  openAssignMenu(anchor: HTMLElement, videoIds: string[]): void {
    const existing = this.mount.querySelector(".pf-menu");
    existing?.remove();
    if (videoIds.length === 0) {
      this.toast.show("Select some tracks first.");
      return;
    }

    const close = () => {
      menu.remove();
      document.removeEventListener("mousedown", onAway, true);
    };
    const onAway = (e: Event) => {
      if (!menu.contains(e.target as Node)) close();
    };

    const phaseItems = this.store.list().map((p) =>
      h(
        "button",
        {
          class: "pf-menu__item",
          onClick: async () => {
            close();
            await this.store.assign(p.id, videoIds);
            this.toast.success(`Added ${count(videoIds.length, "track")} to “${p.title}”.`);
          },
        },
        h("span", { class: "pf-phase__dot", style: `background:${p.color}` }),
        p.title,
      ),
    );

    const menu = h(
      "div",
      { class: "pf-menu", role: "menu" },
      h("div", { class: "pf-menu__label" }, `Assign ${count(videoIds.length, "track")}`),
      ...phaseItems,
      this.store.list().length ? h("div", { class: "pf-menu__sep" }) : null,
      h(
        "button",
        {
          class: "pf-menu__item",
          onClick: async () => {
            close();
            await this.createAndAssign(videoIds);
          },
        },
        icon("plus"),
        "New phase…",
      ),
      h(
        "button",
        {
          class: "pf-menu__item",
          onClick: async () => {
            close();
            await this.store.unassign(videoIds);
            this.toast.show("Removed from phases.");
          },
        },
        icon("close"),
        "Remove from phase",
      ),
    );

    const r = anchor.getBoundingClientRect();
    Object.assign(menu.style, {
      position: "fixed",
      bottom: `${window.innerHeight - r.top + 8}px`,
      right: `${window.innerWidth - r.right}px`,
    });
    this.mount.append(menu);
    setTimeout(() => document.addEventListener("mousedown", onAway, true), 0);
  }

  /** Minimal text prompt modal returning the trimmed value or null on cancel. */
  private promptText(opts: {
    title: string;
    value?: string;
    placeholder?: string;
  }): Promise<string | null> {
    return new Promise((resolve) => {
      const input = h("input", {
        class: "pf-input",
        type: "text",
        value: opts.value ?? "",
        placeholder: opts.placeholder ?? "",
      }) as HTMLInputElement;

      const done = (val: string | null) => {
        backdrop.remove();
        resolve(val);
      };

      const backdrop = h(
        "div",
        { class: "pf-modal-backdrop", onClick: (e: Event) => e.target === backdrop && done(null) },
        h(
          "div",
          { class: "pf-modal" },
          h("div", { class: "pf-modal__title" }, opts.title),
          h("div", { class: "pf-modal__body" }, input),
          h(
            "div",
            { class: "pf-modal__actions" },
            h("button", { class: "pf-btn pf-btn--ghost", onClick: () => done(null) }, "Cancel"),
            h(
              "button",
              { class: "pf-btn pf-btn--primary", onClick: () => done(input.value.trim() || null) },
              "Save",
            ),
          ),
        ),
      );

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") done(input.value.trim() || null);
        if (e.key === "Escape") {
          e.stopPropagation();
          done(null);
        }
      });

      this.mount.append(backdrop);
      input.focus();
      input.select();
    });
  }
}
