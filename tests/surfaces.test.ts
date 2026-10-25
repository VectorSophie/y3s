import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PlaylistsPageFilter, SaveSheetFilter } from "../src/content/extras";
import { pageReport } from "../src/content/page-check";
import { readRow } from "../src/content/yt-dom";
import { back, startPlay } from "../src/core/phase-play";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("YouTube's Save to playlist sheet", () => {
  const sheet = (names: string[]) =>
    `<yt-sheet-view-model><yt-list-view-model>${names
      .map((n) => `<toggleable-list-item-view-model><span>${n}</span></toggleable-list-item-view-model>`)
      .join("")}</yt-list-view-model></yt-sheet-view-model>`;

  test("gets a search field that filters the playlists", () => {
    document.body.innerHTML = sheet(["Watch later", "Jazz", "Gym mix", "Lo-fi beats", "Road trip", "Jazz piano"]);
    const f = new SaveSheetFilter();
    f.check();
    const input = document.querySelector<HTMLInputElement>(".y3s-sheet-input")!;
    expect(input).not.toBeNull();
    input.value = "jazz";
    input.dispatchEvent(new Event("input"));
    const visible = [...document.querySelectorAll("toggleable-list-item-view-model:not(.y3s-hidden)")].map((e) => e.textContent);
    expect(visible).toEqual(["Jazz", "Jazz piano"]);
    f.check();
    expect(document.querySelectorAll(".y3s-sheet-input")).toHaveLength(1);
  });

  test("short lists and other menus are left alone", () => {
    document.body.innerHTML = sheet(["A", "B", "C"]);
    new SaveSheetFilter().check();
    expect(document.querySelector(".y3s-sheet-input")).toBeNull();
  });

  test("the older dialog works too", () => {
    document.body.innerHTML = `<ytd-add-to-playlist-renderer><div id="playlists">${["a", "b", "c", "d", "e", "f", "g"]
      .map((n) => `<ytd-playlist-add-to-option-renderer>${n}</ytd-playlist-add-to-option-renderer>`)
      .join("")}</div></ytd-add-to-playlist-renderer>`;
    new SaveSheetFilter().check();
    expect(document.querySelector("#playlists")!.previousElementSibling!.classList.contains("y3s-sheet-search")).toBe(true);
  });
});

test("playlists page filter", () => {
  document.body.innerHTML = `<ytd-rich-grid-renderer><div id="contents">${["Jazz", "Gym", "Jazz 2"]
    .map((n) => `<ytd-rich-item-renderer>${n}</ytd-rich-item-renderer>`)
    .join("")}</div></ytd-rich-grid-renderer>`;
  const f = new PlaylistsPageFilter(document.querySelector("ytd-rich-grid-renderer")!);
  const input = f.bar.querySelector("input")!;
  input.value = "jazz";
  input.dispatchEvent(new Event("input"));
  expect(document.querySelectorAll("ytd-rich-item-renderer:not(.y3s-hidden)")).toHaveLength(2);
  expect(f.bar.textContent).toContain("2 of 3");
  f.destroy();
  expect(document.querySelectorAll(".y3s-hidden")).toHaveLength(0);
});

test("reads YouTube Music playlist rows", () => {
  document.body.innerHTML = `<ytmusic-responsive-list-item-renderer>
    <div class="flex-columns">
      <div class="title-column"><yt-formatted-string class="title"><a href="watch?v=abc123&list=PLx">Blue in Green</a></yt-formatted-string></div>
      <div class="secondary-flex-columns"><yt-formatted-string><a>Miles Davis</a></yt-formatted-string><yt-formatted-string>Kind of Blue</yt-formatted-string></div>
    </div>
    <div class="fixed-columns"><yt-formatted-string>5:37</yt-formatted-string></div>
  </ytmusic-responsive-list-item-renderer>`;
  const r = readRow(document.querySelector("ytmusic-responsive-list-item-renderer")!);
  expect(r).toMatchObject({ videoId: "abc123", title: "Blue in Green", channel: "Miles Davis", duration: 337, unavailable: false });
});

test("page check reports counts, not content", async () => {
  history.replaceState(null, "", "/playlist?list=PLsecret");
  document.body.innerHTML = `<ytd-playlist-video-list-renderer><div id="contents">
    <ytd-playlist-video-renderer><a id="video-title" href="/watch?v=a1" title="My secret title">My secret title</a></ytd-playlist-video-renderer>
  </div></ytd-playlist-video-list-renderer>`;
  const text = await pageReport();
  expect(text).toContain("rows: 1");
  expect(text).toContain("rows with video id: 1");
  expect(text).toContain("ytd-playlist-video-renderer");
  expect(text).not.toContain("secret");
});

test("previous in phase", () => {
  const s = startPlay({ playlistId: "P", name: "n", items: [1, 2, 3].map((i) => ({ videoId: `v${i}`, index: i })), loop: false, shuffle: false });
  expect(back({ ...s, pos: 2 }).pos).toBe(1);
  expect(back(s)).toBe(s);
  expect(back({ ...s, loop: true }).pos).toBe(2);
});

// ───────────────────────────── player bar controls and the miniplayer

describe("phase player on the watch page", () => {
  const items = [3, 4, 5].map((i) => ({ videoId: `v${i}`, index: i }));
  let clicked: string[] = [];
  const watch = (current: number, mini = false) => {
    const rows = [1, 2, 3, 4, 5, 6]
      .map(
        (i) =>
          `<ytd-playlist-panel-video-renderer${i === current ? " selected" : ""}><a id="wc-endpoint" href="/watch?v=v${i}&list=PL&index=${i}">v${i}</a></ytd-playlist-panel-video-renderer>`,
      )
      .join("");
    const panel = `<ytd-playlist-panel-renderer id="playlist"><div id="items">${rows}</div></ytd-playlist-panel-renderer>`;
    // Like the live miniplayer: no playlist rows, just "N / M" and a ⏭ link.
    document.body.innerHTML = mini
      ? `<ytd-app miniplayer-is-active></ytd-app><ytd-miniplayer><div id="movie_player"><video></video><a class="ytp-next-button" href="/watch?v=v${current + 1}&list=PL"></a></div><ytd-miniplayer-info-bar>Mid<br>PL • ${current} / 6</ytd-miniplayer-info-bar></ytd-miniplayer>`
      : `<div id="movie_player"><video></video><div class="ytp-chrome-controls"><div class="ytp-right-controls"><button class="ytp-next-button"></button></div></div></div>${panel}`;
    clicked = [];
  };
  const onClick = (e: Event) => {
    const a = (e.target as Element).closest("a");
    if (a) {
      e.preventDefault();
      clicked.push(new URL(a.href).searchParams.get("v")!);
    }
  };

  beforeEach(() => {
    sessionStorage.clear();
    document.addEventListener("click", onClick, true);
  });
  afterEach(() => document.removeEventListener("click", onClick, true));

  test("adds controls to the player bar; Shift+N and the player's ⏭ step within the phase", async () => {
    const { PhasePlayer } = await import("../src/content/phase-player");
    history.replaceState(null, "", "/watch?v=v3&list=PL");
    watch(3);
    const p = new PhasePlayer({ ...startPlay({ playlistId: "PL", name: "Mid", items, loop: true, shuffle: false }), pending: null });
    p.tick();
    const bar = document.querySelector(".y3s-ytp")!;
    expect(bar.nextElementSibling?.className).toBe("ytp-right-controls");
    expect(bar.textContent).toContain("Mid · 1/3");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "N", shiftKey: true, bubbles: true, cancelable: true }));
    expect(clicked).toEqual(["v4"]);
    document.querySelector<HTMLElement>(".ytp-next-button")!.click();
    expect(clicked).toEqual(["v4", "v5"]);
    p.destroy();
  });

  test("keeps going in the miniplayer, following its playlist position", async () => {
    const { PhasePlayer, loadPlay, miniplayerActive, miniplayerPlaylist } = await import("../src/content/phase-player");
    history.replaceState(null, "", "/feed/subscriptions");
    watch(4, true);
    expect(miniplayerActive()).toBe(true);
    expect(miniplayerPlaylist()).toBe("PL");
    const s0 = { ...startPlay({ playlistId: "PL", name: "Mid", items, loop: false, shuffle: false }), pos: 1, pending: null };
    const p = new PhasePlayer(s0);
    p.tick();
    expect(p.state.pos).toBe(1);
    // YouTube's autoplay moves the miniplayer on to playlist position 5
    document.querySelector("ytd-miniplayer-info-bar")!.textContent = "Mid PL • 5 / 6";
    p.tick();
    expect(p.state.pos).toBe(2);
    // …and position 6 is outside the phase: phase playback ends
    document.querySelector("ytd-miniplayer-info-bar")!.textContent = "Mid PL • 6 / 6";
    p.tick();
    expect(loadPlay()).toBeNull();
  });
});

test("dialogs focus the marked control, not the first button", async () => {
  const { confirmDialog, pickDialog } = await import("../src/content/ui/dialog");
  void pickDialog({ title: "Pick", items: [{ id: "a", label: "A" }], placeholder: "Search", empty: "none" });
  expect(document.activeElement?.className).toBe("y3s-pick-search");
  document.querySelector(".y3s-dialog-backdrop")!.remove();
  void confirmDialog({ title: "Sure?", body: [], confirm: "Save", cancel: "Undo changes" });
  expect(document.activeElement?.textContent).toBe("Save");
});
