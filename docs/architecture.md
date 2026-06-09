# y3s — Architecture

y3s is a Manifest V3 Chrome extension that injects a Spotify-like playlist
workstation into regular YouTube playlist pages. It is **not** a popup app and
it does **not** target music.youtube.com.

## Text architecture diagram

```
                         ┌─────────────────────────────────────────────┐
                         │              YouTube page (SPA)              │
                         │  youtube.com/playlist?list=…  or  /watch?…   │
                         │                                              │
                         │   ┌──────────────────────────────────────┐  │
   page-detect.ts  ─────▶│   │  Injected root  (#y3s-root, ShadowDOM)│  │
   (reads URL only)      │   │  ┌────────────────────────────────┐  │  │
                         │   │  │ Drawer (right side)            │  │  │
                         │   │  │  header · search · chips       │  │  │
                         │   │  │  toolbar · track list · phases │  │  │
                         │   │  │  toast                         │  │  │
                         │   │  └────────────────────────────────┘  │  │
                         │   └──────────────────────────────────────┘  │
                         └───────────────────────┬──────────────────────┘
                                                 │ typed messages
                                                 │ (chrome.runtime)
                                                 ▼
                         ┌─────────────────────────────────────────────┐
                         │        Service worker (background)          │
                         │                                              │
                         │  auth.ts        → chrome.identity tokens     │
                         │  youtube-api.ts → fetch googleapis (CORS-OK) │
                         │  service-worker → message router             │
                         └───────────────────────┬──────────────────────┘
                                                 │ HTTPS + Bearer token
                                                 ▼
                         ┌─────────────────────────────────────────────┐
                         │           YouTube Data API v3                │
                         │  playlistItems.list / .update / .delete /    │
                         │  .insert  ·  playlists.list (metadata)       │
                         └─────────────────────────────────────────────┘

   chrome.storage.local  ◀── phases (per playlistId), UI prefs (later)
   runtime memory only   ◀── selection state
```

## Content script vs background responsibilities

**Content script (`/src/content`, `/src/ui`, `/src/state`)**

- Detect the playlistId from the URL (playlist page or watch page `&list=`).
- Inject a single Shadow-DOM root; respond to SPA navigation.
- Render the entire drawer UI and own all interaction (search, selection,
  drag-select, phases, shortcuts).
- Hold the in-memory playlist snapshot + selection.
- Read/write phase metadata in `chrome.storage.local`.
- **Never** touch OAuth tokens or call googleapis directly.

**Background / service worker (`/src/background`)**

- Own `chrome.identity` and all OAuth tokens.
- Be the single place that talks to the YouTube Data API (keeps tokens out of
  the page and sidesteps content-script CORS limits).
- Route typed messages (`/src/shared/messages.ts`) and return a uniform
  `{ ok, data } | { ok, error }` envelope.

Why the split: tokens never enter the page, API host permissions live in one
place, and the content script stays focused on UI/state.

## API write flow (example: delete selected)

```
User selects rows ─▶ clicks Delete
     │
     ▼
operation-planner.buildDeletePlan(selectedTracks)
     │  → { type:"delete", estimatedApiCalls, estimatedQuotaCost, operations[] }
     ▼
Confirmation modal shows count + quota cost + summary
     │  user confirms
     ▼
For each op: content → DELETE_PLAYLIST_ITEM(playlistItemId) → background
     │                                   │
     │                                   ▼  auth.getAuthToken(false→true on 401)
     │                                   ▼  youtube-api.deletePlaylistItem()
     │  ◀── per-item { ok } / { error }
     ▼
Collect results → update snapshot → toast summary
     │  on partial failure: list which items failed and why (no silent mutate)
```

Position/sort writes follow the same plan→confirm→apply path but are gated
behind a stronger warning (quota + "playlist must be manually sortable").

## Local phase metadata flow

- Phases are **extension-only** metadata. YouTube playlists are flat; we never
  try to create real headers on YouTube.
- Stored in `chrome.storage.local` under key `y3s:phases:<playlistId>` as an
  array of `Phase` records.
- A phase references tracks by `videoId` (`trackVideoIds`) and optionally
  anchors before a video (`beforeVideoId`) so it can survive reorders.
- `phase-store.ts` loads on drawer open, mutates in memory, and persists on
  change. Selection is **not** persisted (runtime only).
- Export/import to JSON is a documented TODO that serializes the same array.

## OAuth scope (chosen)

**`https://www.googleapis.com/auth/youtube`**

This is the minimum scope that grants read + write to the authenticated user's
own playlists, which is what `playlistItems.insert/update/delete` require.
We deliberately avoid broader scopes (`youtubepartner`, full account
management beyond YouTube). Read-only scopes are insufficient because the MVP
performs real deletes.

Configured in `manifest.json` under the `oauth2` key alongside the OAuth client
ID. See `README.md` for Google Cloud setup.

## Known risks

- **Quota:** writes cost 50 units each; a full re-sort can consume the entire
  10k/day quota. Mitigated by the operation planner + mandatory confirmation.
- **Manual-sort constraint:** position edits fail unless the playlist is set to
  manual ordering. Surfaced as a specific error.
- **SPA fragility:** YouTube re-renders without reloads; navigation hooks keep
  the root in sync and avoid duplicate injection.
- **Ownership:** only the owner can edit; 403s are surfaced plainly.
- **No DOM-write fallback:** if an API write fails, we show an error. We never
  fall back to clicking YouTube's UI.

## Build

- TypeScript bundled with **esbuild** (`scripts/build.mjs`).
  - `content-script.ts` → `dist/content.js` (IIFE, CSS imported as text and
    injected into the shadow root).
  - `service-worker.ts` → `dist/service-worker.js` (ESM module worker).
  - `manifest.json` + icons copied to `dist/`.
- No framework. Plain TypeScript modules + plain CSS with design tokens.
