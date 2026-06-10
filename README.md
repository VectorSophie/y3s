# y3s — *YouTube is Somehow Still Shit*

A Manifest V3 Chrome extension that injects a clean, Spotify-like **playlist
workstation** directly into regular YouTube playlist pages. It turns a flat
YouTube playlist into a searchable, selectable, sectioned editing interface —
right on top of the page, not in a cramped popup.

> Works on **regular YouTube** (`youtube.com`). It does **not** target
> `music.youtube.com`.

---

## What it is

y3s adds a right-side drawer to YouTube playlist pages. From there you can:

- **Search** inside the playlist (title / channel / video id), instantly.
- **Multi-select** tracks: click, shift-click ranges, Ctrl/Cmd-click toggles,
  and **Alt-drag** a selection rectangle over rows.
- Organise tracks into **Phases** — local-only subsections (think Spotify
  sections), stored per playlist. YouTube playlists are flat; phases are
  extension metadata, never written to YouTube.
- **Sort** (title, channel, current, reverse) as a local preview.
- Perform **real edits through the official YouTube Data API** — delete selected
  tracks, or move a selection to the top/bottom — always behind a confirmation
  that shows the API-call count and quota cost.

It's built as a **power-user tool**: dark YouTube base, subtle red accent,
keyboard-driven, and honest about what costs quota.

## Features

| Area        | What you get                                                            |
| ----------- | ----------------------------------------------------------------------- |
| Injection   | One Shadow-DOM drawer on `playlist?list=` and `watch?v=…&list=` pages.   |
| Search      | Fast client-side filtering.                                             |
| Selection   | Click, shift-range, Ctrl/Cmd-toggle, Alt-drag marquee, select-all.      |
| Phases      | Create / rename / delete / collapse, assign selection, "Unphased" group.|
| Sorting     | Title A–Z, channel A–Z, current, reverse (local preview).               |
| Editing     | Delete selected · move selection to top/bottom (real API writes).       |
| Planning    | Every write shows projected API calls + quota + risk before applying.   |
| Shortcuts   | `Esc`, `Ctrl/Cmd+A`, `/`, `Delete`, `P`, `S`.                           |
| Mock mode   | Works with sample data even before OAuth is configured.                 |

### Keyboard shortcuts (drawer focused)

- `Esc` — clear selection, or close the drawer
- `Ctrl/Cmd + A` — select all visible tracks
- `/` — focus search
- `Delete` / `Backspace` — delete selected (with confirmation)
- `P` — create a phase from the current selection
- `S` — sort hint

## Current limitations

- **Apply sort to YouTube** is not wired yet — sorting is a local preview. (The
  operation planner already computes the cost; see TODOs.)
- **Duplicate removal**, **export/import phases**, and **move-block** polish are
  partially stubbed (duplicates *filter* works; one-click removal is a TODO).
- Optimised for **small-to-medium playlists** (~100–500 items).
- **No DOM-write fallback.** If an API edit fails, y3s shows a clear error — it
  will never click YouTube's own controls to fake an edit.
- **YouTube Music is not supported.**

---

## Setup

You need a Google Cloud project with an OAuth client so the extension can call
the YouTube Data API on your behalf. This takes ~10 minutes the first time.

> Don't want to deal with Google Cloud yet? **Skip it.** Load the extension
> anyway and the drawer opens in **mock mode** with sample data so you can try
> the UI. Real editing just needs the steps below.

### 1. Build the extension

```bash
npm install
npm run build      # outputs to dist/   (npm run watch to rebuild on change)
```

### 2. Load the unpacked extension in Chrome

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select the **`dist/`** folder.
4. Copy the extension's **ID** (shown on its card) — you'll need it next.

### Faster setup with gcloud (optional)

If you have the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
installed, a helper script does the scriptable parts of steps 3–6 — creating
the project and **enabling the YouTube Data API v3** — then prints the exact
console links for the rest:

```bash
./scripts/gcloud-setup.sh my-project-id        # macOS / Linux / Git Bash
```
```powershell
.\scripts\gcloud-setup.ps1 -ProjectId my-project-id   # Windows
```

Heads-up: the **OAuth client ID itself cannot be created from gcloud** (or any
API). The "Chrome Extension" client type is Google Cloud Console–only — as are
the `gcloud iam oauth-clients` / `gcloud iap oauth-clients` commands, which only
make Workforce/IAP clients, not consumer ones. So the script automates project
+ API enablement and hands you off to the console for the consent screen and
client ID (steps 4–6 below).

### 3. Enable the YouTube Data API v3

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create
   (or pick) a project.
2. **APIs & Services → Library →** search **"YouTube Data API v3" → Enable**.

### 4. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen.**
2. User type **External** is fine for personal use. Fill in the app name and
   your email.
3. Under **Scopes**, you may add `.../auth/youtube` (the extension also requests
   it at runtime).
4. Under **Test users**, add **your own Google account** (required while the app
   is in "Testing" status).

### 5. Create the OAuth client ID (Chrome app type)

1. **APIs & Services → Credentials → Create credentials → OAuth client ID.**
2. Application type: **Chrome app** (a.k.a. "Chrome extension").
3. **Application ID:** use the pinned extension ID
   `jdahkeplppmncjgkfabngnclfieeledp` (see "About the extension ID" below). It
   matches what you copied in step 2 — because the ID is fixed by the manifest
   `key`, you can do this even before loading the extension.
4. Create it and copy the generated **client ID**
   (`xxxx.apps.googleapis.com` → actually `…apps.googleusercontent.com`).

### 6. Put the client ID in the manifest

Open **`manifest.json`** and replace the placeholder:

```json
"oauth2": {
  "client_id": "YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/youtube"]
}
```

Then rebuild and reload:

```bash
npm run build
```

…and click the **reload** icon on the extension's card in `chrome://extensions`.

### About the extension ID (already pinned)

`chrome.identity` ties the OAuth client to a specific extension ID. By default
an unpacked extension's ID is derived from its folder path and changes if you
move it — which would break the OAuth client.

This repo **pins the ID** via a committed `key` field in `manifest.json`, so the
ID is stable everywhere and known before you even load the extension:

```
jdahkeplppmncjgkfabngnclfieeledp
```

Use that as the **Application ID** when creating the OAuth client (step 5). The
private signing half lives in `key.pem` (generated by `scripts/gen-key.mjs`,
gitignored); you only need it to pack a `.crx`, not to load unpacked. To rotate
the key, delete `key.pem` and run `node scripts/gen-key.mjs --write`.

### 7. Use it

Open any playlist you own, e.g.
`https://www.youtube.com/playlist?list=…`, click the **y3s** rail on the right
(or the toolbar icon), and the drawer slides in. The first real edit triggers
the Google sign-in consent flow.

---

## OAuth scope

y3s requests the minimum scope that allows editing your own playlists:

```
https://www.googleapis.com/auth/youtube
```

See [`docs/architecture.md`](docs/architecture.md) for why, and the
content-script ↔ background split that keeps tokens out of the page.

## Quota, briefly

Reads are cheap (1 unit/page). **Writes cost 50 units each**, against a default
**10,000 units/day**. A full re-sort of a few hundred items can consume the
whole daily quota — which is exactly why every write shows its projected cost
and asks for confirmation. Details in
[`docs/research-notes.md`](docs/research-notes.md).

## Architecture

- `src/content` — page detection, SPA-navigation handling, the injected root.
- `src/ui` — drawer, track list, toolbar, phases, drag-select, shortcuts, toast.
- `src/state` — playlist / selection / phase stores + operation planner.
- `src/background` — `chrome.identity` auth and the YouTube Data API client.
- `src/shared` — types, constants, typed messages, utilities.

Full diagram in [`docs/architecture.md`](docs/architecture.md).

## Roadmap / TODO

- [ ] **Apply sort to YouTube** (the planner already costs it; wire the writes).
- [ ] **Export / import phases** as JSON.
- [ ] **Move selected block** with finer position control.
- [ ] **One-click duplicate removal** (detection already powers the filter).
- [ ] **YouTube Music** support.

## Disclaimer

This is **personal / open-source tooling**, not a Chrome Web Store product. It
edits real playlists through official Google APIs — use it on playlists you own,
and remember that deletes are real. There is **no DOM-automation fallback**: if
the API says no, y3s tells you why instead of faking it.

## License

MIT.
