// Content script entry. Loads on every YouTube page (the manifest matches
// www.youtube.com/*) and decides per-URL whether to inject the overlay, so it
// survives YouTube's SPA navigation — Chrome only injects content scripts on
// real document loads, not History-API navigations.

import { ROOT_ELEMENT_ID } from "../shared/constants";
import type { Command } from "../shared/messages";
import { currentPlaylistId, onUrlChange } from "./page-detect";
import { OverlayRoot } from "./overlay-root";

const TAG = "[y3s]";

declare global {
  interface Window {
    __y3sInjected?: boolean;
  }
}

function main(): void {
  if (window.__y3sInjected || document.getElementById(ROOT_ELEMENT_ID)) {
    console.info(TAG, "already injected, skipping");
    return;
  }
  window.__y3sInjected = true;
  console.info(
    TAG,
    `content script injected (v${chrome.runtime.getManifest().version})`,
    location.href,
  );

  let overlay: OverlayRoot | null = null;

  const sync = () => {
    try {
      const playlistId = currentPlaylistId();
      if (playlistId) {
        if (!overlay) {
          overlay = new OverlayRoot();
          console.info(TAG, "overlay mounted for playlist", playlistId);
        }
        overlay.show();
        void overlay.setPlaylist(playlistId);
      } else {
        overlay?.hide();
      }
    } catch (err) {
      console.error(TAG, "sync() failed — overlay could not mount:", err);
    }
  };

  sync();
  onUrlChange((url) => {
    console.debug(TAG, "navigation:", url);
    sync();
  });

  // Toolbar action button → open/toggle the drawer.
  chrome.runtime.onMessage.addListener((msg: Command) => {
    if (msg.type !== "TOGGLE_DRAWER") return;
    try {
      const id = currentPlaylistId();
      if (!overlay && id) {
        overlay = new OverlayRoot();
        void overlay.setPlaylist(id);
      }
      overlay?.toggle();
    } catch (err) {
      console.error(TAG, "toggle failed:", err);
    }
  });
}

try {
  main();
} catch (err) {
  console.error(TAG, "fatal init error:", err);
}
