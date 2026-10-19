// Content script entry. Runs on every YouTube page and attaches the tools to
// the playlist page and the watch page's playlist panel as they appear.
// YouTube is a single-page app, so this re-checks on navigation and on a
// slow interval rather than assuming a fresh page load.

import { PanelTools } from "./panel-tools";
import { PlaylistTools } from "./playlist-tools";
import { findPlaylistList, findPlaylistPanel } from "./yt-dom";

declare global {
  interface Window {
    __y3s?: { playlist: PlaylistTools | null; panel: PanelTools | null };
  }
}

function main(): void {
  if (window.__y3s) return;
  const state: { playlist: PlaylistTools | null; panel: PanelTools | null } = { playlist: null, panel: null };
  window.__y3s = state;

  const tick = () => {
    try {
      const list = location.pathname === "/playlist" ? findPlaylistList() : null;
      if (state.playlist && (state.playlist.list !== list || !state.playlist.bar.isConnected)) {
        state.playlist.destroy();
        state.playlist = null;
      }
      if (!state.playlist && list) state.playlist = new PlaylistTools(list);
      state.playlist?.checkPlaylistId();

      const panel = location.pathname === "/watch" ? findPlaylistPanel() : null;
      if (state.panel && (state.panel.panel !== panel || !state.panel.bar.isConnected)) {
        state.panel.destroy();
        state.panel = null;
      }
      if (!state.panel && panel) state.panel = new PanelTools(panel);
    } catch (err) {
      console.warn("[y3s]", err);
    }
  };

  window.addEventListener(
    "keydown",
    (e) => {
      if (state.playlist && location.pathname === "/playlist") state.playlist.onKey(e);
    },
    true,
  );
  window.addEventListener("yt-navigate-start", () => state.playlist?.flushOnLeave());
  window.addEventListener("yt-navigate-finish", () => setTimeout(tick, 50));
  window.addEventListener("pagehide", () => {
    state.playlist?.flushOnLeave();
    state.playlist?.persistNow();
  });
  setInterval(tick, 1000);
  tick();
}

main();
