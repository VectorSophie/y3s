// Finds YouTube's playlist content column, injects the panel host as its first
// child, and hides the native list while ours is shown. A "Show original"
// toggle flips back. Selectors are isolated here; a fallback host is used if
// the column can't be found so we never silently no-op.

import { ROOT_ELEMENT_ID } from "../shared/constants";

// Candidate containers for the main playlist video list, most-specific first.
const COLUMN_SELECTORS = [
  "ytd-playlist-video-list-renderer",
  "ytd-item-section-renderer #contents.ytd-item-section-renderer",
  "ytd-section-list-renderer #contents",
];

export interface Mount {
  host: HTMLElement;
  /** True when attached to a real column; false when using the fixed fallback. */
  attached: boolean;
  showOriginal: (show: boolean) => void;
  destroy: () => void;
}

function findColumn(): HTMLElement | null {
  for (const sel of COLUMN_SELECTORS) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) return el;
  }
  return null;
}

/**
 * Create the panel host inside the playlist column (or a fixed fallback).
 * Returns the host element + controls. Does NOT build UI — caller attaches a
 * shadow root to `host`.
 */
export function createMount(opts: { hideNative?: boolean } = {}): Mount {
  const hideNative = opts.hideNative ?? true;
  // Never double-mount.
  const existing = document.getElementById(ROOT_ELEMENT_ID);
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = ROOT_ELEMENT_ID;

  const column = findColumn();
  let nativeList: HTMLElement | null = null;
  let attached = false;

  if (column) {
    attached = true;
    nativeList = column;
    host.style.cssText = "display:block; width:100%;";
    column.parentElement?.insertBefore(host, column);
  } else {
    // Fallback: a fixed card so the user sees something went wrong, not nothing.
    host.style.cssText =
      "position:fixed; top:80px; right:16px; width:380px; z-index:2147483000;";
    document.documentElement.append(host);
  }

  const showOriginal = (show: boolean) => {
    if (nativeList) nativeList.style.display = show ? "" : "none";
    host.style.display = show ? "none" : "block";
  };
  // Hide the native list only when asked (v0.2 panel does; v0.3 QoL layer doesn't).
  if (attached && hideNative) showOriginal(false);

  return {
    host,
    attached,
    showOriginal,
    destroy: () => {
      if (nativeList) nativeList.style.display = "";
      host.remove();
    },
  };
}
