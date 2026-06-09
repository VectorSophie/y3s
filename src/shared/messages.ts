// Typed message passing between content script and service worker.
//
// Every request has a `type` discriminant and a typed payload. Every response
// is a Result<T> envelope (see types.ts). The content script uses the
// `sendMessage` helper which preserves types end to end.

import type { PlaylistSnapshot, Result } from "./types";

/** Request messages: content script → service worker. */
export type Request =
  | { type: "AUTH_GET_TOKEN"; interactive: boolean }
  | { type: "AUTH_CLEAR" }
  | { type: "AUTH_STATUS" }
  | { type: "FETCH_PLAYLIST_ITEMS"; playlistId: string }
  | { type: "GET_PLAYLIST_METADATA"; playlistId: string }
  | { type: "DELETE_PLAYLIST_ITEM"; playlistItemId: string }
  | {
      type: "UPDATE_PLAYLIST_ITEM_POSITION";
      playlistItemId: string;
      playlistId: string;
      videoId: string;
      position: number;
    }
  | {
      type: "INSERT_PLAYLIST_ITEM";
      playlistId: string;
      videoId: string;
      position?: number;
    };

/** Maps each request type to its successful response data shape. */
export interface ResponseData {
  AUTH_GET_TOKEN: { token: string };
  AUTH_CLEAR: { cleared: boolean };
  AUTH_STATUS: { signedIn: boolean; configured: boolean };
  FETCH_PLAYLIST_ITEMS: PlaylistSnapshot;
  GET_PLAYLIST_METADATA: { title: string };
  DELETE_PLAYLIST_ITEM: { playlistItemId: string };
  UPDATE_PLAYLIST_ITEM_POSITION: { playlistItemId: string; position: number };
  INSERT_PLAYLIST_ITEM: { playlistItemId: string };
}

/** Broadcast messages: service worker / action button → content script. */
export type Command = { type: "TOGGLE_DRAWER" } | { type: "URL_CHANGED"; url: string };

type RequestOf<T extends Request["type"]> = Extract<Request, { type: T }>;

/**
 * Send a typed request to the service worker and await its Result envelope.
 */
export function sendMessage<T extends Request["type"]>(
  request: RequestOf<T>,
): Promise<Result<ResponseData[T]>> {
  return chrome.runtime.sendMessage(request) as Promise<Result<ResponseData[T]>>;
}
