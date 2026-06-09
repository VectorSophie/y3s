// Core data models for y3s. Shared between content script and service worker.

/** A single playlist entry, normalised from the YouTube API. */
export interface Track {
  /** The playlistItem resource id — used for delete/update. Distinct from videoId. */
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

/** A point-in-time snapshot of a playlist's items. */
export interface PlaylistSnapshot {
  playlistId: string;
  title?: string;
  items: Track[];
  fetchedAt: number;
  /** True when the data is the local mock fixture, not the real API. */
  isMock?: boolean;
}

/** Extension-only subsection metadata. YouTube playlists are flat; phases live
 *  only in chrome.storage.local. */
export interface Phase {
  id: string;
  playlistId: string;
  title: string;
  color?: string;
  /** Optional anchor: the phase begins before this videoId. */
  beforeVideoId?: string;
  /** Tracks assigned to this phase, by videoId. */
  trackVideoIds?: string[];
  collapsed?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Runtime-only selection. Not persisted. */
export interface SelectionState {
  selectedVideoIds: Set<string>;
  lastSelectedIndex?: number;
}

export type OperationType = "sort" | "move" | "delete" | "phaseOnly";

/** A single concrete API-level action within a plan. */
export interface Operation {
  kind: "delete" | "updatePosition" | "insert";
  playlistItemId?: string;
  videoId?: string;
  /** Target position for move/sort operations. */
  toPosition?: number;
  /** Human label for the confirmation summary. */
  label: string;
}

/** A planned, costed set of operations, produced before anything is applied. */
export interface OperationPlan {
  id: string;
  type: OperationType;
  description: string;
  estimatedApiCalls: number;
  estimatedQuotaCost: number;
  /** "none" for local-only, up through "high" for full re-sorts. */
  riskLevel: "none" | "low" | "medium" | "high";
  affectedVideoIds: string[];
  operations: Operation[];
}

/** Result of applying one operation. */
export interface OperationResult {
  videoId?: string;
  playlistItemId?: string;
  ok: boolean;
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
