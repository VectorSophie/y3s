# y3s — notes for Claude Code

Chrome MV3 extension that adds playlist power tools **inside** YouTube's and
YouTube Music's own pages (no replacement UI). Owner: VectorSophie.

## Where things stand (2026-10-19)

- v0.4 is on **`main`** (PR #1, `feat/v0.4-native`, merged 2026-10-19). It
  replaced the old v0.2 panel / v0.3 QoL layer entirely.
  `prototype/native-demo` is a throwaway DOM-only demo; ignore it.
- **Not yet verified on the live sites.** Everything is tested against mock
  pages (`tests/e2e/fake-youtube.mjs`) that copy YouTube's element names.
  First job with a real browser: load `dist/`, open a playlist / watch page /
  music.youtube.com playlist, click the y3s toolbar icon (**page check**:
  counts of what each selector finds, no content) and fix
  `src/content/yt-dom.ts` where counts are 0. YouTube Music selectors are the
  least certain.
- The owner tested v0.4 + drag-select + phases on real YouTube and liked it;
  phase playback, player-bar controls, Save to…, Watch Later, the sheet
  filters and YouTube Music came after and are untested live.

## Commands

```bash
npm install
npm run build        # → dist/ (load unpacked in chrome://extensions)
npm run typecheck
npm test             # vitest + jsdom, ~104 tests
npm run test:e2e     # builds dist-e2e/ and drives it in headless Chromium
```

e2e needs Chromium that loads extensions (not Google Chrome):
`npx playwright-core install chromium` once, or `CHROME_PATH=...`.
`dist-e2e/` fakes sign-in and talks to a local fake API — never load it in a
real browser. Screenshots land in `tests/e2e/out/` (gitignored).

## Layout

- `src/core/` — pure logic, unit-tested: `filter.ts` (query, chips, sorts),
  `match.ts` (page rows ↔ playlistItems, manual-order check), `plan.ts`
  (fewest API writes: deletes, then moves off the longest increasing run),
  `phases.ts` (divider sequence ops + anchors), `phase-play.ts` (play
  session: order, loop, shuffle, back).
- `src/content/` — page integration:
  - `yt-dom.ts` — **every selector**, one set per site (`SEL`, `site()`).
  - `playlist-tools.ts` — the playlist page: filter bar, chips, sort,
    selection bar, keyboard, phases UI, save queue with undo window,
    Save to…, view-only rules (`SPECIAL_LISTS` for WL/LL/LM).
  - `drag-select.ts` — left-button drag marquee with edge auto-scroll.
  - `phase-player.ts` — keeps playback inside a phase on the watch page and
    in the miniplayer; player-bar controls; takes over ⏮ ⏭, Shift+N/P
    (Music: j/k).
  - `panel-tools.ts` — watch-page playlist panel filter + jump to current.
  - `phase-store.ts` — dividers per playlist in `chrome.storage.local`.
  - `extras.ts` — search in YouTube's Save-to sheet; `/feed/playlists` filter.
  - `page-check.ts` — toolbar-icon diagnostics dialog.
  - `backend.ts` — interface to the service worker (tests use a fake).
  - `ui/` — `h()` DOM builder, icons, snackbar, menu, dialogs, pick dialog.
- `src/background/` — `auth.ts` (chrome.identity), `youtube-api.ts` (Data API
  v3), `service-worker.ts` (message router, ordered write queue per playlist,
  progress pushes, toolbar → page check).
- `src/styles/content.css` — built on YouTube's `--yt-spec-*` variables with
  light/dark fallbacks; `html.y3s-music` overrides for YouTube Music.
- `docs/architecture.md` — save path, phases, playback, guards. Older files in
  `docs/superpowers/` describe v0.2/v0.3 and are historical.

## Decisions (and why)

- **Augment, don't replace.** Decorate YouTube's own rows, insert a bar above
  the list, reuse YouTube's look. The old custom panel "looked foreign".
- **Official Data API for writes** (owner's OAuth client is in
  `manifest.json`, extension ID pinned by `key`). YouTube's internal
  endpoints were considered (no quota, no setup) but are unverifiable from
  here; keep writes behind `Backend`/service worker so they can be added.
- **Edits apply instantly, save after a 6 s undo window** (`SAVE_DELAY_MS`),
  diffing page vs server list. >20 writes → confirm with quota cost.
  Reorders first load the whole playlist. Non-manual YouTube sort → no
  reorders (deletes still save). Not owner → view only.
- **Phases are positional dividers**, stored locally per playlist, restored
  folded. Moving phases/videos is a real reorder; the dividers never touch
  YouTube. Selecting one video (or a contiguous run) + New phase splits;
  a scattered selection is gathered.
- **Phase playback** stays in the real playlist (sessionStorage per tab).
  Natural next = let YouTube autoplay; edges/shuffle = y3s navigates, and
  corrects autoplay if it lands outside.

## Gotchas learned the hard way

- Live YouTube (2026-10): theme variables are `--yt-sys-color-baseline--*`
  (the `--yt-spec-*` ones are gone from `html`); the player is the "delhi"
  design: controls are translucent 40 px pills (`.ytp-right-controls` holds
  `-left`/`-right` groups). y3s's player controls are their own pill placed
  before it. Durations are in `.ytBadgeShapeText`.
- YouTube enforces **Trusted Types**: never use `innerHTML`; build with `h()`.
- `el?.focus() ?? other.focus()` always runs the fallback (focus returns
  undefined). Dialog autofocus had this bug.
- `display: … !important` on a class beats `[hidden]`; add an explicit
  `[hidden]` rule for such elements.
- YouTube lazy-loads when its continuation marker *enters* the view. With
  phases folded the marker never leaves, so `loadAll()` unfolds while
  loading and scrolls the marker out and back when stuck.
- In e2e, "Load all link hidden" also happens *during* loading; wait for no
  continuation and the full row count.
- Moving a block with the planner can take fewer writes than you expect
  (moving rows 2–4 to top = 1 write). Don't assert exact counts carelessly.
- The selection bar is two rows inside the filter bar's 84 px so the list
  doesn't jump; labels collapse to icons via a container query (<860 px).

## Open items

1. Live-site check with the page check; fix selectors (Music especially).
2. YouTube Music gaps: no queue-panel filter; phase steps reload the player
   page (queue items have no links); phase playback idles while browsing
   off the player page.
3. Miniplayer (checked live 2026-10-26): it has **no playlist rows**. y3s
   reads the playlist from its ⏭ link and the position from the info bar's
   "N / M". Natural next plays on in the miniplayer; a jump (phase edge,
   shuffle) reopens the watch page.
4. Roadmap: drag a selected block to a new position; play filtered results;
   optional internal-endpoint saving; Firefox/Edge builds.
5. Tag a 0.4.0 release once the live-site check passes.

## Working with the owner

Wants things to look and feel native to YouTube; prefers being asked about
design choices with concrete options; tests on real YouTube and reports back
briefly. Keep commits focused, run unit + e2e before pushing.
