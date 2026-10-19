import { beforeEach, expect, test, vi } from "vitest";
import { applyChanges } from "../src/background/service-worker";

const calls: { method: string; url: string; body?: unknown }[] = [];
let failOn = -1;

beforeEach(() => {
  calls.length = 0;
  failOn = -1;
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (calls.length - 1 === failOn) {
      return new Response(JSON.stringify({ error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } }), {
        status: 403,
      });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
});

test("deletes and moves become the right API calls, in order, with progress", async () => {
  const res = await applyChanges(
    "PL1",
    [
      { kind: "delete", playlistItemId: "i1", videoId: "v1" },
      { kind: "move", playlistItemId: "i2", videoId: "v2", position: 0 },
    ],
    7,
  );
  expect(res).toEqual({ applied: 2 });
  expect(calls[0]).toMatchObject({ method: "DELETE" });
  expect(calls[0].url).toContain("/playlistItems?id=i1");
  expect(calls[1].method).toBe("PUT");
  expect(calls[1].body).toEqual({
    id: "i2",
    snippet: { playlistId: "PL1", resourceId: { kind: "youtube#video", videoId: "v2" }, position: 0 },
  });
  expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(7, {
    type: "APPLY_PROGRESS",
    playlistId: "PL1",
    done: 2,
    total: 2,
  });
});

test("stops at the first failure and reports how far it got", async () => {
  failOn = 1;
  const res = await applyChanges("PL1", [
    { kind: "delete", playlistItemId: "a", videoId: "1" },
    { kind: "delete", playlistItemId: "b", videoId: "2" },
    { kind: "delete", playlistItemId: "c", videoId: "3" },
  ]);
  expect(res.applied).toBe(1);
  expect(res.error?.code).toBe("QUOTA_EXCEEDED");
  expect(calls).toHaveLength(2);
});
