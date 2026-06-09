# y3s — Research & Implementation Notes

> Internal note written before implementation. Purpose: capture what comparable
> projects do, what to avoid, and the hard constraints of editing YouTube
> playlists through the official API.

## Reference projects

### rydama/youtube-playlist-sorter

- **Does well:** Clean use of `chrome.identity.getAuthToken` + the YouTube Data
  API. Sorts a playlist by issuing `playlistItems.update` calls with new
  `snippet.position`. Good reference for the OAuth/manifest wiring and the exact
  shape of `playlistItems` resources.
- **Avoid:** It is a separate-app / popup-first UX. You leave the playlist page
  to use it. We want the opposite — an overlay *on* the playlist page.
- **Takeaway:** Reuse its API-call structure (position updates one item at a
  time, sequentially, to keep ordering deterministic). Do not reuse its
  navigation model.

### soufianesakhi/youtube-playlist-helper

- **Does well:** A real editor data model (tracks as records, not DOM scraping),
  import/export of playlist data, and duplicate detection.
- **Avoid:** Feature sprawl. We keep the MVP tight (search, select, phases,
  delete) and stub the rest behind clear TODOs.
- **Takeaway:** Model the playlist as an array of typed `Track` records fetched
  from the API. Keep duplicate-detection as a client-side pass over that array.

### nikmedoot/YTautoPlaylist (nikmedoot)

- **Does well:** Augments the actual YouTube page, supports bulk operations,
  shift-click range selection, and drag-and-drop list management. This is the
  closest UX to what we want.
- **Avoid:** Any reliance on clicking YouTube's own DOM controls to perform
  writes — fragile and breaks on every YouTube redesign.
- **Takeaway:** Injected UI + shift-click + drag interactions are the model.
  But our *writes* go through the API, never through synthetic DOM clicks.

## How YouTube playlist item position editing actually works

- A playlist is a **flat, ordered list** of `playlistItem` resources. There are
  no native sections/headers — "phases" in y3s are extension-only metadata.
- Each item has a stable `id` (the **playlistItemId**, distinct from the
  `videoId`) and a `snippet.position` (0-based index).
- To move an item you call `playlistItems.update` with the item's `id`, its
  `snippet.resourceId`, `snippet.playlistId`, and the new `snippet.position`.
  You **must** send the full snippet, not a partial patch.
- Reordering N items is **N sequential update calls**. The API re-indexes other
  items automatically when you set a position, so order matters: apply moves
  one at a time and re-derive positions from the intended final order.
- **Manual-sort requirement:** position edits only work if the playlist's
  ordering is "Manual". If the owner set the playlist to auto-order (e.g. "Date
  added (newest)"), `update` with a position is rejected / ignored. We must
  detect this and surface a clear error rather than retrying.
- **Ownership:** you can only edit playlists owned by the authenticated account.
  Editing someone else's playlist returns a 403.

## API quota concerns

YouTube Data API v3 has a default **10,000 units/day** quota.

| Operation              | Method                   | Cost (units) |
| ---------------------- | ------------------------ | ------------ |
| List items (per page)  | `playlistItems.list`     | 1            |
| Delete item            | `playlistItems.delete`   | 50           |
| Update position        | `playlistItems.update`   | 50           |
| Insert item            | `playlistItems.insert`   | 50           |

Implications:

- **Reads are cheap** (1 unit/page, 50 items/page → a 500-item playlist is ~10
  units to fully load). Cache the snapshot locally and avoid re-fetching.
- **Writes are expensive** (50 units each). A full re-sort of a 200-item
  playlist is ~200 updates ≈ **10,000 units = the entire daily quota.** This is
  why sort-to-YouTube must show a confirmation with the projected call count and
  quota cost, and why it's a later/TODO feature, not a casual button.
- The **operation planner** exists precisely to compute and display these
  numbers *before* the user commits.

## Authentication flow

1. User opens the drawer and triggers an action that needs the API.
2. Content script sends an `AUTH_GET_TOKEN` message to the service worker.
3. Service worker calls `chrome.identity.getAuthToken({ interactive })`.
   - First call is interactive → Google consent screen.
   - Later calls are silent (cached token).
4. Token is held in the **background** only; the content script never sees raw
   tokens. All authenticated `fetch`es to googleapis happen in the background.
5. On 401, the worker calls `removeCachedAuthToken` + retries once interactive.
6. Scope: minimum needed to edit playlist items — see `architecture.md`.

## DOM injection concerns

- YouTube is a single-page app (`yt-navigate-finish` events, History API). The
  URL changes without a full reload, so we hook navigation and re-evaluate
  whether we're on a supported playlist page.
- Inject exactly **one** root container; guard against duplicates by id.
- Use **Shadow DOM** for the drawer so YouTube's global CSS can't bleed in and
  ours can't leak out. Inline our stylesheet into the shadow root.
- Treat the YouTube DOM as **page context only** — to know the playlistId, to
  anchor the drawer, to highlight. It is **never** the source of truth for
  writes; that's always the API snapshot.

## Main risks & mitigations

| Risk                                            | Mitigation                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| YouTube redesign breaks DOM anchors             | Minimal DOM coupling; only read URL + attach a fixed-position root.   |
| Quota exhaustion from sorting                   | Operation planner + mandatory confirmation showing cost.             |
| Playlist not manually sortable                  | Detect update failure, show specific error, don't loop.             |
| Editing a playlist the user doesn't own         | Surface the 403 as "you don't own this playlist".                    |
| OAuth not configured (fresh clone)              | Mock mode: drawer still opens with sample data.                      |
| SPA navigation leaving a stale drawer           | Navigation hook re-detects playlistId and re-binds / tears down.     |
| CSS conflicts                                   | Shadow DOM + `pf-`/scoped tokens as fallback.                        |
| Partial write failures (some deletes succeed)   | Per-item result reporting; never assume all-or-nothing.              |
