// Content script entry. Loads on every YouTube page; on a /playlist URL it
// mounts the in-place panel and runs the hybrid load. Survives SPA navigation.

import type { Command } from "../shared/messages";
import { ROOT_ELEMENT_ID } from "../shared/constants";
import { currentPlaylistId, onUrlChange } from "./page-detect";
import { QolRoot } from "./qol-root";

const TAG = "[y3s]";

declare global {
  interface Window {
    __y3sInjected?: boolean;
  }
}

function isPlaylistPage(): boolean {
  return location.pathname === "/playlist" && currentPlaylistId() !== null;
}

function main(): void {
  if (window.__y3sInjected) return;
  window.__y3sInjected = true;
  console.info(
    TAG,
    `content script injected (v${chrome.runtime.getManifest().version})`,
    location.href,
  );

  let root: QolRoot | null = null;

  const sync = () => {
    try {
      if (isPlaylistPage()) {
        if (!root) {
          root = new QolRoot();
          console.info(TAG, "QoL layer mounted for", currentPlaylistId());
        }
        root.setPlaylist(currentPlaylistId()!);
      } else if (root) {
        root.destroy();
        root = null;
      }
    } catch (err) {
      console.error(TAG, "sync() failed:", err);
    }
  };

  sync();
  onUrlChange((url) => {
    console.debug(TAG, "navigation:", url);
    sync();
  });

  // Toolbar action button → scroll the panel into view if present.
  chrome.runtime.onMessage.addListener((msg: Command) => {
    if (msg.type === "TOGGLE_DRAWER") {
      document
        .getElementById(ROOT_ELEMENT_ID)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

try {
  main();
} catch (err) {
  console.error(TAG, "fatal init error:", err);
}
