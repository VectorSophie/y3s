import { vi } from "vitest";

// Default no-op chrome; individual tests override sendMessage / storage.
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { sendMessage: vi.fn(), getManifest: () => ({ version: "0.2.0" }) },
  storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
};
