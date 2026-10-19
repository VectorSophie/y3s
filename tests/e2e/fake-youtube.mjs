// A stand-in for YouTube used by the end-to-end test:
//  - a fake YouTube Data API v3 (the subset y3s calls) that keeps real state,
//  - rough copies of YouTube's playlist and watch pages, rendered from that
//    state with the same custom-element names and ids YouTube uses.
// Titles and channels are invented.

import http from "node:http";

const CHANNELS = ["Night Drive FM", "Paper Lantern", "Studio Kettle", "Low Tide Radio", "Moss & Static", "Fieldnotes"];
const WORDS = ["lofi", "rain", "city", "sunset", "piano", "jazz", "late night", "study", "coffee", "synthwave", "ambient", "winter"];

function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

/** 100 items: some repeats, two unavailable ones YouTube hides on the page. */
export function makePlaylist() {
  const r = rng(11);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const items = [];
  for (let i = 0; i < 100; i++) {
    const secs = r() < 0.5 ? 120 + Math.floor(r() * 300) : 600 + Math.floor(r() * 3000);
    items.push({
      playlistItemId: `PLI${String(i).padStart(3, "0")}`,
      videoId: `vid${String(i).padStart(3, "0")}`,
      title: `${pick(WORDS)} ${pick(WORDS)} ${pick(["mix", "beats", "session", "radio", "loop"])} ${i}`,
      channel: pick(CHANNELS),
      secs,
      hue: Math.floor(r() * 360),
    });
  }
  for (const [dup, of] of [[17, 3], [35, 3], [29, 8]]) Object.assign(items[dup], { ...items[of], playlistItemId: items[dup].playlistItemId });
  for (const i of [12, 31]) Object.assign(items[i], { title: i === 12 ? "Private video" : "Deleted video", channel: "", secs: 0, hidden: true });
  return items;
}

export function startApi({ port, playlistId, otherPlaylistId = "PLsomeoneElse", me = "UCme" }) {
  const state = { items: makePlaylist(), writes: [], reads: 0 };
  const json = (res, code, body) => {
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname.replace(/^\/youtube\/v3/, "");
    let body = "";
    for await (const c of req) body += c;
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET, PUT, DELETE, POST",
      });
      return res.end();
    }
    if (p === "/__state") return json(res, 200, state);
    if (p === "/__reset") {
      state.items = makePlaylist();
      state.writes = [];
      return json(res, 200, { ok: true });
    }
    if (req.headers.authorization !== "Bearer e2e-token") return json(res, 401, { error: { message: "no auth" } });

    if (req.method === "GET" && p === "/channels") {
      state.reads++;
      return json(res, 200, { items: [{ id: me }] });
    }
    if (req.method === "GET" && p === "/playlists") {
      state.reads++;
      const id = url.searchParams.get("id");
      if (id === playlistId) return json(res, 200, { items: [{ snippet: { title: "Late night queue", channelId: me } }] });
      if (id === otherPlaylistId) return json(res, 200, { items: [{ snippet: { title: "Someone's mix", channelId: "UCother" } }] });
      return json(res, 200, { items: [] });
    }
    if (req.method === "GET" && p === "/playlistItems") {
      state.reads++;
      const start = Number(url.searchParams.get("pageToken") || 0);
      const max = Number(url.searchParams.get("maxResults") || 5);
      const page = state.items.slice(start, start + max);
      return json(res, 200, {
        nextPageToken: start + max < state.items.length ? String(start + max) : undefined,
        items: page.map((it, i) => ({
          id: it.playlistItemId,
          snippet: {
            title: it.title,
            position: start + i,
            videoOwnerChannelTitle: it.channel,
            resourceId: { videoId: it.videoId },
          },
        })),
      });
    }
    if (req.method === "DELETE" && p === "/playlistItems") {
      const id = url.searchParams.get("id");
      const i = state.items.findIndex((x) => x.playlistItemId === id);
      if (i < 0) return json(res, 404, { error: { message: "not found" } });
      state.items.splice(i, 1);
      state.writes.push({ kind: "delete", id });
      return json(res, 204);
    }
    if (req.method === "PUT" && p === "/playlistItems") {
      const b = JSON.parse(body);
      const i = state.items.findIndex((x) => x.playlistItemId === b.id);
      if (i < 0) return json(res, 404, { error: { message: "not found" } });
      if (b.snippet.playlistId !== playlistId || b.snippet.resourceId.videoId !== state.items[i].videoId) {
        return json(res, 400, { error: { message: "bad snippet" } });
      }
      const [it] = state.items.splice(i, 1);
      state.items.splice(b.snippet.position, 0, it);
      state.writes.push({ kind: "move", id: b.id, position: b.snippet.position });
      return json(res, 200, { id: b.id, snippet: b.snippet });
    }
    json(res, 404, { error: { message: `no route ${req.method} ${p}` } });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, state })));
}

// ───────────────────────────── pages

const THEME = `
html { --yt-spec-text-primary:#0f0f0f; --yt-spec-text-secondary:#606060; --yt-spec-text-primary-inverse:#fff;
  --yt-spec-base-background:#fff; --yt-spec-badge-chip-background:rgba(0,0,0,.05); --yt-spec-10-percent-layer:rgba(0,0,0,.1);
  --yt-spec-menu-background:#fff; --yt-spec-raised-background:#fff; --yt-spec-call-to-action:#065fd4; }
html[dark] { --yt-spec-text-primary:#f1f1f1; --yt-spec-text-secondary:#aaa; --yt-spec-text-primary-inverse:#0f0f0f;
  --yt-spec-base-background:#0f0f0f; --yt-spec-badge-chip-background:rgba(255,255,255,.1); --yt-spec-10-percent-layer:rgba(255,255,255,.2);
  --yt-spec-menu-background:#282828; --yt-spec-raised-background:#212121; --yt-spec-call-to-action:#3ea6ff; }
* { box-sizing:border-box } body { margin:0; background:var(--yt-spec-base-background); color:var(--yt-spec-text-primary); font-family:Roboto,Arial,sans-serif }
ytd-masthead { position:fixed; top:0; left:0; right:0; height:56px; z-index:10; background:var(--yt-spec-base-background); display:flex; align-items:center; padding:0 16px; gap:16px }
.logo { font-weight:700; font-size:18px; display:flex; gap:4px; align-items:center } .logo b { background:#f00; color:#fff; border-radius:6px; padding:0 6px; font-size:12px; line-height:18px }
ytd-searchbox { flex:0 1 640px; margin:0 auto; height:40px; border:1px solid #ccc; border-radius:40px; display:flex; align-items:center; padding-left:16px; color:var(--yt-spec-text-secondary) }
html[dark] ytd-searchbox { border-color:#303030; background:#121212 }
.avatar { width:32px; height:32px; border-radius:50%; background:#7b5 }
.thumb { border-radius:8px; position:relative; flex:none; display:block }
ytd-thumbnail-overlay-time-status-renderer { position:absolute; right:4px; bottom:4px; background:rgba(0,0,0,.6); color:#fff; font-size:12px; font-weight:500; line-height:12px; padding:3px 4px; border-radius:4px }
.meta2 { font-size:12px; line-height:18px; color:var(--yt-spec-text-secondary) }
`;

const fmt = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const thumb = (it, w, h) =>
  `<ytd-thumbnail class="thumb" style="width:${w}px;height:${h}px;background:linear-gradient(135deg,hsl(${it.hue} 55% 45%),hsl(${(it.hue + 60) % 360} 60% 25%))"><ytd-thumbnail-overlay-time-status-renderer><span id="text">${fmt(it.secs)}</span></ytd-thumbnail-overlay-time-status-renderer></ytd-thumbnail>`;

function plRow(it, n, playlistId) {
  return `<ytd-playlist-video-renderer>
  <div id="index-container"><yt-formatted-string id="index">${n}</yt-formatted-string></div>
  <div id="content">${thumb(it, 160, 90)}
    <div id="meta"><h3><a id="video-title" href="/watch?v=${it.videoId}&list=${playlistId}&index=${n}" title="${esc(it.title)}">${esc(it.title)}</a></h3>
    <div class="meta2"><ytd-channel-name><div id="text">${esc(it.channel)}</div></ytd-channel-name> • ${(n * 37) % 900}K views</div></div></div>
  <div id="menu" class="dots">⋮</div>
</ytd-playlist-video-renderer>`;
}

/** YouTube hides unavailable videos and loads the list 40, then 20 at a time. */
export function playlistPage(items, playlistId, { dark = true, firstPage = 40, pageSize = 20 } = {}) {
  const visible = items.filter((it) => !it.hidden);
  const rows = visible.map((it, i) => plRow(it, i + 1, playlistId));
  const chunks = [];
  for (let i = firstPage; i < rows.length; i += pageSize) chunks.push(rows.slice(i, i + pageSize).join(""));
  return `<!doctype html><html ${dark ? "dark" : ""} lang="en"><head><meta charset="utf-8"><title>Late night queue - YouTube</title><style>${THEME}
ytd-browse { display:flex; gap:24px; padding:80px 24px 24px 96px }
ytd-page-header { flex:0 0 360px; height:calc(100vh - 104px); position:sticky; top:80px; border-radius:16px; padding:24px; background:linear-gradient(180deg,#5a3d6e,#23192b); color:#fff }
ytd-page-header .cover { width:100%; aspect-ratio:16/9; border-radius:12px; background:linear-gradient(135deg,#b06ab3,#4568dc) }
ytd-page-header h1 { font-size:28px; line-height:38px; margin:16px 0 8px }
ytd-page-header .sub { font-size:12px; line-height:18px; opacity:.7 }
#primary { flex:1; min-width:0; max-width:1100px }
.alert { font-size:14px; color:var(--yt-spec-text-secondary); padding:8px 0 }
ytd-playlist-video-renderer { display:flex; align-items:center; border-radius:12px; min-height:98px }
ytd-playlist-video-renderer:hover { background:var(--yt-spec-badge-chip-background) }
#index-container { width:32px; text-align:center; font-size:14px; color:var(--yt-spec-text-secondary); flex:none }
#content { display:flex; gap:8px; flex:1; min-width:0 } #meta h3 { margin:0 0 4px; font-size:16px; line-height:22px; font-weight:500 }
#video-title { color:inherit; text-decoration:none } ytd-channel-name, ytd-channel-name #text { display:inline }
.dots { width:40px; height:40px; display:grid; place-items:center; color:var(--yt-spec-text-secondary); flex:none }
ytd-continuation-item-renderer { display:block; height:60px }
</style></head><body>
<ytd-masthead><span>☰</span><span class="logo"><b>▶</b>YouTube</span><ytd-searchbox>Search</ytd-searchbox><span class="avatar"></span></ytd-masthead>
<ytd-browse page-subtype="playlist"><ytd-page-header><div class="cover"></div><h1>Late night queue</h1>
<div class="sub">by you<br>Private · Playlist · ${items.length} videos</div></ytd-page-header>
<div id="primary"><ytd-item-section-renderer><div id="contents">
${items.length > visible.length ? `<div class="alert">${items.length - visible.length} unavailable videos are hidden</div>` : ""}
<ytd-playlist-video-list-renderer><div id="contents">${rows.slice(0, firstPage).join("")}${chunks.length ? "<ytd-continuation-item-renderer></ytd-continuation-item-renderer>" : ""}</div></ytd-playlist-video-list-renderer>
</div></ytd-item-section-renderer></div></ytd-browse>
<script>
const more = ${JSON.stringify(chunks)}; let page = 0;
const c = document.querySelector('ytd-continuation-item-renderer');
if (c) new IntersectionObserver((es, io) => { if (!es[0].isIntersecting || c.dataset.busy) return; c.dataset.busy = 1;
  setTimeout(() => { const t = document.createElement('template'); t.innerHTML = more[page++]; c.before(t.content);
    delete c.dataset.busy; if (page >= more.length) { io.disconnect(); c.remove(); } }, 250); }).observe(c);
</script></body></html>`;
}

export function watchPage(items, playlistId, current) {
  const visible = items.filter((it) => !it.hidden);
  const rows = visible
    .map(
      (it, i) => `<ytd-playlist-panel-video-renderer${i === current ? " selected" : ""}>
  <span id="index">${i === current ? "▶" : i + 1}</span>
  <a id="wc-endpoint" href="/watch?v=${it.videoId}&list=${playlistId}&index=${i + 1}">${thumb(it, 100, 56)}
  <div><span id="video-title" title="${esc(it.title)}">${esc(it.title)}</span><span id="byline">${esc(it.channel)}</span></div></a>
</ytd-playlist-panel-video-renderer>`,
    )
    .join("");
  return `<!doctype html><html dark lang="en"><head><meta charset="utf-8"><title>Watch - YouTube</title><style>${THEME}
ytd-watch-flexy { display:flex; gap:24px; padding:80px 24px 24px }
#player { flex:1; aspect-ratio:16/9; background:#000; border-radius:12px }
#secondary { flex:0 0 402px }
ytd-playlist-panel-renderer { display:block; border:1px solid var(--yt-spec-10-percent-layer); border-radius:12px; overflow:hidden }
#header-contents { padding:12px 16px; background:var(--yt-spec-badge-chip-background) } #header-contents h3 { margin:0; font-size:20px }
#items { max-height:460px; overflow-y:auto; padding:4px 0 }
ytd-playlist-panel-video-renderer { display:flex; align-items:center; gap:8px; padding:4px 8px 4px 0 }
ytd-playlist-panel-video-renderer[selected] { background:rgba(255,255,255,.1) }
ytd-playlist-panel-video-renderer #index { width:24px; text-align:center; font-size:12px; color:var(--yt-spec-text-secondary); flex:none }
ytd-playlist-panel-video-renderer a { display:flex; gap:8px; color:inherit; text-decoration:none; min-width:0; flex:1 }
#video-title { font-size:14px; line-height:20px; font-weight:500; display:block } #byline { font-size:12px; color:var(--yt-spec-text-secondary) }
</style></head><body>
<ytd-masthead><span>☰</span><span class="logo"><b>▶</b>YouTube</span><ytd-searchbox>Search</ytd-searchbox><span class="avatar"></span></ytd-masthead>
<ytd-watch-flexy><div id="player"></div><div id="secondary"><ytd-playlist-panel-renderer id="playlist"><div id="container">
<div id="header-contents"><h3>Late night queue</h3><div class="meta2">You · ${current + 1} / ${visible.length}</div></div>
<div id="items">${rows}</div></div></ytd-playlist-panel-renderer></div></ytd-watch-flexy></body></html>`;
}
