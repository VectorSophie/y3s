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
import { playlistPage, startApi, watchPage } from "./fake-youtube.mjs";

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
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"],
});

let dark = true;
await ctx.route("https://www.youtube.com/**", (route) => {
  const u = new URL(route.request().url());
  const list = u.searchParams.get("list");
  if (u.pathname === "/playlist") return route.fulfill({ contentType: "text/html", body: playlistPage(state.items, list, { dark }) });
  if (u.pathname === "/watch") {
    const vis = state.items.filter((i) => !i.hidden);
    const cur = Math.max(0, vis.findIndex((i) => i.videoId === u.searchParams.get("v")));
    return route.fulfill({ contentType: "text/html", body: watchPage(state.items, list, cur) });
  }
  return route.fulfill({ status: 204, body: "" });
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
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
  check(JSON.stringify(actions) === JSON.stringify(["Play"]), "only Play is offered", JSON.stringify(actions));

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
