// End-to-end test: loads the built extension (dist-e2e) into headless
// Chromium, serves stand-in YouTube pages, and checks what actually reaches
// a fake YouTube Data API.
//
//   npm run test:e2e
//
// Needs Chromium (Google Chrome no longer loads unpacked extensions from the
// command line). One-time: `npx playwright-core install chromium`, or set
// CHROME_PATH to a Chromium binary.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { playlistPage, silentWav, startApi, watchPage } from "./fake-youtube.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const ext = resolve(root, "dist-e2e");
const out = resolve(here, "out");
mkdirSync(out, { recursive: true });

const PORT = Number(process.env.E2E_PORT || 8765);
const PL = "PLe2eTestPlaylist";
const OTHER = "PLsomeoneElse";

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  // Wherever `npx playwright-core install chromium` put it, on any OS.
  const p = chromium.executablePath();
  if (!existsSync(p)) {
    throw new Error("No Chromium found. Run `npx playwright-core install chromium`, or set CHROME_PATH to a Chromium (not Google Chrome) binary.");
  }
  return p;
}

let failures = 0;
function check(ok, msg, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}${!ok && extra ? `\n     ${extra}` : ""}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return false;
}

if (!existsSync(join(ext, "manifest.json"))) throw new Error("Run `npm run build:e2e` first.");
const { server, state } = await startApi({ port: PORT, playlistId: PL, otherPlaylistId: OTHER });
const serverIds = () => state.items.map((i) => i.videoId);
const visibleServerIds = () => state.items.filter((i) => !i.hidden).map((i) => i.videoId);

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "y3s-e2e-")), {
  executablePath: chromePath(),
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: [
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

let dark = true;
const clip = silentWav(2);
const visits = [];
await ctx.route("https://www.youtube.com/**", (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === "/media/clip.wav") return route.fulfill({ contentType: "audio/wav", body: clip });
  const list = u.searchParams.get("list");
  if (u.pathname === "/playlist") return route.fulfill({ contentType: "text/html", body: playlistPage(state.items, list, { dark }) });
  if (u.pathname === "/watch") {
    visits.push(u.searchParams.get("v"));
    const vis = state.items.filter((i) => !i.hidden);
    const cur = Math.max(0, vis.findIndex((i) => i.videoId === u.searchParams.get("v")));
    return route.fulfill({ contentType: "text/html", body: watchPage(state.items, list, cur) });
  }
  if (u.pathname === "/watch_videos") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>queue</title>" });
  return route.fulfill({ status: 204, body: "" });
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.stack || e).split("\n").slice(0, 3).join(" | ")));
page.on("console", (m) => {
  if (m.type() === "error" || /\[y3s\]/.test(m.text())) errors.push(`console ${m.type()}: ${m.text()}`);
});

const pageIds = () =>
  page.$$eval("ytd-playlist-video-renderer:not(.y3s-removed)", (rows) =>
    rows.map((r) => /v=([^&]+)/.exec(r.querySelector("a#video-title").getAttribute("href"))[1]),
  );
const snack = () => page.$eval(".y3s-snackbar", (e) => (e.classList.contains("y3s-open") ? e.textContent : "")).catch(() => "");
const checkbox = (i) => page.locator("ytd-playlist-video-renderer .y3s-cbwrap").nth(i);
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
async function waitSaved(writesBefore, label) {
  const ok = await waitFor(async () => state.writes.length > writesBefore && /Saved to YouTube/.test(await snack()), 30000);
  check(!!ok, `${label}: saved`, `snack=${await snack()} writes=${state.writes.length - writesBefore}`);
  return state.writes.length - writesBefore;
}

try {
  // ── load
  await page.goto(`https://www.youtube.com/playlist?list=${PL}`);
  check(!!(await page.waitForSelector(".y3s-bar", { timeout: 10000 }).catch(() => null)), "extension adds the bar to the playlist page");
  check(
    !!(await waitFor(async () => /Unavailable · 2/.test(await page.textContent(".y3s-bar")))),
    "signed in, owner detected, 2 hidden unavailable videos counted",
    await page.textContent(".y3s-bar"),
  );
  check(/40 videos\+/.test(await page.textContent(".y3s-stats")), "stats show 40 loaded so far");
  await shot("01-playlist");

  // ── move to top (forces loading the whole playlist first)
  await checkbox(5).click();
  await checkbox(9).click();
  await page.mouse.move(900, 700);
  await shot("02-selection");
  const sel = (await pageIds()).filter((_, i) => i === 5 || i === 9);
  let w = state.writes.length;
  await page.keyboard.press("t");
  check(!!(await waitFor(async () => /Moved 2 videos to top/.test(await snack()), 30000)), "t moves the selection (after loading all)");
  check((await pageIds()).length === 98, "whole playlist loaded before reordering", String((await pageIds()).length));
  check(JSON.stringify((await pageIds()).slice(0, 2)) === JSON.stringify(sel), "selection now at the top of the page");
  check(state.writes.length === w, "nothing written during the undo window");
  await shot("03-moved-snackbar");
  const nMove = await waitSaved(w, "move to top");
  check(nMove === 2, "move to top took exactly 2 writes", String(nMove));
  check(JSON.stringify(visibleServerIds()) === JSON.stringify(await pageIds()), "YouTube order matches the page");

  // ── undo inside the window writes nothing
  await page.keyboard.press("Escape");
  w = state.writes.length;
  const before = await pageIds();
  await checkbox(0).click();
  await page.keyboard.press("Delete");
  check((await pageIds()).length === before.length - 1, "Delete removes the row on the page");
  await page.keyboard.press("z");
  check(JSON.stringify(await pageIds()) === JSON.stringify(before), "z puts it back");
  await sleep(7500);
  check(state.writes.length === w, "undone edit is never sent");

  // ── duplicates
  await page.click(".y3s-chip >> text=/^Duplicates/");
  check((await page.$$("ytd-playlist-video-renderer.y3s-row:not(.y3s-hidden):not(.y3s-removed)")).length === 5, "Duplicates chip shows the 5 copies");
  await shot("04-duplicates");
  w = state.writes.length;
  await page.click("text=Remove extra copies");
  await waitSaved(w, "remove extra copies");
  const ids = serverIds();
  check(new Set(ids).size === ids.length, "no repeated videos left on YouTube");
  check(state.writes.slice(w).every((x) => x.kind === "delete") && state.writes.length - w === 3, "3 deletes");

  // ── hidden unavailable videos
  await page.click(".y3s-chip >> text=/^Unavailable/");
  w = state.writes.length;
  await page.click("text=/Remove 2 unavailable/");
  await waitSaved(w, "remove unavailable");
  check(!state.items.some((i) => i.hidden), "both hidden unavailable videos deleted from YouTube");

  // ── big sort asks first, then saves
  await page.click(".y3s-chip-icon");
  await shot("05-sort-menu");
  await page.click(".y3s-menu-item >> text=Title (A–Z)");
  check(!!(await page.waitForSelector(".y3s-dialog", { timeout: 15000 }).catch(() => null)), "large save asks for confirmation");
  const dialogText = await page.textContent(".y3s-dialog");
  check(/changes and uses about/.test(dialogText), "dialog states the cost", dialogText);
  await shot("06-confirm");
  w = state.writes.length;
  await page.click('.y3s-dialog button >> text="Save"');
  const nSort = await waitSaved(w, "sort by title");
  const titles = state.items.map((i) => i.title);
  const sorted = [...titles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  check(JSON.stringify(titles) === JSON.stringify(sorted), "YouTube order is now sorted by title");
  check(JSON.stringify(serverIds()) === JSON.stringify(await pageIds()), "page and YouTube agree after sort");
  console.log(`     (sort of ${state.items.length} videos used ${nSort} writes)`);

  // ── fresh load reflects the saved playlist
  await page.reload();
  await page.waitForSelector(".y3s-bar");
  await page.click(".y3s-link >> text=Load all");
  await waitFor(async () => (await pageIds()).length === state.items.length, 30000);
  check(JSON.stringify(await pageIds()) === JSON.stringify(serverIds()), "after reload the page shows the saved order");
  await waitFor(async () => !/Unavailable ·/.test(await page.textContent(".y3s-bar")));

  // ── drag-select with the mouse
  await page.reload();
  await page.waitForSelector(".y3s-bar");
  await waitFor(async () => !/Sign in|Retry/.test(await page.textContent(".y3s-stats")), 5000);
  const titleBox = async (i) => {
    const l = page.locator("ytd-playlist-video-renderer #video-title").nth(i);
    await l.scrollIntoViewIfNeeded();
    return l.boundingBox();
  };
  await page.evaluate(() => scrollTo(0, 0));
  const selectedCount = () => page.$$eval("ytd-playlist-video-renderer.y3s-selected", (e) => e.length);
  {
    const a = await titleBox(2);
    const b = await titleBox(5);
    await page.mouse.move(a.x + 40, a.y + 5);
    await page.mouse.down();
    for (let s = 1; s <= 8; s++) await page.mouse.move(a.x + 40 + s * 10, a.y + 5 + ((b.y - a.y) * s) / 8);
    await shot("10-drag-select");
    await page.mouse.up();
    check((await selectedCount()) === 4, "dragging over 4 rows selects them", String(await selectedCount()));
    check(new URL(page.url()).pathname === "/playlist", "dragging from a title link doesn't open the video");
  }
  {
    const a = await titleBox(8);
    const b = await titleBox(9);
    await page.keyboard.down("Control");
    await page.mouse.move(a.x + 300, a.y + 5);
    await page.mouse.down();
    for (let s = 1; s <= 5; s++) await page.mouse.move(a.x + 300, a.y + 5 + ((b.y - a.y) * s) / 5);
    await page.mouse.up();
    await page.keyboard.up("Control");
    check((await selectedCount()) === 6, "Ctrl+drag adds to the selection", String(await selectedCount()));
  }
  {
    // A fresh drag replaces the selection, and holding at the bottom edge scrolls.
    await page.evaluate(() => scrollTo(0, 0));
    const a = await titleBox(0);
    await page.mouse.move(a.x + 200, a.y + 5);
    await page.mouse.down();
    await page.mouse.move(a.x + 200, a.y + 60, { steps: 4 });
    await page.mouse.move(a.x + 200, 895, { steps: 6 });
    await sleep(1200);
    await page.mouse.up();
    const n = await selectedCount();
    check(n > 10 && (await page.evaluate(() => scrollY)) > 200, "dragging to the bottom edge auto-scrolls and keeps selecting", `selected=${n}`);
  }
  await page.keyboard.press("Escape");
  {
    const a = await titleBox(0);
    await page.evaluate(() => scrollTo(0, 0));
    const first = (await pageIds())[0];
    const t = await titleBox(0);
    await page.mouse.click(t.x + 20, t.y + 5);
    await page.waitForURL(/\/watch\?/);
    check(page.url().includes(`v=${first}`), "a plain click still opens the video");
    await page.goBack();
    await page.waitForSelector(".y3s-bar");
    void a;
  }

  // ── phases
  const layout = () =>
    page.$$eval("ytd-playlist-video-list-renderer #contents > *", (els) =>
      els
        .filter((e) => e.matches(".y3s-phase, ytd-playlist-video-renderer:not(.y3s-removed)"))
        .map((e) =>
          e.classList.contains("y3s-phase")
            ? `[${e.querySelector(".y3s-phase-name").textContent}]`
            : /v=([^&]+)/.exec(e.querySelector("a#video-title").getAttribute("href"))[1],
        ),
    );
  const rowsOfLayout = (l) => l.filter((x) => !x.startsWith("["));
  await waitFor(async () => !/Sign in|Retry/.test(await page.textContent(".y3s-stats")), 5000);
  await page.click(".y3s-chip >> text=/^Phases/");
  await page.click('.y3s-menu-item >> text="Split into phases of 25"');
  await waitFor(async () => (await page.$$(".y3s-phase")).length === 4, 30000);
  const total = state.items.length;
  check((await page.$$(".y3s-phase.y3s-folded")).length === 4, `split ${total} videos into 4 folded phases`);
  check((await page.$$("ytd-playlist-video-renderer:not(.y3s-collapsed):not(.y3s-removed)")).length === 0, "folded phases hide their videos");
  await page.evaluate(() => scrollTo(0, 0));
  await shot("11-phases-folded");

  // expand the last phase, drag-select 3 videos there, move them into the first phase
  await page.locator(".y3s-phase").nth(3).locator(".y3s-phase-title").click();
  await page.locator(".y3s-phase").nth(3).scrollIntoViewIfNeeded();
  const lastRows = page.locator("ytd-playlist-video-renderer:not(.y3s-collapsed):not(.y3s-removed) #video-title");
  const r0 = await lastRows.nth(0).boundingBox();
  const r2 = await lastRows.nth(2).boundingBox();
  await page.mouse.move(r0.x + 250, r0.y + 5);
  await page.mouse.down();
  await page.mouse.move(r0.x + 250, r2.y + 5, { steps: 8 });
  await page.mouse.up();
  check((await selectedCount()) === 3, "drag-selected 3 videos in the expanded phase");
  await shot("12-phase-selection");
  const moved = await page.$$eval("ytd-playlist-video-renderer.y3s-selected #video-title", (as) =>
    as.map((a) => /v=([^&]+)/.exec(a.getAttribute("href"))[1]),
  );
  let w2 = state.writes.length;
  await page.click('.y3s-sel-actions >> text="Move to phase"');
  await page.click('.y3s-menu-item >> text="Videos 1–25"');
  let lay = await layout();
  const p2 = lay.indexOf("[Videos 26–50]");
  check(JSON.stringify(lay.slice(p2 - 3, p2)) === JSON.stringify(moved), "videos moved to the end of the first phase");
  check((await waitSaved(w2, "move to phase")) === 3, "move to phase took 3 writes");
  check(JSON.stringify(serverIds()) === JSON.stringify(rowsOfLayout(await layout())), "YouTube order matches the phases");

  // move the last phase to the top with its menu
  w2 = state.writes.length;
  await page.locator(".y3s-phase").nth(3).locator('[aria-label="Phase actions"]').click();
  await shot("13-phase-menu");
  await page.click('.y3s-menu-item >> text="Move to top"');
  lay = await layout();
  check(lay[0] === "[Videos 76–95]", "last phase is now first", lay[0]);
  await waitSaved(w2, "move phase to top");
  check(JSON.stringify(serverIds()) === JSON.stringify(rowsOfLayout(await layout())), "YouTube order matches after moving the phase");

  // phases survive a reload, folded
  const layoutBefore = await layout();
  await page.reload();
  await page.waitForSelector(".y3s-bar");
  await page.click(".y3s-link >> text=Load all");
  await waitFor(async () => (await page.$$(".y3s-phase")).length === 4 && !(await page.$(".y3s-link:not([hidden]) >> text=Load all")), 30000);
  await sleep(300);
  check(JSON.stringify(await layout()) === JSON.stringify(layoutBefore), "phases come back after a reload in the same places");
  check((await page.$$(".y3s-phase.y3s-folded")).length === 4, "and start folded");

  // play a phase: opens the first video inside the real playlist
  const firstPhaseIds = rowsOfLayout((await layout()).slice(0, (await layout()).indexOf("[Videos 1–25]")));
  await page.locator(".y3s-phase").nth(0).locator('[aria-label="Phase actions"]').click();
  await page.click('.y3s-menu-item >> text="Play phase"');
  await page.waitForURL(new RegExp(`/watch\\?v=${firstPhaseIds[0]}&list=${PL}`));
  check(true, "Play phase opens the phase's first video in the playlist");
  await page.waitForSelector(".y3s-play-pill");
  check(/Playing Videos 76–95/.test(await page.textContent(".y3s-play-pill")), "watch page shows the phase being played");
  await page.click('[aria-label="Stop phase playback"]');
  check(!(await page.$(".y3s-play-pill")), "stop ends phase playback");
  await page.goBack();
  await page.waitForSelector(".y3s-bar");
  await waitFor(async () => (await page.$$(".y3s-phase")).length === 4);

  // clear them
  await page.click(".y3s-chip >> text=/^Phases/");
  await page.click('.y3s-menu-item >> text="Clear all phases"');
  check((await page.$$(".y3s-phase")).length === 0, "Clear all phases removes them");

  // ── split a phase at one video, then loop the middle phase
  await page.reload();
  await page.waitForSelector(".y3s-bar");
  await page.click(".y3s-link >> text=Load all");
  await waitFor(async () => (await pageIds()).length === state.items.length, 30000);
  await page.click(".y3s-chip >> text=/^Phases/");
  await page.click('.y3s-menu-item >> text="Split into phases of 50"');
  await waitFor(async () => (await page.$$(".y3s-phase")).length === 2);
  await sleep(300);
  await page.locator(".y3s-phase").nth(1).locator(".y3s-phase-toggle").click();
  await waitFor(async () => (await page.$$("ytd-playlist-video-renderer:not(.y3s-collapsed)")).length === 45, 5000);
  const ids0 = await pageIds();
  await checkbox(53).click();
  await page.click('.y3s-sel-actions >> text="New phase"');
  lay = await layout();
  check(
    JSON.stringify(lay.filter((x) => x.startsWith("["))) === JSON.stringify(["[Videos 1–50]", "[Videos 51–53]", "[Videos 54–95]"]),
    "selecting one video and pressing New phase splits the phase there, renaming the ranges",
    JSON.stringify(lay.filter((x) => x.startsWith("["))),
  );
  check(JSON.stringify(rowsOfLayout(lay)) === JSON.stringify(ids0), "splitting moves nothing");
  const loopIds = ids0.slice(50, 53);
  const after = ids0[53];
  await shot("14-split");

  visits.length = 0;
  await page.locator(".y3s-phase").nth(1).locator('[aria-label="Phase actions"]').click();
  await page.click('.y3s-menu-item >> text="Loop phase"');
  await page.waitForSelector(".y3s-play-pill");
  check(!!(await waitFor(async () => visits.length >= 5, 40000, 200)), "looping played 5 videos", JSON.stringify(visits));
  check(
    JSON.stringify(visits.slice(0, 5)) === JSON.stringify([...loopIds, ...loopIds.slice(0, 2)]),
    "loop goes 51 → 52 → 53 → back to 51, never on to video 54",
    JSON.stringify(visits.slice(0, 5)),
  );
  check(!visits.includes(after), "YouTube's autoplay never escaped the phase");
  const pill = await page.textContent(".y3s-play-pill");
  check(/Looping Videos 51–53/.test(pill) && / of 3/.test(pill), "watch page shows the loop", pill);
  const outside = await page.$$eval("ytd-playlist-panel-video-renderer.y3s-outside", (e) => e.length);
  check(outside === state.items.length - 3, "videos outside the phase are dimmed in the panel", String(outside));
  await shot("15-loop-pill");

  // turn loop off: playback stops at the phase's last video
  await page.click('[aria-label="Loop phase"]');
  const count0 = visits.length;
  check(!!(await waitFor(async () => /Finished/.test(await page.textContent(".y3s-play-pill")), 20000)), "without loop, playback stops at the end of the phase");
  check(visits.at(-1) === loopIds[2] && visits.length - count0 <= 3, "last video played is the phase's last", JSON.stringify(visits.slice(count0)));
  check(await page.$eval("video", (v) => v.paused), "the player is paused at the end");
  await sleep(3000);
  check(visits.at(-1) === loopIds[2], "and stays there");

  // picking a video outside the phase ends phase playback
  await page.locator(`ytd-playlist-panel-video-renderer a[href*="v=${ids0[10]}"]`).click();
  await page.waitForURL(new RegExp(`v=${ids0[10]}`));
  await waitFor(async () => !(await page.$(".y3s-play-pill")), 5000);
  check(!(await page.$(".y3s-play-pill")), "choosing a video outside the phase stops phase playback");
  await page.goto(`https://www.youtube.com/playlist?list=${PL}`);
  await page.waitForSelector(".y3s-bar");
  await waitFor(async () => (await page.$$(".y3s-phase")).length === 3);
  await page.click(".y3s-chip >> text=/^Phases/");
  await page.click('.y3s-menu-item >> text="Clear all phases"');

  // ── light theme look
  dark = false;
  await page.reload();
  await page.waitForSelector(".y3s-bar");
  await waitFor(async () => !/Sign in|Retry/.test(await page.textContent(".y3s-stats")), 5000);
  await checkbox(1).click();
  await checkbox(2).click();
  await page.mouse.move(900, 700);
  await shot("07-light-selection");
  await page.keyboard.press("?");
  await page.waitForSelector(".y3s-dialog");
  await shot("08-shortcuts");
  await page.keyboard.press("Escape");
  dark = true;

  // ── someone else's playlist
  await page.goto(`https://www.youtube.com/playlist?list=${OTHER}`);
  await page.waitForSelector(".y3s-bar");
  check(!!(await waitFor(async () => /View only/.test(await page.textContent(".y3s-stats")))), "someone else's playlist is view only");
  await checkbox(0).click();
  const actions = await page.$$eval(".y3s-sel-actions .y3s-btn", (bs) => bs.filter((b) => !b.hidden).map((b) => b.textContent));
  check(JSON.stringify(actions) === JSON.stringify(["Play", "New phase"]), "only Play and New phase are offered", JSON.stringify(actions));

  // ── watch page panel
  await page.goto(`https://www.youtube.com/watch?v=${serverIds()[10]}&list=${PL}`);
  await page.waitForSelector(".y3s-panel-bar");
  await page.click(".y3s-panel-bar input");
  await page.keyboard.type("jazz");
  const cnt = await page.textContent(".y3s-panel-count");
  check(/^\d+ of \d+$/.test(cnt), "panel filter shows a count", cnt);
  await shot("09-watch-filter");
  const firstMatch = await page.$eval(
    "ytd-playlist-panel-video-renderer:not(.y3s-hidden) a",
    (a) => /v=([^&]+)/.exec(a.getAttribute("href"))[1],
  );
  await page.keyboard.press("Enter");
  await page.waitForURL(new RegExp(`v=${firstMatch}`));
  check(true, "Enter plays the first match");

  check(errors.length === 0, "no page errors", errors.join("\n     "));
  console.log(`\n${state.writes.length} writes and ${state.reads} reads reached the fake API.`);
} catch (e) {
  failures++;
  console.error("FAIL (exception)", e);
  await shot("zz-failure").catch(() => {});
} finally {
  await ctx.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll end-to-end checks passed");
process.exit(failures ? 1 : 0);
