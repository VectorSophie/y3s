import { vi } from "vitest";

// Minimal chrome.* surface; tests override what they need.
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
    getManifest: () => ({ version: "0.4.0", oauth2: { client_id: "test.apps.googleusercontent.com" } }),
  },
  tabs: { sendMessage: vi.fn(async () => undefined) },
  identity: {
    getAuthToken: vi.fn(async () => ({ token: "tok" })),
    removeCachedAuthToken: vi.fn(async () => undefined),
  },
};

// jsdom has no layout.
Element.prototype.scrollIntoView = function () {};
window.scrollTo = (() => {}) as typeof window.scrollTo;
