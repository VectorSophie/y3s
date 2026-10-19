// Small shared helpers. No DOM, no chrome APIs — safe in both contexts.

import type { ApiError, ApiErrorCode } from "./types";

/** Build a typed ApiError. */
export function apiError(
  code: ApiErrorCode,
  message: string,
  detail?: string,
): ApiError {
  return { code, message, detail };
}

/** Friendly default messages keyed by error code. */
export const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  AUTH_NOT_CONFIGURED:
    "Google sign-in isn't set up for this build. See the README to add an OAuth client ID.",
  NOT_SIGNED_IN: "Sign in to save changes to your playlists.",
  AUTH_DENIED: "Sign-in was cancelled or denied.",
  QUOTA_EXCEEDED: "YouTube API daily quota exceeded. Try again tomorrow.",
  NOT_OWNER: "You don't own this playlist, so it can't be edited.",
  NOT_SORTABLE:
    "This playlist isn't sorted manually on YouTube, so its order can't be changed.",
  NOT_FOUND: "That playlist couldn't be found.",
  NETWORK: "Network error talking to YouTube. Check your connection.",
  UPDATE_FAILED: "YouTube rejected the change.",
  UNKNOWN: "Something went wrong.",
};

export function messageForError(error: ApiError): string {
  return error.message || ERROR_MESSAGES[error.code] || ERROR_MESSAGES.UNKNOWN;
}

/** Case/diacritic-insensitive substring match for client-side search. */
export function fuzzyIncludes(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return normalize(haystack).includes(normalize(needle));
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

/** Parse the playlist id from a YouTube URL, if present. */
export function playlistIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const isPlaylist = u.pathname === "/playlist";
    const isWatch = u.pathname === "/watch";
    if (!isPlaylist && !isWatch) return null;
    const list = u.searchParams.get("list");
    if (!list) return null;
    // Auto-generated mixes (RD…) and the watch-later/likes pseudo-lists aren't
    // real editable playlists; ignore them.
    if (/^(RD|UL|LL|WL)/.test(list)) return null;
    return list;
  } catch {
    return null;
  }
}

/** Pluralise: `count(1,"track")` → "1 track", `count(3,"track")` → "3 tracks". */
export function count(n: number, noun: string, plural = noun + "s"): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

/** Format ISO 8601 duration (PT1H2M3S) to a compact label (1:02:03). */
export function formatDuration(iso?: string): string | undefined {
  if (!iso) return undefined;
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return undefined;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const sec = Number(m[3] || 0);
  const pad = (x: number) => x.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(min)}:${pad(sec)}` : `${min}:${pad(sec)}`;
}

/** Parse a "M:SS" or "H:MM:SS" duration label into seconds. */
export function parseDurationText(s?: string): number | undefined {
  if (!s) return undefined;
  const parts = s.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  if (!parts.every((p) => /^\d+$/.test(p))) return undefined;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

/** Format a number of seconds as "M:SS" or "H:MM:SS". */
export function formatSeconds(total: number): string {
  const t = Math.max(0, Math.floor(total));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (x: number) => x.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Run async tasks sequentially, collecting each result. Used for ordered,
 *  rate-friendly API writes. */
export async function runSequential<I, O>(
  items: I[],
  task: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  const out: O[] = [];
  for (let i = 0; i < items.length; i++) {
    out.push(await task(items[i], i));
  }
  return out;
}
