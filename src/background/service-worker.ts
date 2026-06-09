// Service worker: routes typed messages from the content script to auth + API,
// and toggles the drawer when the toolbar action is clicked.

import type { Request, ResponseData } from "../shared/messages";
import type { ApiError, Result } from "../shared/types";
import { apiError } from "../shared/utils";
import { clearAuthToken, getAuthToken, isConfigured } from "./auth";
import {
  deletePlaylistItem,
  fetchPlaylistItems,
  getPlaylistMetadata,
  insertPlaylistItem,
  updatePlaylistItemPosition,
} from "./youtube-api";

chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch((err) => sendResponse(fail(toApiError(err))));
  // Keep the message channel open for the async response.
  return true;
});

// Toolbar button toggles the drawer in the active tab.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_DRAWER" }).catch(() => {
      // Content script not present on this page (not a playlist page) — ignore.
    });
  }
});

async function handle(message: Request): Promise<Result<unknown>> {
  switch (message.type) {
    case "AUTH_STATUS": {
      let signedIn = false;
      if (isConfigured()) {
        try {
          await getAuthToken(false);
          signedIn = true;
        } catch {
          signedIn = false;
        }
      }
      return ok<"AUTH_STATUS">({ signedIn, configured: isConfigured() });
    }

    case "AUTH_GET_TOKEN":
      return ok<"AUTH_GET_TOKEN">({ token: await getAuthToken(message.interactive) });

    case "AUTH_CLEAR":
      return ok<"AUTH_CLEAR">({ cleared: await clearAuthToken() });

    case "FETCH_PLAYLIST_ITEMS":
      return ok<"FETCH_PLAYLIST_ITEMS">(await fetchPlaylistItems(message.playlistId));

    case "GET_PLAYLIST_METADATA":
      return ok<"GET_PLAYLIST_METADATA">(
        await getPlaylistMetadata(message.playlistId),
      );

    case "DELETE_PLAYLIST_ITEM":
      await deletePlaylistItem(message.playlistItemId);
      return ok<"DELETE_PLAYLIST_ITEM">({ playlistItemId: message.playlistItemId });

    case "UPDATE_PLAYLIST_ITEM_POSITION":
      await updatePlaylistItemPosition(message);
      return ok<"UPDATE_PLAYLIST_ITEM_POSITION">({
        playlistItemId: message.playlistItemId,
        position: message.position,
      });

    case "INSERT_PLAYLIST_ITEM": {
      const { playlistItemId } = await insertPlaylistItem(message);
      return ok<"INSERT_PLAYLIST_ITEM">({ playlistItemId });
    }

    default:
      return fail(apiError("UNKNOWN", "Unknown request."));
  }
}

function ok<K extends keyof ResponseData>(data: ResponseData[K]): Result<ResponseData[K]> {
  return { ok: true, data };
}

function fail(error: ApiError): Result<never> {
  return { ok: false, error };
}

function toApiError(err: unknown): ApiError {
  if (err && typeof err === "object" && "code" in err) return err as ApiError;
  return apiError("UNKNOWN", "", String((err as Error)?.message ?? err));
}
