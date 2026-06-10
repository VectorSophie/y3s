// Builds the Shadow-DOM panel and wires it to a Mount. Replaces overlay-root.
// No rail, no floating drawer — the panel lives inside the playlist column.

import { PhaseStore } from "../state/phase-store";
import { PlaylistStore } from "../state/playlist-store";
import { SelectionStore } from "../state/selection-store";
import { Panel } from "../ui/panel";
import { h } from "../ui/components";
import { scrapeTracks } from "./youtube-scrape";
import { createMount, type Mount } from "./mount-point";
// CSS is bundled as a string (esbuild text loader) and injected into the shadow root.
import styles from "../styles/content.css";

export class PanelRoot {
  private mount: Mount;
  private overlay: HTMLElement;
  private panel: Panel;
  private playlist = new PlaylistStore();
  private selection = new SelectionStore();
  private phases = new PhaseStore();
  private currentPlaylistId: string | null = null;

  constructor() {
    this.mount = createMount();
    const shadow = this.mount.host.attachShadow({ mode: "open" });
    shadow.append(h("style", { html: styles }));

    this.overlay = h("div", { class: "pf-overlay" });
    this.panel = new Panel(this.overlay, this.playlist, this.selection, this.phases);
    this.panel.onShowOriginal = () => this.mount.showOriginal(true);

    this.overlay.append(this.panel.el);
    shadow.append(this.overlay);
  }

  /** Point the panel at a playlist, loading its phases then hybrid items. */
  async setPlaylist(playlistId: string): Promise<void> {
    if (playlistId === this.currentPlaylistId) return;
    this.currentPlaylistId = playlistId;
    this.selection.clear();
    await this.phases.load(playlistId);
    await this.playlist.loadHybrid(playlistId, () => scrapeTracks(playlistId));
  }

  destroy(): void {
    this.panel.destroy();
    this.mount.destroy();
  }
}
