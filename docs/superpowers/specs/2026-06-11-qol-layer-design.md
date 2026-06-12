# Spec — Non-invasive QoL layer (y3s v0.3)

Date: 2026-06-11
Status: Approved (pending spec review)
Branch: `feat/v0.3-qol-layer`

## Why

v0.2 replaces YouTube's native playlist list with our own panel — a large UI
change. v0.3 explores the **inverse philosophy**: leave YouTube's UI essentially
untouched and layer **maximal quality-of-life** enhancements on top. We index
the native rows, add one slim sticky toolbar, and annotate native rows with tiny
markers. No takeover.

This is a separate, exploratory **version** (its own branch). The v0.2 panel
code stays in the tree as a dormant alternate mode; this branch's content script
mounts the QoL layer instead.

## Locked decisions (from brainstorming)

1. **Non-invasive:** never replace the native list. Index it, add a slim
   toolbar, annotate rows.
2. **First milestone = "Phase 1 + bulk":** shared infra + find/filter + duplicate
   highlight + runtime badge + keyboard navigation + copy/export **plus** bulk
   select → delete-via-API + open-in-tabs.
3. **Drag work is deferred** to a later phase on the same branch (detect native
   reorders; our own drag-multiselect / drag-to-reorder). Out of scope here.
4. **Chosen behavioural defaults (approved):**
   - Search **hides** non-matching rows (`display:none`), matching title/channel.
   - Duplicates flagged by **same videoId** (the real "added twice" case).
   - Runtime badge sums **currently-loaded** rows, labelled `H:MM:SS · N of M`.
   - Bulk delete reuses the **API write-gate** (sign-in → resolve playlistItemIds
     → planner + confirmation → delete → optimistically hide rows). No fake DOM
     edits.

## Goals

- On a `/playlist` page, with zero sign-in: a slim toolbar appears; the user can
  filter the list as they type, see duplicates highlighted, see total runtime,
  navigate by keyboard, and copy/export the list.
- Bulk select via checkboxes layered on native rows, then delete selected through
  the official API (sign-in prompted on first write) or open them in tabs.
- The native YouTube list otherwise looks and behaves exactly as normal.

## Non-goals (v0.3 first milestone)

- All drag features (deferred to a later phase).
- Sort / reorder writes (deferred with drag).
- Phases/sections (that's the v0.2 panel's domain).
- Watch pages — `/playlist` only.

## Architecture

### Two style surfaces

- **Shadow-DOM host** (`#y3s-qol-root`): holds our toolbar, toast, and modals.
  Styles isolated from YouTube. Injected as the first child of the playlist
  column (reuse `mount-point.ts` for placement, WITHOUT hiding the native list).
- **Light-DOM stylesheet** (`<style id="y3s-annotations">` in `document.head`):
  the only place that can style native rows. Defines `y3s-`-prefixed annotation
  classes we toggle on YouTube's row elements.

### Modules

Added:
- `src/content/native-list.ts` — indexer. Resolves the row elements
  (`ytd-playlist-video-renderer`), maps each → `NativeRow { videoId, title,
  channel, durationText, durationSec, el, index }`. MutationObserver on the list
  container + SPA nav re-index. Emits change events. Selectors isolated here.
- `src/content/annotations.ts` — injects the light-DOM stylesheet; functions to
  set/clear `y3s-row--hidden | --dup | --selected | --focused` on a row element
  and to insert/remove the checkbox affordance.
- `src/ui/qol-toolbar.ts` — the sticky toolbar view (search input, selected
  count, runtime+count badge, duplicate count + jump, bulk delete, open-in-tabs,
  export menu). Callback-driven.
- `src/ui/keyboard-nav.ts` — focus-ring navigation over visible rows + key
  bindings; scoped to the playlist page, ignores typing in inputs.
- `src/state/exporters.ts` — pure serializers: `toJSON`, `toCSV`, `toMarkdown`
  over `NativeRow[]`; plus `copyToClipboard` / `downloadFile` helpers.
- `src/content/qol-root.ts` — orchestrator. Builds the shadow host (toolbar +
  toast), owns view state (query), wires indexer ↔ `SelectionStore` ↔
  annotations ↔ toolbar ↔ keyboard, and runs bulk actions.

Changed (this branch):
- `src/content/content-script.ts` — on `/playlist`, mount `QolRoot` instead of
  `PanelRoot`. Keep the broad `youtube.com/*` match + SPA handling.
- `src/content/mount-point.ts` — add an option to attach WITHOUT hiding the
  native list (`createMount({ hideNative: false })`), reused for the toolbar host.

Reused unchanged:
- `src/state/selection-store.ts`, `src/state/operation-planner.ts`
- `src/background/{auth,youtube-api,service-worker}.ts`
- `src/ui/{toast,components}.ts`, `src/shared/*`, `src/content/page-detect.ts`
- vitest + jsdom harness.

## Data flow

```
/playlist detected
  │
  ▼
QolRoot: createMount({hideNative:false}) → shadow host (toolbar+toast)
         annotations.injectStylesheet()
  │
  ▼
native-list.index()  ── MutationObserver + SPA nav ──▶ NativeRow[]
  │                                   │ (re-index on lazy-load / reorder)
  ▼                                   ▼
toolbar renders: runtime badge, dup count        annotations: mark dups
  │
  ├─ search input ─▶ filter predicate ─▶ annotations: hide non-matches
  ├─ keyboard ─────▶ focus ring + actions (open/copy/select/top/bottom)
  ├─ checkbox/x ───▶ SelectionStore (by videoId) ─▶ annotations: mark selected
  ├─ export ───────▶ exporters → clipboard / file
  ├─ open-in-tabs ─▶ window.open per selected (confirm if >10)
  └─ delete ───────▶ ensureApiData (sign-in + resolve playlistItemIds)
                     ─▶ buildDeletePlan ─▶ confirm modal ─▶ API delete
                     ─▶ optimistically hide deleted rows ─▶ toast summary
```

## Error handling

- **List/rows not found:** `native-list` returns empty; toolbar still renders
  with a small "couldn't read this playlist's rows" note. Never a hard crash.
- **Not signed in on delete:** prompt interactive OAuth; on cancel, abort with a
  toast, no mutation.
- **Can't resolve playlistItemId for a selected videoId** (e.g. API/DOM drift):
  skip it, report which ones couldn't be deleted.
- **Partial delete failure:** per-item reporting via toast; hide only the rows
  that actually deleted.
- **Lazy-loaded rows:** runtime/counts reflect loaded rows; label makes this
  explicit (`N of M`). (Auto-scroll "load all" is a later nicety, not required.)

## Testing

Unit (vitest + jsdom):
- `exporters`: JSON/CSV/Markdown output shape + escaping; clipboard/file helpers
  guarded.
- duration parse (`durationText` → seconds) + runtime sum formatting.
- duplicate detection (group by videoId).
- search predicate (title/channel match, case-insensitive).
- `native-list` indexer parses a jsdom fixture of rows into `NativeRow[]`.

Integration (build + manual checkpoint):
- toolbar renders in-column without hiding the native list.
- typing filters rows; duplicates highlighted; runtime badge correct.
- keyboard nav moves a focus ring and triggers actions.
- checkbox/x selection annotates rows; export copies/downloads.
- bulk delete prompts sign-in, deletes via API, hides rows, reports results.

## Acceptance criteria

1. On `youtube.com/playlist?list=…` the native list is visually unchanged except
   for a slim y3s toolbar at the top and optional small row markers.
2. Search hides non-matching rows live; clearing restores them.
3. Duplicate videos (same videoId) are highlighted; toolbar shows the count and
   can jump to the next.
4. Runtime badge shows summed loaded duration + `N of M` count.
5. Keyboard: `j/k` focus move, `/` search, `Enter` open, `x` select, `y` copy,
   `g/G` top/bottom — all scoped to the page, inert while typing.
6. Checkbox/`x` selection marks rows; "open in tabs" opens selected (confirm >10).
7. Export produces valid JSON, CSV, and Markdown of all-or-selected rows.
8. Bulk delete prompts sign-in, deletes via the API with confirmation + per-item
   result reporting, and hides deleted rows.
9. `npm run typecheck`, `npm test`, `npm run build` all pass.
