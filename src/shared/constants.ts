// App-wide constants and design/quota tokens.

export const APP_ID = "y3s";
export const ROOT_ELEMENT_ID = "y3s-root";

/** YouTube Data API v3 base. */
export const API_BASE = "https://www.googleapis.com/youtube/v3";

/** Quota cost per operation, in API units (see docs/research-notes.md). */
export const QUOTA_COST = {
  list: 1,
  delete: 50,
  update: 50,
  insert: 50,
} as const;

/** Max items YouTube returns per playlistItems.list page. */
export const PAGE_SIZE = 50;

/** chrome.storage.local key helpers. */
export const storageKeys = {
  phases: (playlistId: string) => `y3s:phases:${playlistId}`,
  prefs: () => "y3s:prefs",
};

/** Default phase colors (subtle, theme-aligned). */
export const PHASE_COLORS = [
  "#e0344b",
  "#e6a23c",
  "#3fb27f",
  "#4a8cff",
  "#9d6bdd",
  "#d96aa8",
];

/** A move/sort over this many writes is flagged "high" risk in the planner. */
export const HIGH_RISK_WRITE_THRESHOLD = 25;
