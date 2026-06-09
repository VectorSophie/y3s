// Lightweight reads from the YouTube page DOM. Used ONLY for page context
// (e.g. a title fallback before the API responds) — never as the source of
// truth for edits.

/** Best-effort playlist title from the page, used while the API loads. */
export function playlistTitleFromDom(): string | undefined {
  const selectors = [
    "ytd-playlist-header-renderer yt-dynamic-sizing-formatted-string",
    "ytd-playlist-header-renderer .metadata-wrapper yt-formatted-string#title",
    "#title yt-formatted-string",
    "h1.title yt-formatted-string",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return undefined;
}
