# y3s — Architecture (v0.4)

y3s adds tools to YouTube's own playlist page and watch-page playlist panel.
It doesn't replace YouTube's list: it decorates the rows YouTube renders and
inserts a filter bar above them, styled with YouTube's theme variables.

```
 YouTube page (SPA)                          Service worker
 ┌─────────────────────────────────┐        ┌──────────────────────────────┐
 │ content-script.ts  (mount loop) │        │ auth.ts   chrome.identity    │
 │  ├─ playlist-tools.ts           │ typed  │ youtube-api.ts  Data API v3  │
 │  │   filter bar, chips, sort,   │ msgs   │ service-worker.ts            │
 │  │   checkboxes, selection bar, │◀──────▶│   APPLY_CHANGES runs writes  │
 │  │   keyboard, save queue       │        │   in order, reports progress │
 │  ├─ panel-tools.ts (watch page) │        └──────────────┬───────────────┘
 │  └─ yt-dom.ts  (all selectors)  │                       │ HTTPS + token
 │ core/  filter · match · plan    │                       ▼
 └─────────────────────────────────┘             YouTube Data API v3
```

## The edit → save path

1. An edit (move, remove, sort) changes the page at once and pushes an undo
   snapshot. The snackbar shows **Undo**.
2. After `SAVE_DELAY_MS` (6 s) without undo, `pendingChanges()` compares the
   page with the last known server list:
   - `core/match.ts` links each row to its playlistItem (repeated videos are
     paired in order of appearance).
   - `core/plan.ts` builds deletes, then the fewest moves (everything off the
     longest increasing run moves; positions are replayed so each
     `playlistItems.update` lands exactly). Videos YouTube hides keep their
     place next to the row they followed.
3. More than `CONFIRM_WRITES_OVER` writes → confirm dialog with quota cost.
4. The service worker applies the changes in order and stops at the first
   error, reporting how many succeeded. The page updates its server list from
   what actually applied.

## Phases

Dividers are real elements placed among YouTube's rows. All phase operations
(`core/phases.ts`) work on the sequence of row keys and divider markers and
the page re-applies the result, so membership is purely positional and the
save path above sees only the row order. Each divider is stored per playlist
in `chrome.storage.local` as "after this row" (playlistItemId, or video id +
which copy), restored folded on load, re-placed as lazy-loaded rows arrive,
and put back if YouTube re-renders the list.

## Phase playback

`core/phase-play.ts` holds a per-tab session (sessionStorage): the phase's
videos, play order, loop/shuffle. `content/phase-player.ts` drives it on the
watch page and in the miniplayer: it finishes each phase video a moment
before the end and opens the next one (or lets YouTube's autoplay do it when
that's the same video), sends the player back if autoplay lands outside the
phase, takes over the player's ⏮ ⏭ and Shift+P/N (YouTube Music: j/k), and
puts its controls into the player bar.

## Sites

`content/yt-dom.ts` has one selector set per site (YouTube, YouTube Music);
everything else goes through it. The toolbar icon opens a page check that
counts what each selector finds, without page content, for quick fixes when
YouTube changes its markup.

## Guards

- Ownership: `playlists.list` channel vs `channels.list?mine=true`. Not yours
  → view only (sorting is page-only, no Move/Remove).
- Order: if the rows YouTube shows aren't in playlist order (its Sort is not
  *Manual*), reorders are refused; deletes still save.
- Reorders load the whole playlist first.

## Testing

- `tests/*.test.ts` — vitest + jsdom: planner (randomized), matching,
  filters, the page tools against a fake backend, the service worker's
  write loop against mocked fetch.
- `tests/e2e/` — the built extension in headless Chromium, stand-in YouTube
  pages, and a stateful fake Data API; asserts on the saved playlist.
