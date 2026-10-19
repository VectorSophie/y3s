// What the page tools need from the service worker, behind an interface so
// tests can swap in a fake.

import type { ServerItem } from "../core/plan";
import { sendMessage, type Command } from "../shared/messages";
import type { ApiError, ApplyResult, Change, MyPlaylist, PlaylistAccess, Result } from "../shared/types";

export interface ServerTrack extends ServerItem {
  title: string;
}

export interface Backend {
  authStatus(): Promise<{ signedIn: boolean; configured: boolean }>;
  signIn(): Promise<void>;
  access(playlistId: string): Promise<PlaylistAccess>;
  items(playlistId: string): Promise<ServerTrack[]>;
  apply(
    playlistId: string,
    changes: Change[],
    onProgress: (done: number, total: number) => void,
  ): Promise<ApplyResult>;
  myPlaylists(): Promise<MyPlaylist[]>;
  addVideos(
    playlistId: string,
    videoIds: string[],
    onProgress: (done: number, total: number) => void,
  ): Promise<ApplyResult>;
}

function unwrap<T>(r: Result<T> | undefined): T {
  if (!r) throw { code: "UNKNOWN", message: "No response from the extension. Try reloading the page." } as ApiError;
  if (!r.ok) throw r.error;
  return r.data;
}

const progressListeners = new Map<string, (done: number, total: number) => void>();
let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  chrome.runtime.onMessage.addListener((msg: Command) => {
    if (msg?.type === "APPLY_PROGRESS") progressListeners.get(msg.playlistId)?.(msg.done, msg.total);
  });
}

export const chromeBackend: Backend = {
  async authStatus() {
    return unwrap(await sendMessage({ type: "AUTH_STATUS" }));
  },
  async signIn() {
    unwrap(await sendMessage({ type: "AUTH_GET_TOKEN", interactive: true }));
  },
  async access(playlistId) {
    return unwrap(await sendMessage({ type: "GET_PLAYLIST_ACCESS", playlistId }));
  },
  async items(playlistId) {
    const snap = unwrap(await sendMessage({ type: "FETCH_PLAYLIST_ITEMS", playlistId }));
    return snap.items.map((t) => ({ playlistItemId: t.playlistItemId, videoId: t.videoId, title: t.title }));
  },
  async apply(playlistId, changes, onProgress) {
    listen();
    progressListeners.set(playlistId, onProgress);
    try {
      return unwrap(await sendMessage({ type: "APPLY_CHANGES", playlistId, changes }));
    } finally {
      progressListeners.delete(playlistId);
    }
  },
  async myPlaylists() {
    return unwrap(await sendMessage({ type: "LIST_MY_PLAYLISTS" }));
  },
  async addVideos(playlistId, videoIds, onProgress) {
    listen();
    progressListeners.set(playlistId, onProgress);
    try {
      return unwrap(await sendMessage({ type: "ADD_TO_PLAYLIST", playlistId, videoIds }));
    } finally {
      progressListeners.delete(playlistId);
    }
  },
};
