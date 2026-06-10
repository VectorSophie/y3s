# In-place Playlist Enhancement (v0.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating drawer with an in-place enhancement of the YouTube `/playlist` page: our toolbar + rendered rows mount inside the playlist column, painting instantly from scraped DOM data and upgrading to the full API snapshot when signed in.

**Architecture:** Reuse all stores, the operation planner, and the list/toolbar/phase/selection/toast UI from v0.1. Add a DOM scraper and a mount-point that injects a Shadow-DOM panel into YouTube's playlist column (hiding the native list, with a "Show original" toggle). The playlist store gains a two-stage hybrid load. Editing stays API-only via the existing planner + confirmation; OAuth is requested on first write.

**Tech Stack:** TypeScript, esbuild (existing), Shadow DOM, Chrome MV3, vitest + jsdom (new, for unit tests).

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/content/youtube-scrape.ts` (new) | Parse playlist rows from the page DOM → `Track[]`; auto-scroll loader. |
| `src/content/mount-point.ts` (new) | Locate the playlist column, inject root, hide native list, toggle, fallback. |
| `src/content/panel-root.ts` (new, replaces `overlay-root.ts`) | Build Shadow root + stores; render toolbar/list/toast in-column. |
| `src/ui/panel.ts` (new, replaces `drawer.ts`) | Same compose/select/edit logic, minus drawer open/close; adds sync badge + Show-original. |
| `src/state/playlist-store.ts` (modify) | Add `loadHybrid(playlistId, scrape)`; track snapshot `source`. |
| `src/shared/types.ts` (modify) | Add `source?: "dom" \| "api"` to `PlaylistSnapshot`. |
| `src/content/content-script.ts` (modify) | On `/playlist`: attach mount, run hybrid load; teardown on leave. |
| `src/styles/content.css` (modify) | Swap fixed-drawer shell rules for in-column panel; keep everything else. |
| `vitest.config.ts`, `tests/*` (new) | Unit tests for scraper + hybrid store. |

Files deleted at the end: `src/content/overlay-root.ts`, `src/ui/drawer.ts` (after their replacements land).

---

## Task 1: Test infrastructure (vitest + jsdom)

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`

- [ ] **Step 1: Install dev deps**

Run:
```bash
npm i -D vitest@^2 jsdom@^25
```

- [ ] **Step 2: Add scripts to `package.json`**

In the `"scripts"` block add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create `tests/setup.ts`** (a minimal `chrome` stub so modules that touch the API can be imported)

```ts
import { vi } from "vitest";

// Default no-op chrome; individual tests override sendMessage / storage.
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { sendMessage: vi.fn(), getManifest: () => ({ version: "0.2.0" }) },
  storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
};
```

- [ ] **Step 5: Verify the runner works (no tests yet = exit 0 with "no test files" is acceptable; add a smoke test)**

Create `tests/smoke.test.ts`:
```ts
import { expect, test } from "vitest";
test("runner works", () => expect(1 + 1).toBe(2));
```

Run: `npm test`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/setup.ts tests/smoke.test.ts
git commit -m "test: add vitest + jsdom runner"
```

---

## Task 2: Add `source` to PlaylistSnapshot

**Files:**
- Modify: `src/shared/types.ts` (the `PlaylistSnapshot` interface)

- [ ] **Step 1: Edit the interface**

Replace the `PlaylistSnapshot` interface body's `isMock?` line region so it reads:
```ts
export interface PlaylistSnapshot {
  playlistId: string;
  title?: string;
  items: Track[];
  fetchedAt: number;
  /** True when the data is the local mock fixture, not the real API. */
  isMock?: boolean;
  /** Where the data came from: scraped page DOM vs the YouTube Data API. */
  source?: "dom" | "api";
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no usages broken; field is optional).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add source field to PlaylistSnapshot"
```

---

## Task 3: DOM scraper (`youtube-scrape.ts`)

**Files:**
- Create: `src/content/youtube-scrape.ts`
- Create: `tests/youtube-scrape.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/youtube-scrape.test.ts`:
```ts
import { beforeEach, expect, test } from "vitest";
import { scrapeTracks } from "../src/content/youtube-scrape";

// Minimal stand-in for a YouTube playlist row.
function rowHtml(opts: { v: string; title: string; channel: string; dur?: string; thumb?: string }): string {
  return `
  <ytd-playlist-video-renderer>
    <ytd-thumbnail>
      ${opts.thumb ? `<img src="${opts.thumb}">` : `<img>`}
      <ytd-thumbnail-overlay-time-status-renderer>
        <span id="text">${opts.dur ?? ""}</span>
      </ytd-thumbnail-overlay-time-status-renderer>
    </ytd-thumbnail>
    <a id="video-title" href="/watch?v=${opts.v}&list=PLx" title="${opts.title}">${opts.title}</a>
    <ytd-channel-name><div id="text"><a href="/@chan">${opts.channel}</a></div></ytd-channel-name>
  </ytd-playlist-video-renderer>`;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

test("scrapes title, videoId, channel, duration, thumbnail, position", () => {
  document.body.innerHTML =
    rowHtml({ v: "aaa", title: "First", channel: "Chan A", dur: "3:33", thumb: "http://t/a.jpg" }) +
    rowHtml({ v: "bbb", title: "Second", channel: "Chan B", dur: "4:12" });

  const tracks = scrapeTracks("PLx");
  expect(tracks).toHaveLength(2);
  expect(tracks[0]).toMatchObject({
    videoId: "aaa",
    title: "First",
    channelTitle: "Chan A",
    durationText: "3:33",
    thumbnailUrl: "http://t/a.jpg",
    position: 0,
  });
  expect(tracks[0].playlistItemId).toBe(""); // unknown from DOM
  expect(tracks[1]).toMatchObject({ videoId: "bbb", position: 1 });
  expect(tracks[1].thumbnailUrl).toBeUndefined();
});

test("skips rows with no videoId", () => {
  document.body.innerHTML = `<ytd-playlist-video-renderer><a id="video-title" href="/playlist?list=PLx">x</a></ytd-playlist-video-renderer>`;
  expect(scrapeTracks("PLx")).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/youtube-scrape.test.ts`
Expected: FAIL ("scrapeTracks is not a function" / module not found).

- [ ] **Step 3: Write the implementation**

`src/content/youtube-scrape.ts`:
```ts
// Reads playlist rows from the YouTube page DOM for instant, sign-in-free
// display. Used ONLY for display (source:"dom"); writes always go through the
// API. Selectors live here and in mount-point.ts so DOM breakage is localised.

import type { Track } from "../shared/types";

const ROW = "ytd-playlist-video-renderer";

function videoIdFromHref(href: string | null): string | null {
  if (!href) return null;
  const m = /[?&]v=([^&]+)/.exec(href);
  return m ? m[1] : null;
}

function text(el: Element | null): string | undefined {
  const t = el?.textContent?.trim();
  return t ? t : undefined;
}

/** Parse all currently-rendered playlist rows into Track[] (DOM order = position). */
export function scrapeTracks(playlistId: string): Track[] {
  const rows = Array.from(document.querySelectorAll(ROW));
  const out: Track[] = [];
  rows.forEach((row) => {
    const anchor = row.querySelector("a#video-title") as HTMLAnchorElement | null;
    const videoId = videoIdFromHref(anchor?.getAttribute("href") ?? null);
    if (!videoId) return;

    const title = anchor?.getAttribute("title")?.trim() || text(anchor) || "Untitled";
    const channel = text(row.querySelector("ytd-channel-name #text")) ?? text(row.querySelector("ytd-channel-name"));
    const dur = text(row.querySelector("ytd-thumbnail-overlay-time-status-renderer #text"));
    const img = row.querySelector("ytd-thumbnail img") as HTMLImageElement | null;
    const thumb = img?.getAttribute("src") || undefined;

    out.push({
      playlistItemId: "", // not available from DOM; resolved via API on edit
      videoId,
      title,
      channelTitle: channel,
      thumbnailUrl: thumb && thumb.startsWith("http") ? thumb : undefined,
      durationText: dur,
      position: out.length,
      url: `https://www.youtube.com/watch?v=${videoId}&list=${playlistId}`,
    });
  });
  return out;
}

/**
 * Force-load lazy rows by scrolling to the bottom until the row count stops
 * growing (or a cap/timeout hits). Resolves with the final scraped tracks.
 */
export async function autoScrollLoadAll(
  playlistId: string,
  opts: { maxMs?: number } = {},
): Promise<Track[]> {
  const maxMs = opts.maxMs ?? 15000;
  const start = Date.now();
  let last = -1;
  // eslint-disable-next-line no-constant-condition
  while (Date.now() - start < maxMs) {
    const count = document.querySelectorAll(ROW).length;
    if (count === last) break;
    last = count;
    window.scrollTo({ top: document.documentElement.scrollHeight });
    await new Promise((r) => setTimeout(r, 600));
  }
  window.scrollTo({ top: 0 });
  return scrapeTracks(playlistId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/youtube-scrape.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/content/youtube-scrape.ts tests/youtube-scrape.test.ts
git commit -m "feat: scrape playlist rows from YouTube DOM"
```

---

## Task 4: Hybrid load in the playlist store

**Files:**
- Modify: `src/state/playlist-store.ts`
- Create: `tests/playlist-store.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/playlist-store.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/playlist-store.test.ts`
Expected: FAIL ("loadHybrid is not a function").

- [ ] **Step 3: Implement `loadHybrid`**

In `src/state/playlist-store.ts`, add the import of `Track` if not present, and add this method to the `PlaylistStore` class (after `load`):
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/playlist-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/state/playlist-store.ts tests/playlist-store.test.ts
git commit -m "feat: hybrid DOM-first/API-upgrade load in playlist store"
```

---

## Task 5: Mount point (`mount-point.ts`)

**Files:**
- Create: `src/content/mount-point.ts`

This file is DOM-integration glue; verify by build + manual load (no unit test).

- [ ] **Step 1: Write the implementation**

`src/content/mount-point.ts`:
```ts
// Finds YouTube's playlist content column, injects the panel host as its first
// child, and hides the native list while ours is shown. A "Show original"
// toggle flips back. Selectors are isolated here; a fallback host is used if
// the column can't be found so we never silently no-op.

import { ROOT_ELEMENT_ID } from "../shared/constants";

// Candidate containers for the main playlist video list, most-specific first.
const COLUMN_SELECTORS = [
  "ytd-playlist-video-list-renderer",
  "ytd-item-section-renderer #contents.ytd-item-section-renderer",
  "ytd-section-list-renderer #contents",
];

export interface Mount {
  host: HTMLElement;
  /** True when attached to a real column; false when using the fixed fallback. */
  attached: boolean;
  showOriginal: (show: boolean) => void;
  destroy: () => void;
}

function findColumn(): HTMLElement | null {
  for (const sel of COLUMN_SELECTORS) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) return el;
  }
  return null;
}

/**
 * Create the panel host inside the playlist column (or a fixed fallback).
 * Returns the host element + controls. Does NOT build UI — caller attaches a
 * shadow root to `host`.
 */
export function createMount(): Mount {
  // Never double-mount.
  const existing = document.getElementById(ROOT_ELEMENT_ID);
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = ROOT_ELEMENT_ID;

  const column = findColumn();
  let nativeList: HTMLElement | null = null;
  let attached = false;

  if (column) {
    attached = true;
    nativeList = column;
    host.style.cssText = "display:block; width:100%;";
    column.parentElement?.insertBefore(host, column);
  } else {
    // Fallback: a fixed card so the user sees something went wrong, not nothing.
    host.style.cssText =
      "position:fixed; top:80px; right:16px; width:380px; z-index:2147483000;";
    document.documentElement.append(host);
  }

  const showOriginal = (show: boolean) => {
    if (nativeList) nativeList.style.display = show ? "" : "none";
    host.style.display = show ? "none" : "block";
  };
  // Start with native list hidden, our panel shown (only when truly attached).
  if (attached) showOriginal(false);

  return {
    host,
    attached,
    showOriginal,
    destroy: () => {
      if (nativeList) nativeList.style.display = "";
      host.remove();
    },
  };
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/content/mount-point.ts
git commit -m "feat: playlist-column mount point with native-list hide + fallback"
```

---

## Task 6: Panel UI (`panel.ts`, from `drawer.ts`)

**Files:**
- Create: `src/ui/panel.ts` (start by copying `src/ui/drawer.ts`, then apply the changes below)
- Read for reference: `src/ui/drawer.ts` (existing), `src/ui/toolbar.ts`, `src/ui/track-list.ts`

The compose/search/filter/sort/group/selection/delete/move logic is identical to `drawer.ts` and is reused verbatim. Only the shell changes.

- [ ] **Step 1: Copy `drawer.ts` → `panel.ts` and rename the class**

```bash
cp src/ui/drawer.ts src/ui/panel.ts
```
Rename `export class Drawer` to `export class Panel`.

- [ ] **Step 2: Remove drawer-shell concerns**

In `panel.ts`:
- Delete the `open` field, `setOpen`, `toggle`, `close`, `isOpen` methods, and the `is-open` class usage.
- Remove the header **close button** (`closeBtn`) and its node from the header.
- In `bindShortcuts`, change `clearOrClose` so Escape only clears selection:
```ts
        clearOrClose: () => this.selection.clear(),
```
- Rename `this.host` to `this.el` (the root element) and change its tag/class:
```ts
    this.el = h("section", { class: "pf-panel", role: "region", "aria-label": "y3s playlist editor" }, header, this.body);
```
- Update the constructor's first param name from `mount` usage to keep `mount` (still used for modals/menus/toast) — no change needed there.

- [ ] **Step 3: Add the sync badge + "Show original" toggle to the header**

Replace the `this.badge` line and header `meta` with:
```ts
    this.badge = h("span", { class: "pf-badge", hidden: true }, "page view");
    const showOriginalBtn = h(
      "button",
      { class: "pf-btn pf-btn--ghost pf-head__toggle", onClick: () => this.onShowOriginal?.() },
      "Show original",
    );
```
Add to the header row (replace the old `closeBtn` slot):
```ts
      showOriginalBtn,
```
Add a public hook near the top of the class:
```ts
  /** Set by panel-root to flip back to YouTube's native list. */
  onShowOriginal?: () => void;
```

- [ ] **Step 4: Reflect snapshot source in the badge**

In `onPlaylistChange`, replace the `this.badge.toggleAttribute(...)` line with:
```ts
    const src = s.snapshot?.source;
    this.badge.hidden = !(s.isMock || src === "dom");
    this.badge.textContent = s.isMock ? "mock" : "page view";
```
(When `source === "api"` the badge hides — data is fully synced.)

- [ ] **Step 4b: Gate writes behind real API data (so deletes/moves have item IDs)**

DOM-scraped rows have `playlistItemId === ""`, which the API can't delete/move. Before any write, ensure the snapshot is from the API. Add this method to `Panel`:
```ts
  /**
   * Writes need real playlistItemIds. If the current data is DOM-scraped,
   * sign in (if needed) and load the API snapshot first. Returns true when the
   * snapshot is API-backed and the write may proceed.
   */
  private async ensureApiData(): Promise<boolean> {
    if (this.playlist.get().isMock) return true; // mock writes are local-only
    if (this.playlist.get().snapshot?.source === "api") return true;

    const auth = await sendMessage({ type: "AUTH_GET_TOKEN", interactive: true });
    if (!auth.ok) {
      this.toast.error(messageForError(auth.error));
      return false;
    }
    const id = this.playlist.get().playlistId!;
    await this.playlist.loadHybrid(id, () => this.playlist.tracks);
    if (this.playlist.get().snapshot?.source !== "api") {
      this.toast.error("Couldn't load editable playlist data from YouTube.");
      return false;
    }
    return true;
  }
```
Then, at the very top of both `deleteSelected()` and `moveSelected()` (after the empty-selection guard), add:
```ts
    if (!(await this.ensureApiData())) return;
```
(`sendMessage` and `messageForError` are already imported in the copied file.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: FAIL only on `overlay-root.ts` still importing `Drawer` (fixed in Task 7). If other errors appear in `panel.ts`, resolve them per the messages.

- [ ] **Step 6: Commit**

```bash
git add src/ui/panel.ts
git commit -m "feat: in-place Panel (from Drawer) without slide-in shell"
```

---

## Task 7: Panel root (`panel-root.ts`, from `overlay-root.ts`)

**Files:**
- Create: `src/content/panel-root.ts`
- Delete: `src/content/overlay-root.ts`, `src/ui/drawer.ts`

- [ ] **Step 1: Write `panel-root.ts`**

```ts
// Builds the Shadow-DOM panel and wires it to a Mount. Replaces overlay-root.
// No rail, no floating drawer — the panel lives inside the playlist column.

import { PhaseStore } from "../state/phase-store";
import { PlaylistStore } from "../state/playlist-store";
import { SelectionStore } from "../state/selection-store";
import { Panel } from "../ui/panel";
import { h } from "../ui/components";
import { scrapeTracks } from "./youtube-scrape";
import { createMount, type Mount } from "./mount-point";
import styles from "../styles/content.css";

export class PanelRoot {
  private mount: Mount;
  private overlay: HTMLElement;
  private panel: Panel;
  private playlist = new PlaylistStore();
  private selection = new SelectionStore();
  private phases = new PhaseStore();
  private currentPlaylistId: string | null = null;

  constructor() {
    this.mount = createMount();
    const shadow = this.mount.host.attachShadow({ mode: "open" });
    shadow.append(h("style", { html: styles }));

    this.overlay = h("div", { class: "pf-overlay" });
    this.panel = new Panel(this.overlay, this.playlist, this.selection, this.phases);
    this.panel.onShowOriginal = () => this.mount.showOriginal(true);

    this.overlay.append(this.panel.el);
    shadow.append(this.overlay);
  }

  async setPlaylist(playlistId: string): Promise<void> {
    if (playlistId === this.currentPlaylistId) return;
    this.currentPlaylistId = playlistId;
    this.selection.clear();
    await this.phases.load(playlistId);
    await this.playlist.loadHybrid(playlistId, () => scrapeTracks(playlistId));
  }

  destroy(): void {
    this.panel.destroy();
    this.mount.destroy();
  }
}
```

- [ ] **Step 2: Delete the obsolete files**

```bash
git rm src/content/overlay-root.ts src/ui/drawer.ts
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: FAIL only on `content-script.ts` importing `OverlayRoot` (fixed in Task 8).

- [ ] **Step 4: Commit**

```bash
git add src/content/panel-root.ts
git commit -m "feat: PanelRoot mounts in-column panel (replaces OverlayRoot)"
```

---

## Task 8: Rewire the content script

**Files:**
- Modify: `src/content/content-script.ts`

- [ ] **Step 1: Replace the body**

```ts
// Content script entry. Loads on every YouTube page; on a /playlist URL it
// mounts the in-place panel and runs the hybrid load. Survives SPA navigation.

import type { Command } from "../shared/messages";
import { currentPlaylistId, onUrlChange } from "./page-detect";
import { PanelRoot } from "./panel-root";

const TAG = "[y3s]";

declare global {
  interface Window { __y3sInjected?: boolean; }
}

function isPlaylistPage(): boolean {
  return location.pathname === "/playlist" && currentPlaylistId() !== null;
}

function main(): void {
  if (window.__y3sInjected) return;
  window.__y3sInjected = true;
  console.info(TAG, `content script injected (v${chrome.runtime.getManifest().version})`, location.href);

  let root: PanelRoot | null = null;

  const sync = () => {
    try {
      if (isPlaylistPage()) {
        if (!root) {
          root = new PanelRoot();
          console.info(TAG, "panel mounted for", currentPlaylistId());
        }
        void root.setPlaylist(currentPlaylistId()!);
      } else if (root) {
        root.destroy();
        root = null;
      }
    } catch (err) {
      console.error(TAG, "sync() failed:", err);
    }
  };

  sync();
  onUrlChange((url) => {
    console.debug(TAG, "navigation:", url);
    sync();
  });

  // Toolbar action: scroll the panel into view if present.
  chrome.runtime.onMessage.addListener((msg: Command) => {
    if (msg.type === "TOGGLE_DRAWER") {
      document.getElementById("y3s-root")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

try {
  main();
} catch (err) {
  console.error(TAG, "fatal init error:", err);
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS; `dist/content.js` regenerated.

- [ ] **Step 3: Commit**

```bash
git add src/content/content-script.ts
git commit -m "feat: content script mounts in-place panel on /playlist"
```

---

## Task 9: In-column panel styles

**Files:**
- Modify: `src/styles/content.css`

- [ ] **Step 1: Remove the floating-drawer + rail rules**

Delete these rule blocks (they no longer have markup): `.pf-rail`, `.pf-rail__label`, `.pf-overlay:has(.pf-drawer.is-open) .pf-rail`, `.pf-drawer`, `.pf-drawer.is-open`. Keep everything else (tokens, head, toolbar, list, rows, phases, buttons, marquee, modal, menu, toasts, states, animations).

- [ ] **Step 2: Add the in-column panel container** (place near the top, after the `.pf-overlay` block)

```css
/* In-column panel: blends into the YouTube playlist column. */
.pf-panel {
  display: flex;
  flex-direction: column;
  max-height: min(80vh, 900px);
  background: var(--pf-bg);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-radius);
  overflow: hidden;
  margin-bottom: 16px;
}
.pf-head__toggle {
  margin-left: auto;
  white-space: nowrap;
}
```

- [ ] **Step 3: Make the list scroll within the panel** (replace the `.pf-list` `flex: 1` height behavior so it has a bounded height inside the column)

In the `.pf-list` rule, ensure it has:
```css
  max-height: 60vh;
```
(keep `overflow-y: auto;`).

- [ ] **Step 4: Build + manual verification**

Run: `npm run build`
Then in Chrome: reload the extension at `chrome://extensions`, hard-refresh a `youtube.com/playlist?list=…` page. Verify:
- The y3s panel renders **inside the column**, native list hidden.
- Search, chips, sort, multi-select, shift-range, Alt-drag, phases, shortcuts work on scraped data with no sign-in.
- "Show original" reveals YouTube's native list; the panel hides.

- [ ] **Step 5: Commit**

```bash
git add src/styles/content.css
git commit -m "style: in-column panel; drop floating drawer + rail rules"
```

---

## Task 10: Docs + final verification

**Files:**
- Modify: `README.md`, `docs/architecture.md`

- [ ] **Step 1: Update the README**

- In the intro/features, replace "right-side drawer" / "rail" language with: the panel renders **in place** on the playlist page; no clicks to open.
- Add to Features: "Works instantly with no sign-in (reads the page); upgrades to full data when signed in."
- Update keyboard shortcuts: remove "close the drawer"; Escape clears selection.
- Note watch pages are out of scope for now (playlist pages only).

- [ ] **Step 2: Update `docs/architecture.md`**

- Replace the drawer diagram's "Drawer (right side)" with "Panel (in playlist column)".
- Add a line to the data-flow section describing the hybrid DOM-first → API-upgrade load.

- [ ] **Step 3: Full verification**

Run:
```bash
npm run typecheck && npm test && npm run build
```
Expected: typecheck PASS; all unit tests PASS; build PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture.md
git commit -m "docs: describe in-place panel + hybrid data model"
```

- [ ] **Step 5: Push**

```bash
git push
```

---

## Self-review notes

- **Spec coverage:** in-place render (T5–T9), our-rows-in-column (T5/T9), hybrid data (T3/T4), source badge (T6), Show-original toggle (T5/T6), editing/auth unchanged (reused from Panel), fallback state (T5), playlist-only scope (T8 `isPlaylistPage`), typecheck/build/tests (T10). Watch-page non-goal honored (content script no-ops off `/playlist`).
- **Reused, not rewritten:** selection/phase stores, operation planner, track-list, toolbar, phases, drag-select, shortcuts, toast, components, background, shared — imported unchanged by `panel.ts`/`panel-root.ts`.
- **Type consistency:** `loadHybrid(playlistId, scrape)`, `scrapeTracks(playlistId)`, `createMount(): Mount`, `Panel.onShowOriginal`, `PlaylistSnapshot.source` are referenced consistently across tasks.
- **Edit flows on DOM data:** `playlistItemId` is `""` from scraping; the first write upgrades to API (Panel's existing delete/move flows already require API). If a write is attempted while `source==="dom"` and signed out, the existing auth path prompts sign-in. (Implementation note for executor: ensure delete/move in `panel.ts` still calls the API path; no DOM-write fallback.)
