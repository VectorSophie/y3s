import { vi } from "vitest";

// Minimal chrome.* surface; tests override what they need.
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
    getManifest: () => ({ version: "0.4.0", oauth2: { client_id: "test.apps.googleusercontent.com" } }),
  },
  tabs: { sendMessage: vi.fn(async () => undefined) },
  storage: {
    local: {
      data: {} as Record<string, unknown>,
      async get(key: string) {
        const d = (this as { data: Record<string, unknown> }).data;
        return key in d ? { [key]: structuredClone(d[key]) } : {};
      },
      async set(items: Record<string, unknown>) {
        Object.assign((this as { data: Record<string, unknown> }).data, structuredClone(items));
      },
      async remove(key: string) {
        delete (this as { data: Record<string, unknown> }).data[key];
      },
    },
  },
  identity: {
    getAuthToken: vi.fn(async () => ({ token: "tok" })),
    removeCachedAuthToken: vi.fn(async () => undefined),
  },
};

// jsdom has no layout.
Element.prototype.scrollIntoView = function () {};
window.scrollTo = (() => {}) as typeof window.scrollTo;

// jsdom has no media playback.
HTMLMediaElement.prototype.pause = function () {};
HTMLMediaElement.prototype.play = async function () {};
