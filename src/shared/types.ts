// Core data models shared by the content script and the service worker.

/** A single playlist entry as the YouTube Data API reports it. */
export interface Track {
  /** The playlistItem resource id, used for delete/update. Distinct from videoId. */
  playlistItemId: string;
  videoId: string;
  title: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  durationText?: string;
  /** 0-based position within the playlist. */
  position: number;
  url: string;
}

/** A point-in-time snapshot of a playlist's items, in playlist order. */
export interface PlaylistSnapshot {
  playlistId: string;
  title?: string;
  items: Track[];
  fetchedAt: number;
}

/** What the signed-in user may do with a playlist. */
export interface PlaylistAccess {
  title: string;
  owned: boolean;
}

/** One write against the YouTube Data API. */
export type Change =
  | { kind: "delete"; playlistItemId: string; videoId: string }
  | { kind: "move"; playlistItemId: string; videoId: string; position: number };

export interface ApplyResult {
  /** How many changes succeeded, in order, before stopping. */
  applied: number;
  error?: ApiError;
}

/** Stable error codes so the UI can show specific, friendly messages. */
export type ApiErrorCode =
  | "AUTH_NOT_CONFIGURED"
  | "NOT_SIGNED_IN"
  | "AUTH_DENIED"
  | "QUOTA_EXCEEDED"
  | "NOT_OWNER"
  | "NOT_SORTABLE"
  | "NOT_FOUND"
  | "NETWORK"
  | "UPDATE_FAILED"
  | "UNKNOWN";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  /** Raw status / detail for debugging, never shown raw to the user. */
  detail?: string;
}

/** Uniform envelope returned by every background message handler. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };
