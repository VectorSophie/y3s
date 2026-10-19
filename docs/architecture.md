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
