// App-wide constants.

declare const __Y3S_API_BASE__: string | undefined;

/** YouTube Data API v3 base. Test builds point this at a local fake server. */
export const API_BASE =
  typeof __Y3S_API_BASE__ === "string" && __Y3S_API_BASE__
    ? __Y3S_API_BASE__
    : "https://www.googleapis.com/youtube/v3";

/** Quota cost per call, in API units. */
export const QUOTA_COST = { list: 1, delete: 50, update: 50, insert: 50 } as const;

/** Default daily quota for a Google Cloud project. */
export const DAILY_QUOTA = 10_000;

/** Max items YouTube returns per playlistItems.list page. */
export const PAGE_SIZE = 50;

/** How long an edit stays undoable before it is saved to YouTube. */
export const SAVE_DELAY_MS = 6000;

/** Batches with more writes than this ask before saving. */
export const CONFIRM_WRITES_OVER = 20;

/** watch_videos accepts up to this many ids. */
export const MAX_QUEUE_IDS = 50;
