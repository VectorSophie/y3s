// YouTube Data API v3 client. The single place that talks to googleapis.
// Runs in the background, where host permissions apply and CORS isn't an issue.

import { API_BASE, PAGE_SIZE } from "../shared/constants";
import { apiError, formatDuration } from "../shared/utils";
import type { ApiError, PlaylistSnapshot, Track } from "../shared/types";
import { getAuthToken, invalidateToken } from "./auth";

interface PlaylistItemsResponse {
  nextPageToken?: string;
  items: Array<{
    id: string;
    snippet: {
      title: string;
      position: number;
      videoOwnerChannelTitle?: string;
      channelTitle?: string;
      thumbnails?: Record<string, { url: string }>;
      resourceId: { videoId: string };
    };
  }>;
}

/**
 * Fetch every page of a playlist's items, then enrich with video durations.
 */
export async function fetchPlaylistItems(
  playlistId: string,
): Promise<PlaylistSnapshot> {
  const items: Track[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      part: "snippet",
      maxResults: String(PAGE_SIZE),
      playlistId,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await authedGet<PlaylistItemsResponse>(
      `/playlistItems?${params}`,
    );

    for (const item of data.items) {
      const s = item.snippet;
      const videoId = s.resourceId.videoId;
      items.push({
        playlistItemId: item.id,
        videoId,
        title: s.title,
        channelTitle: s.videoOwnerChannelTitle ?? s.channelTitle,
        thumbnailUrl: pickThumb(s.thumbnails),
        position: s.position,
        url: `https://www.youtube.com/watch?v=${videoId}&list=${playlistId}`,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  await enrichDurations(items);

  return {
    playlistId,
    items: items.sort((a, b) => a.position - b.position),
    fetchedAt: Date.now(),
  };
}

export async function getPlaylistMetadata(
  playlistId: string,
): Promise<{ title: string }> {
  const params = new URLSearchParams({ part: "snippet", id: playlistId });
  const data = await authedGet<{ items?: Array<{ snippet: { title: string } }> }>(
    `/playlists?${params}`,
  );
  const title = data.items?.[0]?.snippet?.title;
  if (!title) throw apiError("NOT_FOUND", "");
  return { title };
}

export async function deletePlaylistItem(playlistItemId: string): Promise<void> {
  const params = new URLSearchParams({ id: playlistItemId });
  await authedRequest(`/playlistItems?${params}`, { method: "DELETE" }, "delete");
}

export interface UpdatePositionParams {
  playlistItemId: string;
  playlistId: string;
  videoId: string;
  position: number;
}

/** Move an item to a new position. Requires the playlist to be manually sortable. */
export async function updatePlaylistItemPosition(
  params: UpdatePositionParams,
): Promise<void> {
  const body = {
    id: params.playlistItemId,
    snippet: {
      playlistId: params.playlistId,
      resourceId: { kind: "youtube#video", videoId: params.videoId },
      position: params.position,
    },
  };
  const search = new URLSearchParams({ part: "snippet" });
  await authedRequest(
    `/playlistItems?${search}`,
    { method: "PUT", body: JSON.stringify(body) },
    "update",
  );
}

export interface InsertParams {
  playlistId: string;
  videoId: string;
  position?: number;
}

/** Add a video to a playlist. */
export async function insertPlaylistItem(
  params: InsertParams,
): Promise<{ playlistItemId: string }> {
  const snippet: Record<string, unknown> = {
    playlistId: params.playlistId,
    resourceId: { kind: "youtube#video", videoId: params.videoId },
  };
  if (typeof params.position === "number") snippet.position = params.position;

  const search = new URLSearchParams({ part: "snippet" });
  const data = await authedRequest<{ id: string }>(
    `/playlistItems?${search}`,
    { method: "POST", body: JSON.stringify({ snippet }) },
    "insert",
  );
  return { playlistItemId: data.id };
}

// ── internals ──────────────────────────────────────────────────────────────

function pickThumb(thumbs?: Record<string, { url: string }>): string | undefined {
  if (!thumbs) return undefined;
  return (thumbs.medium ?? thumbs.default ?? Object.values(thumbs)[0])?.url;
}

/** Fetch contentDetails.duration for up to 50 ids at a time and attach labels. */
async function enrichDurations(items: Track[]): Promise<void> {
  const ids = items.map((t) => t.videoId);
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const params = new URLSearchParams({
      part: "contentDetails",
      id: batch.join(","),
      maxResults: "50",
    });
    try {
      const data = await authedGet<{
        items: Array<{ id: string; contentDetails: { duration: string } }>;
      }>(`/videos?${params}`);
      const byId = new Map(data.items.map((v) => [v.id, v.contentDetails.duration]));
      for (const t of items) {
        const dur = byId.get(t.videoId);
        if (dur) t.durationText = formatDuration(dur);
      }
    } catch {
      // Durations are non-essential; skip on failure rather than failing load.
      return;
    }
  }
}

function authedGet<T>(path: string): Promise<T> {
  return authedRequest<T>(path, { method: "GET" }, "list");
}

type WriteContext = "list" | "delete" | "update" | "insert";

/**
 * Authenticated fetch with a single silent→interactive retry on 401.
 * Returns parsed JSON, or {} for empty bodies (e.g. 204 from DELETE).
 */
async function authedRequest<T>(
  path: string,
  init: RequestInit,
  context: WriteContext,
  retried = false,
): Promise<T> {
  let token: string;
  try {
    token = await getAuthToken(false);
  } catch {
    token = await getAuthToken(true);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    throw apiError("NETWORK", "", String((err as Error)?.message ?? err));
  }

  if (res.status === 401 && !retried) {
    await invalidateToken(token);
    return authedRequest<T>(path, init, context, true);
  }

  if (!res.ok) {
    throw await classifyHttp(res, context);
  }

  if (res.status === 204) return {} as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

async function classifyHttp(res: Response, context: WriteContext): Promise<ApiError> {
  let reason = "";
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "";
    detail = body?.error?.message ?? detail;
  } catch {
    /* non-JSON body */
  }

  if (res.status === 401) return apiError("NOT_SIGNED_IN", "", detail);
  if (res.status === 404) return apiError("NOT_FOUND", "", detail);

  if (res.status === 403) {
    if (/quota/i.test(reason)) return apiError("QUOTA_EXCEEDED", "", detail);
    return apiError("NOT_OWNER", "", detail);
  }

  if (res.status === 400) {
    // Position edits on a non-manual playlist surface here.
    if (context === "update" && /playlistOperationUnsupported|manual|sort/i.test(reason + detail)) {
      return apiError("NOT_SORTABLE", "", detail);
    }
    return apiError(context === "list" ? "UNKNOWN" : "UPDATE_FAILED", "", detail);
  }

  return apiError("UNKNOWN", "", detail);
}
