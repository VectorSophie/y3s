# y3s — *YouTube is Somehow Still Shit*

A Manifest V3 Chrome extension that adds power tools to YouTube's own playlist
pages: filter, sort, multi-select, keyboard navigation and bulk edits. Nothing
is replaced; the tools sit in YouTube's page and use YouTube's own look
(chips, menus, checkboxes, the bottom-left message with **Undo**), following
your light or dark theme.

> Works on **regular YouTube** (`youtube.com`), not `music.youtube.com`.

## What you get

**On a playlist page**

- **Filter** the playlist as you type (title, channel or video id). Press `/`.
- **Chips:** *Duplicates* (with **Remove extra copies**), *Unavailable*
  (including the ones YouTube hides, with **Remove N unavailable**), and
  **Sort**: title, channel, shortest, longest, reverse, shuffle, or back to
  playlist order.
- **Select** with the checkbox that appears on hover, shift-click for a range,
  or the keyboard. The bar becomes **N selected · Play · Move to top ·
  Move to bottom · Remove**.
- **Play** a selection as a temporary queue (first 50).
- **Load all** pulls in the rest of a long playlist so filters cover it.
- Total runtime next to the video count.

**On a watch page** with a playlist: a filter field in the playlist panel
(Enter plays the first match) and **Jump to now playing**.

### How edits are saved

Edits show on the page immediately, with **Undo** in the bottom-left message.
About 6 seconds later they're saved to YouTube through the official YouTube
Data API. Undo inside that window and nothing is sent.

- y3s works out the fewest writes needed: moving 3 videos costs 3 writes,
  whatever the playlist size.
- Batches over 20 writes ask first and show the quota cost.
- Reordering loads the whole playlist first, so positions are exact.
- On playlists you don't own, sorting only changes what you see; Move and
  Remove are hidden.
- If YouTube shows the playlist in a non-manual order (e.g. *Date added*),
  reordering is turned off until you set YouTube's Sort to *Manual*. Removing
  still works.
- If a save fails (quota, network), y3s says how far it got and asks you to
  reload; it never clicks YouTube's own buttons to fake an edit.

### Keyboard (playlist page)

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `j` / `k` | Next / previous video | `t` / `b` | Move selection to top / bottom |
| `Shift`+`j`/`k` | Extend selection | `Delete` | Remove selection |
| `x` | Select / deselect | `z` | Undo |
| `Enter` | Play | `Esc` | Clear filter or selection |
| `/` | Filter | `g` / `Shift`+`g` | First / last video |
| `?` | All shortcuts | | |

No extra keys on the watch page, where YouTube's player shortcuts apply.

## Limitations

- Saving needs the Google Cloud setup below (one-time, ~10 minutes).
- Each write costs 50 of the default 10,000 daily API units, so about 200
  writes a day. A full re-sort of a big playlist can use most of that.
- y3s reads YouTube's page markup. When YouTube changes it, the fix goes in
  `src/content/yt-dom.ts`.

---

## Setup

You need a Google Cloud project with an OAuth client so the extension can call
the YouTube Data API on your behalf. This takes ~10 minutes the first time.

> Without this you can still filter, sort and select; saving edits needs it.

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

If you're using your own Google Cloud project, open **`manifest.json`** and
replace the `client_id` with yours:

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

Open any playlist you own (`https://www.youtube.com/playlist?list=…`). The
filter bar appears above the list. The first time you edit, click
**Sign in to edit** and approve the Google consent screen.

## OAuth scope

y3s requests the minimum scope that allows editing your own playlists:

```
https://www.googleapis.com/auth/youtube
```

Tokens stay in the extension's background service worker and never reach the
page.

## Development

```bash
npm run build       # → dist/
npm test            # unit tests (vitest)
npm run typecheck
npm run test:e2e    # builds dist-e2e/ and drives it in headless Chromium
```

The end-to-end test loads the real extension against stand-in YouTube pages
and a fake YouTube Data API that keeps state, then checks what was actually
saved. It needs Chromium (Google Chrome won't load extensions from the
command line): run `npx playwright-core install chromium` once, or set
`CHROME_PATH` to a Chromium binary. `dist-e2e/`
skips Google sign-in; never load it in your own browser.

### Layout

- `src/core` — pure logic: filtering and sorting, matching page rows to
  playlist items, planning the fewest API writes.
- `src/content` — page integration: `playlist-tools.ts`, `panel-tools.ts`,
  `yt-dom.ts` (every YouTube selector), and `ui/` (snackbar, menu, dialogs).
- `src/background` — `chrome.identity` sign-in and the YouTube Data API client.
- `src/styles/content.css` — styles built on YouTube's own theme variables.

## Roadmap

- Drag a selected block with YouTube's drag handles.
- Copy/move videos to another playlist.
- Play the filtered results; shuffle without repeats.
- Optional saving through YouTube's own endpoints (no Google Cloud setup).

## Disclaimer

Personal / open-source tooling, not a Chrome Web Store product. It edits real
playlists through official Google APIs; use it on playlists you own.

## License

MIT.
