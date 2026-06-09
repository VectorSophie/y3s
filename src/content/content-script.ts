// Content script entry. Detects supported playlist pages, injects exactly one
// overlay root, and keeps it in sync with YouTube's SPA navigation.

import { ROOT_ELEMENT_ID } from "../shared/constants";
import type { Command } from "../shared/messages";
import { currentPlaylistId, onUrlChange } from "./page-detect";
import { OverlayRoot } from "./overlay-root";

// Guard against double injection (e.g. script run twice on bfcache restore).
declare global {
  interface Window {
    __y3sInjected?: boolean;
  }
}

function main(): void {
  if (window.__y3sInjected || document.getElementById(ROOT_ELEMENT_ID)) return;
  window.__y3sInjected = true;

  let overlay: OverlayRoot | null = null;

  const sync = () => {
    const playlistId = currentPlaylistId();
    if (playlistId) {
      if (!overlay) overlay = new OverlayRoot();
      overlay.show();
      void overlay.setPlaylist(playlistId);
    } else {
      // Not a supported playlist page — hide the rail/drawer if present.
      overlay?.hide();
    }
  };

  sync();
  onUrlChange(sync);

  // Toolbar action button → open/toggle the drawer.
  chrome.runtime.onMessage.addListener((msg: Command) => {
    if (msg.type === "TOGGLE_DRAWER") {
      if (!overlay && currentPlaylistId()) {
        overlay = new OverlayRoot();
        void overlay.setPlaylist(currentPlaylistId()!);
      }
      overlay?.toggle();
    }
  });
}

main();
