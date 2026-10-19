// Typed message passing between the content script and the service worker.
// Every request has a `type` discriminant; every response is a Result<T>.

import type { ApplyResult, Change, PlaylistAccess, PlaylistSnapshot, Result } from "./types";

/** Requests: content script → service worker. */
export type Request =
  | { type: "AUTH_GET_TOKEN"; interactive: boolean }
  | { type: "AUTH_CLEAR" }
  | { type: "AUTH_STATUS" }
  | { type: "FETCH_PLAYLIST_ITEMS"; playlistId: string }
  | { type: "GET_PLAYLIST_ACCESS"; playlistId: string }
  | { type: "APPLY_CHANGES"; playlistId: string; changes: Change[] };

/** Successful response data for each request type. */
export interface ResponseData {
  AUTH_GET_TOKEN: { signedIn: true };
  AUTH_CLEAR: { cleared: boolean };
  AUTH_STATUS: { signedIn: boolean; configured: boolean };
  FETCH_PLAYLIST_ITEMS: PlaylistSnapshot;
  GET_PLAYLIST_ACCESS: PlaylistAccess;
  APPLY_CHANGES: ApplyResult;
}

/** Pushes: service worker → content script. */
export type Command = { type: "APPLY_PROGRESS"; playlistId: string; done: number; total: number };

type RequestOf<T extends Request["type"]> = Extract<Request, { type: T }>;

/** Send a typed request to the service worker and await its Result envelope. */
export function sendMessage<T extends Request["type"]>(
  request: RequestOf<T>,
): Promise<Result<ResponseData[T]>> {
  return chrome.runtime.sendMessage(request) as Promise<Result<ResponseData[T]>>;
}
