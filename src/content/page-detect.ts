// Detects whether we're on a supported playlist page and notifies on YouTube's
// SPA navigation (which changes the URL without a full reload).

import { playlistIdFromUrl } from "../shared/utils";

export function currentPlaylistId(): string | null {
  return playlistIdFromUrl(location.href);
}

/**
 * Call `cb` whenever the effective URL changes. Hooks YouTube's own
 * `yt-navigate-finish` event plus History API patches, with a polling
 * fallback for safety.
 */
export function onUrlChange(cb: (url: string) => void): () => void {
  let lastUrl = location.href;
  const fire = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      cb(lastUrl);
    }
  };

  const onYtNavigate = () => setTimeout(fire, 0);
  document.addEventListener("yt-navigate-finish", onYtNavigate);
  window.addEventListener("popstate", fire);

  // Patch pushState/replaceState so we catch programmatic navigation.
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) {
    const r = origPush.apply(this, args as Parameters<typeof origPush>);
    fire();
    return r;
  };
  history.replaceState = function (...args) {
    const r = origReplace.apply(this, args as Parameters<typeof origReplace>);
    fire();
    return r;
  };

  // Belt-and-suspenders polling for edge cases YouTube doesn't announce.
  const poll = window.setInterval(fire, 1000);

  return () => {
    document.removeEventListener("yt-navigate-finish", onYtNavigate);
    window.removeEventListener("popstate", fire);
    history.pushState = origPush;
    history.replaceState = origReplace;
    clearInterval(poll);
  };
}
