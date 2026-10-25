// Content script entry. Runs on every YouTube page and attaches the tools to
// the playlist page and the watch page's playlist panel as they appear.
// YouTube is a single-page app, so this re-checks on navigation and on a
// slow interval rather than assuming a fresh page load.

import { PlaylistsPageFilter, SaveSheetFilter } from "./extras";
import { openPageCheck } from "./page-check";
import { PanelTools } from "./panel-tools";
import { loadPlay, miniplayerActive, miniplayerPlaylist, PhasePlayer, savePlay } from "./phase-player";
import { PlaylistTools } from "./playlist-tools";
import { findPlaylistList, findPlaylistPanel, site } from "./yt-dom";
import type { Command } from "../shared/messages";

declare global {
  interface Window {
    __y3s?: {
      playlist: PlaylistTools | null;
      panel: PanelTools | null;
      player: PhasePlayer | null;
      grid: PlaylistsPageFilter | null;
    };
  }
}

function main(): void {
  if (window.__y3s) return;
  const state: NonNullable<Window["__y3s"]> = { playlist: null, panel: null, player: null, grid: null };
  const sheet = new SaveSheetFilter();
  if (site() === "music") document.documentElement.classList.add("y3s-music");
  chrome.runtime.onMessage.addListener((msg: Command) => {
    if (msg?.type === "PAGE_CHECK") void openPageCheck();
  });
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

      const grid = PlaylistsPageFilter.find();
      if (state.grid && (state.grid.grid !== grid || !state.grid.bar.isConnected)) {
        state.grid.destroy();
        state.grid = null;
      }
      if (!state.grid && grid) state.grid = new PlaylistsPageFilter(grid);

      // Phase playback follows the tab while it stays on that playlist.
      const play = loadPlay();
      // On the watch page it follows the address; in the miniplayer (while you
      // browse other pages) it follows the miniplayer's playlist.
      const listId =
        location.pathname === "/watch"
          ? new URLSearchParams(location.search).get("list")
          : miniplayerActive()
            ? miniplayerPlaylist()
            : null;
      const onIt = !!play && listId === play.playlistId;
      // A phase started from the watch panel replaces the one playing.
      if (state.player && (!onIt || state.player.state.startedAt !== play?.startedAt)) {
        state.player.destroy();
        state.player = null;
      }
      if (onIt) {
        state.player ??= new PhasePlayer(play!);
        state.player.tick();
      } else if (play && site() === "music" && location.pathname !== "/watch") {
        // YouTube Music keeps playing in its bottom bar while you browse;
        // pick phase playback up again when the player page is back.
      } else if (play && Date.now() - play.startedAt > 15000) {
        savePlay(null); // left the playlist: playback is over
      }
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
  window.addEventListener("popstate", () => setTimeout(tick, 50));
  // Reloading or closing with a big unsaved batch: let the browser ask first.
  window.addEventListener("beforeunload", (e) => {
    if (state.playlist?.needsLeaveWarning()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("pagehide", () => {
    state.playlist?.flushOnLeave();
    state.playlist?.persistNow();
  });
  setInterval(tick, 1000);
  tick();

  // Popups like "Save to playlist" open at any moment: check on DOM changes,
  // at most once per frame.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      try {
        sheet.check();
      } catch (err) {
        console.warn("[y3s]", err);
      }
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
}

main();
