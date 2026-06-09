// Owns the single injected root: a Shadow-DOM host containing the open rail and
// the drawer. Instantiates the stores and wires data loading per playlist.

import { ROOT_ELEMENT_ID } from "../shared/constants";
import { PhaseStore } from "../state/phase-store";
import { PlaylistStore } from "../state/playlist-store";
import { SelectionStore } from "../state/selection-store";
import { Drawer } from "../ui/drawer";
import { h, icon } from "../ui/components";
// CSS is bundled as a string (esbuild text loader) and injected into the shadow root.
import styles from "../styles/content.css";

export class OverlayRoot {
  private hostEl: HTMLElement;
  private overlay: HTMLElement;
  private rail: HTMLButtonElement;
  private drawer: Drawer;
  private playlist = new PlaylistStore();
  private selection = new SelectionStore();
  private phases = new PhaseStore();
  private currentPlaylistId: string | null = null;

  constructor() {
    this.hostEl = document.createElement("div");
    this.hostEl.id = ROOT_ELEMENT_ID;
    // Keep the host out of YouTube's layout; the shadow tree positions itself.
    this.hostEl.style.cssText = "all: initial; position: fixed; z-index: 2147483000;";

    const shadow = this.hostEl.attachShadow({ mode: "open" });
    shadow.append(h("style", { html: styles }));

    this.overlay = h("div", { class: "pf-overlay" });
    this.rail = h(
      "button",
      { class: "pf-rail", title: "Open y3s playlist editor", onClick: () => this.toggle() },
      icon("logo", 18),
      h("span", { class: "pf-rail__label" }, "y3s"),
    ) as HTMLButtonElement;

    this.drawer = new Drawer(this.overlay, this.playlist, this.selection, this.phases);

    this.overlay.append(this.rail, this.drawer.host);
    shadow.append(this.overlay);
    document.documentElement.append(this.hostEl);
  }

  /** Point the overlay at a playlist, loading its phases + items. */
  async setPlaylist(playlistId: string): Promise<void> {
    if (playlistId === this.currentPlaylistId) return;
    this.currentPlaylistId = playlistId;
    this.selection.clear();
    await this.phases.load(playlistId);
    await this.playlist.load(playlistId);
  }

  toggle(): void {
    this.drawer.toggle();
  }
  openDrawer(): void {
    this.drawer.setOpen(true);
  }

  show(): void {
    this.hostEl.style.display = "";
  }
  hide(): void {
    this.drawer.close();
    this.hostEl.style.display = "none";
  }

  destroy(): void {
    this.drawer.destroy();
    this.hostEl.remove();
  }
}
