// Service worker: routes typed messages from the content script to auth and
// the YouTube Data API. Tokens never leave this context.

import type { Command, Request } from "../shared/messages";
import type { ApiError, ApplyResult, Change, Result } from "../shared/types";
import { apiError } from "../shared/utils";
import { clearAuthToken, getAuthToken, isConfigured } from "./auth";
import {
  deletePlaylistItem,
  fetchPlaylistItems,
  getPlaylistAccess,
  resetIdentity,
  updatePlaylistItemPosition,
} from "./youtube-api";

chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
  handle(message, sender.tab?.id)
    .then((data) => sendResponse({ ok: true, data } satisfies Result<unknown>))
    .catch((err) => sendResponse({ ok: false, error: toApiError(err) } satisfies Result<unknown>));
  return true; // async response
});

async function handle(message: Request, tabId?: number): Promise<unknown> {
  switch (message.type) {
    case "AUTH_STATUS": {
      let signedIn = false;
      if (isConfigured()) signedIn = await getAuthToken(false).then(() => true, () => false);
      return { signedIn, configured: isConfigured() };
    }
    case "AUTH_GET_TOKEN":
      await getAuthToken(message.interactive);
      resetIdentity();
      return { signedIn: true };
    case "AUTH_CLEAR":
      resetIdentity();
      return { cleared: await clearAuthToken() };
    case "FETCH_PLAYLIST_ITEMS":
      return fetchPlaylistItems(message.playlistId);
    case "GET_PLAYLIST_ACCESS":
      return getPlaylistAccess(message.playlistId);
    case "APPLY_CHANGES":
      return enqueue(message.playlistId, () => applyChanges(message.playlistId, message.changes, tabId));
  }
}

// Writes to one playlist run one batch at a time: positions in a batch assume
// the batch before it has finished.
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(playlistId: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(playlistId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(job);
  queues.set(playlistId, next);
  next.finally(() => {
    if (queues.get(playlistId) === next) queues.delete(playlistId);
  });
  return next;
}

/** Apply changes in order, stopping at the first failure. Keeps running even
 *  if the tab navigates away. */
export async function applyChanges(playlistId: string, changes: Change[], tabId?: number): Promise<ApplyResult> {
  const progress = (done: number) => {
    if (tabId == null) return;
    const cmd: Command = { type: "APPLY_PROGRESS", playlistId, done, total: changes.length };
    chrome.tabs.sendMessage(tabId, cmd).catch(() => undefined);
  };
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    try {
      if (c.kind === "delete") await deletePlaylistItem(c.playlistItemId);
      else
        await updatePlaylistItemPosition({
          playlistItemId: c.playlistItemId,
          playlistId,
          videoId: c.videoId,
          position: c.position,
        });
    } catch (err) {
      return { applied: i, error: toApiError(err) };
    }
    progress(i + 1);
  }
  return { applied: changes.length };
}

function toApiError(err: unknown): ApiError {
  if (err && typeof err === "object" && "code" in err) return err as ApiError;
  return apiError("UNKNOWN", "", String((err as Error)?.message ?? err));
}
