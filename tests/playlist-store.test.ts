import { beforeEach, expect, test, vi } from "vitest";
import { PlaylistStore } from "../src/state/playlist-store";
import type { Track } from "../src/shared/types";

function track(v: string, pos: number, itemId = ""): Track {
  return { playlistItemId: itemId, videoId: v, title: v.toUpperCase(), position: pos, url: `u/${v}` };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

test("paints DOM snapshot immediately, then swaps to API when signed in", async () => {
  const domTracks = [track("a", 0), track("b", 1)];
  const apiSnap = {
    playlistId: "PLx",
    title: "Real",
    items: [track("a", 0, "ITEM_A"), track("b", 1, "ITEM_B")],
    fetchedAt: 1,
  };
  const sendMessage = vi.fn(async (req: { type: string }) => {
    if (req.type === "AUTH_STATUS") return { ok: true, data: { signedIn: true, configured: true } };
    if (req.type === "FETCH_PLAYLIST_ITEMS") return { ok: true, data: apiSnap };
    return { ok: false, error: { code: "UNKNOWN", message: "" } };
  });
  (globalThis as any).chrome = { runtime: { sendMessage } };

  const store = new PlaylistStore();
  const sources: Array<string | undefined> = [];
  store.subscribe((s) => s.snapshot && sources.push(s.snapshot.source));

  await store.loadHybrid("PLx", () => domTracks);

  expect(sources[0]).toBe("dom"); // painted first
  expect(store.get().snapshot?.source).toBe("api"); // upgraded
  expect(store.get().snapshot?.items[0].playlistItemId).toBe("ITEM_A");
});

test("stays on DOM data when not signed in", async () => {
  const sendMessage = vi.fn(async (req: { type: string }) => {
    if (req.type === "AUTH_STATUS") return { ok: true, data: { signedIn: false, configured: true } };
    return { ok: false, error: { code: "NOT_SIGNED_IN", message: "" } };
  });
  (globalThis as any).chrome = { runtime: { sendMessage } };

  const store = new PlaylistStore();
  await store.loadHybrid("PLx", () => [track("a", 0)]);

  expect(store.get().snapshot?.source).toBe("dom");
  expect(store.get().status).toBe("ready");
});
