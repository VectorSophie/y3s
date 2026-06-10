// Holds the current playlist snapshot and load lifecycle. Talks to the
// background for real data; falls back to mock data when OAuth isn't set up.

import { sendMessage } from "../shared/messages";
import type { ApiError, PlaylistSnapshot, Track } from "../shared/types";
import { Emitter } from "./store";
import { makeMockSnapshot } from "./mock-data";

export type PlaylistStatus = "idle" | "loading" | "ready" | "error";

export interface PlaylistState {
  status: PlaylistStatus;
  playlistId: string | null;
  snapshot: PlaylistSnapshot | null;
  error: ApiError | null;
  /** True when showing mock data because OAuth isn't configured. */
  isMock: boolean;
}

export class PlaylistStore extends Emitter<PlaylistState> {
  private state: PlaylistState = {
    status: "idle",
    playlistId: null,
    snapshot: null,
    error: null,
    isMock: false,
  };

  get(): PlaylistState {
    return this.state;
  }

  get tracks(): Track[] {
    return this.state.snapshot?.items ?? [];
  }

  private set(patch: Partial<PlaylistState>): void {
    this.state = { ...this.state, ...patch };
    this.emit(this.state);
  }

  /** Load real playlist data; auto-fall-back to mock if OAuth isn't configured. */
  async load(playlistId: string): Promise<void> {
    this.set({ status: "loading", playlistId, error: null });

    const res = await sendMessage({ type: "FETCH_PLAYLIST_ITEMS", playlistId });
    if (res.ok) {
      this.set({ status: "ready", snapshot: res.data, isMock: false, error: null });
      return;
    }

    // No OAuth client configured yet → show mock data so the UI is usable.
    if (res.error.code === "AUTH_NOT_CONFIGURED") {
      this.loadMock(playlistId);
      return;
    }

    this.set({ status: "error", error: res.error, snapshot: null });
  }

  /**
   * Hybrid load: paint scraped DOM data immediately, then upgrade to the full
   * API snapshot if the user is already signed in. Selection and phases are
   * keyed by videoId elsewhere, so swapping the snapshot preserves them.
   */
  async loadHybrid(playlistId: string, scrape: () => Track[]): Promise<void> {
    this.set({ status: "loading", playlistId, error: null });

    const domItems = scrape();
    if (domItems.length > 0) {
      this.set({
        status: "ready",
        snapshot: { playlistId, items: domItems, fetchedAt: Date.now(), source: "dom" },
        isMock: false,
        error: null,
      });
    }

    const status = await sendMessage({ type: "AUTH_STATUS" });
    const signedIn = status.ok && status.data.signedIn;

    if (signedIn) {
      const res = await sendMessage({ type: "FETCH_PLAYLIST_ITEMS", playlistId });
      if (res.ok) {
        this.set({
          status: "ready",
          snapshot: { ...res.data, source: "api" },
          isMock: false,
          error: null,
        });
        return;
      }
      if (res.error.code !== "AUTH_NOT_CONFIGURED" && domItems.length === 0) {
        this.set({ status: "error", error: res.error, snapshot: null });
        return;
      }
    }

    // No DOM rows and no API data → fall back to mock so the UI is still usable.
    if (domItems.length === 0 && this.state.snapshot === null) {
      this.loadMock(playlistId);
    }
  }

  /** Force the local mock fixture (used by dev toggle and as a fallback). */
  loadMock(playlistId: string): void {
    this.set({
      status: "ready",
      playlistId,
      snapshot: makeMockSnapshot(playlistId),
      isMock: true,
      error: null,
    });
  }

  /** Remove items locally after a confirmed API delete, and re-index positions. */
  applyDeletion(playlistItemIds: Set<string>): void {
    const snap = this.state.snapshot;
    if (!snap) return;
    const items = snap.items
      .filter((t) => !playlistItemIds.has(t.playlistItemId))
      .map((t, i) => ({ ...t, position: i }));
    this.set({ snapshot: { ...snap, items } });
  }

  /** Reorder the local snapshot to a new ordering of videoIds (sort preview). */
  applyLocalOrder(orderedVideoIds: string[]): void {
    const snap = this.state.snapshot;
    if (!snap) return;
    const byId = new Map(snap.items.map((t) => [t.videoId, t]));
    const items = orderedVideoIds
      .map((id, i) => {
        const t = byId.get(id);
        return t ? { ...t, position: i } : null;
      })
      .filter((t): t is Track => t !== null);
    this.set({ snapshot: { ...snap, items } });
  }
}
