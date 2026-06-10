# Spec — In-place playlist enhancement (y3s v0.2)

Date: 2026-06-10
Status: Approved (pending spec review)

## Why

v0.1 ships a floating right-side **drawer** you open with a rail click. The
product direction has shifted: *install → the playlist page is simply better,
no clicks, minimal setup.* This spec reworks the presentation from a separate
drawer into an **in-place enhancement** of the YouTube playlist page, with a
**hybrid** data model so it works instantly without sign-in.

This is a remount, not a rewrite: the stores, operation planner, and all the
list/toolbar/phase/selection UI are reused. The change is concentrated in the
content/mount layer, a new DOM scraper, hybrid loading, and styles.

## Locked decisions (from brainstorming)

1. **Interaction:** enhance in-place — no separate drawer/rail. A toolbar plus
   our rendered list live inside the playlist page.
2. **Render strategy:** we render **our own rows** inside YouTube's playlist
   column (full data, phases, grouping, fast search), styled to blend. The
   native list is hidden while ours is shown, with a **"Show original"** toggle.
3. **Data source:** **hybrid** — paint instantly from the page DOM (zero
   sign-in), then silently upgrade to full API data if a token already exists.
4. **Editing:** API-only writes via the planner + confirmation, unchanged. OAuth
   is requested only on the first write. No DOM-click writes, ever.
5. **Scope:** target the **`/playlist?list=`** page only. Watch pages
   (`/watch?…&list=`) are out of scope for v0.2 (see Non-goals).

## Goals

- On a playlist page, with **no setup**, the user immediately gets: our clean
  list, search, sort, filter chips, multi-select, drag-select, phases, keyboard
  shortcuts — all driven by data scraped from the page.
- When signed in, data upgrades to the complete, accurate API snapshot.
- Destructive edits (delete; move to top/bottom) work via the API behind the
  existing confirmation + operation planner, prompting sign-in on first use.
- A breakage in YouTube's markup degrades gracefully (visible "couldn't attach"
  state), never a silent disappearance.

## Non-goals (v0.2)

- Watch-page (`/watch`) enhancement. The content script still loads there but
  renders nothing; revisit later.
- Apply-sort-to-YouTube, JSON phase export/import, duplicate one-click removal,
  YT Music — remain TODOs as in v0.1.

## Architecture changes

### Added
- `src/content/mount-point.ts` — Resolve YouTube's playlist content column with
  resilient selectors (+ fallbacks). Inject the Shadow-DOM root as its first
  child; hide the native list while active; expose `attach()/detach()` and a
  "Show original" toggle. Owns re-resolution on SPA navigation.
- `src/content/youtube-scrape.ts` — Read currently-rendered playlist rows
  (`ytd-playlist-video-renderer` et al.) into a `PlaylistSnapshot` with
  `source: "dom"`. Extract videoId from the title anchor, channel, thumbnail,
  duration badge, and DOM index for position. Provide `scrape()` and an
  `autoScrollLoadAll()` helper that scrolls to force-load remaining rows.

### Changed
- `src/content/overlay-root.ts` → repurposed/renamed to host the in-column panel
  instead of a floating drawer. It builds the Shadow root, injects styles,
  instantiates stores, renders **toolbar + list + toast** (no rail, no slide-in
  drawer), and wires the "Show original" toggle. (Rename to `panel-root.ts`.)
- `src/content/content-script.ts` — On a `/playlist` URL: resolve mount → attach
  panel → start hybrid load. Hide/teardown when navigating away. Keep the
  broad `youtube.com/*` match + SPA nav handling from the v0.1 fix.
- `src/state/playlist-store.ts` — Two-stage hybrid load:
  `loadHybrid(playlistId)` → (a) set DOM snapshot immediately; (b) if
  `AUTH_STATUS.signedIn`, fetch API snapshot and swap, reconciling by `videoId`
  (preserve selection + phase assignments). Track `source: "dom" | "api"`.
  Add `PlaylistSnapshot.source`.
- `src/ui/drawer.ts` → trimmed into `panel.ts`: same composition logic
  (search/filter/sort/group, selection, delete/move flows) minus the
  open/close/slide-in drawer concerns. The header loses the close button; gains
  a sync-status badge ("page view" / "synced") and the "Show original" toggle.
- `src/styles/content.css` — Replace the fixed right-drawer shell rules with an
  in-column panel container (full width of the playlist column, blends with
  YouTube's dark theme). All token/row/phase/toolbar/modal/toast rules are kept.
- `src/shared/types.ts` — add `source?: "dom" | "api"` to `PlaylistSnapshot`.

### Removed
- The rail button, slide-in drawer animation, and `action.onClicked`→toggle
  semantics (the action button can instead scroll to / focus the panel, or be
  dropped). Drag-select, shortcuts, etc. stay.

### Reused unchanged
- `src/state/{selection-store,phase-store,operation-planner,store,mock-data}.ts`
- `src/ui/{track-list,toolbar,phases,drag-select,shortcuts,toast,components}.ts`
- `src/background/{auth,youtube-api,service-worker}.ts`
- `src/shared/{constants,messages,utils}.ts`

## Data flow

```
playlist URL detected
   │
   ▼
mount-point.attach()  ── hide native list, inject Shadow root into column
   │
   ▼
playlist-store.loadHybrid(id)
   ├─ (a) youtube-scrape.scrape() ───────▶ snapshot{source:"dom"}  → paint NOW
   └─ (b) AUTH_STATUS.signedIn?
            └─ yes → FETCH_PLAYLIST_ITEMS ▶ snapshot{source:"api"} → swap in
                     (reconcile by videoId: keep selection + phases)
   │
   ▼
toolbar + our rows render in the column (search/sort/filter/phases/select)
   │
edit (delete / move) ▶ planner + confirm ▶ first write → interactive OAuth
                       ▶ resolve playlistItemId from API ▶ apply ▶ report
```

## Edge cases & error handling

- **Not signed in + edit:** prompt OAuth; on success fetch items, map
  videoId→playlistItemId, apply; on cancel show a clear toast, no mutation.
- **DOM has fewer rows than the real playlist (lazy load):** show count as
  "showing N of M" when known; offer "Load all" (auto-scroll) when not signed
  in; the API swap resolves it fully when signed in.
- **Mount column not found / markup changed:** render a small fixed fallback
  card ("y3s couldn't attach to this page") instead of silently doing nothing.
- **videoId missing on a scraped row:** skip that row from DOM snapshot; API
  snapshot will fill it.
- **Reconciliation:** API snapshot is source of truth when present; selection
  and phase assignments are keyed by videoId so they survive the swap.

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| YouTube changes playlist markup | Selectors isolated in `mount-point` + `youtube-scrape` with fallbacks; visible fallback state. |
| DOM/API mismatch confuses user | Source badge; "Load all"; API wins on swap. |
| Hidden native list surprises users | Persistent "Show original" toggle restores it instantly. |
| Auto-scroll jank on huge lists | Opt-in only; bounded; cancellable. |

## Acceptance criteria

1. Visiting `youtube.com/playlist?list=…` (incl. via SPA nav) shows the y3s
   panel in the column with the native list hidden, no clicks, no sign-in.
2. Search / sort / filter chips / multi-select / shift+range / Alt-drag /
   phases / shortcuts all function on the DOM-scraped data.
3. "Show original" toggles YouTube's native list back and forth.
4. When already signed in, the list upgrades to the full API snapshot with
   selection + phases preserved.
5. Deleting selected (and move-to-top/bottom) works via API with confirmation;
   first write prompts OAuth; partial failures are reported per item.
6. Markup-not-found renders the fallback card, not a blank/no-op.
7. `npm run typecheck` and `npm run build` pass.
