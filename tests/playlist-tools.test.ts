import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { applyChanges, type ServerItem } from "../src/core/plan";
import type { Backend, ServerTrack } from "../src/content/backend";
import { PlaylistTools } from "../src/content/playlist-tools";
import { snackText } from "../src/content/ui/snackbar";
import { SAVE_DELAY_MS } from "../src/shared/constants";
import type { ApplyResult, Change } from "../src/shared/types";

interface V {
  id: string;
  title: string;
  channel?: string;
  dur?: string;
}

function rowHtml(v: V, i: number): string {
  return `<ytd-playlist-video-renderer>
    <div id="index-container"><yt-formatted-string id="index">${i + 1}</yt-formatted-string></div>
    <ytd-thumbnail><ytd-thumbnail-overlay-time-status-renderer><span id="text">${v.dur ?? "3:00"}</span></ytd-thumbnail-overlay-time-status-renderer></ytd-thumbnail>
    <a id="video-title" href="/watch?v=${v.id}&list=PL1&index=${i + 1}" title="${v.title}">${v.title}</a>
    <ytd-channel-name><div id="text">${v.channel ?? "Chan"}</div></ytd-channel-name>
  </ytd-playlist-video-renderer>`;
}

function mount(videos: V[], opts: { continuation?: boolean } = {}): HTMLElement {
  history.replaceState(null, "", "/playlist?list=PL1");
  document.body.innerHTML = `<div id="host"><ytd-playlist-video-list-renderer><div id="contents">${videos
    .map(rowHtml)
    .join("")}${opts.continuation ? "<ytd-continuation-item-renderer></ytd-continuation-item-renderer>" : ""}</div></ytd-playlist-video-list-renderer></div>`;
  return document.querySelector("ytd-playlist-video-list-renderer")!;
}

class FakeBackend implements Backend {
  server: ServerTrack[];
  applied: Change[][] = [];
  failAt = -1;
  constructor(
    items: ServerTrack[],
    public state: { signedIn: boolean; owned: boolean } = { signedIn: true, owned: true },
  ) {
    this.server = items;
  }
  async authStatus() {
    return { signedIn: this.state.signedIn, configured: true };
  }
  async signIn() {
    this.state.signedIn = true;
  }
  async access() {
    return { title: "PL", owned: this.state.owned };
  }
  async items() {
    return this.server.map((s) => ({ ...s }));
  }
  async apply(_id: string, changes: Change[], onProgress: (d: number, t: number) => void): Promise<ApplyResult> {
    this.applied.push(changes);
    const n = this.failAt >= 0 ? Math.min(this.failAt, changes.length) : changes.length;
    const next = applyChanges(this.server, changes.slice(0, n)) as ServerTrack[];
    this.server = next.map((s) => ({ ...s, title: this.server.find((x) => x.playlistItemId === s.playlistItemId)!.title }));
    onProgress(n, changes.length);
    return n < changes.length ? { applied: n, error: { code: "QUOTA_EXCEEDED", message: "" } } : { applied: n };
  }
  order() {
    return this.server.map((s) => s.videoId);
  }
}

const vids = (n: number): V[] => Array.from({ length: n }, (_, i) => ({ id: `v${i}`, title: `Video ${i}` }));
const tracks = (v: V[]): ServerTrack[] => v.map((x, i) => ({ playlistItemId: `p${i}`, videoId: x.id, title: x.title }));

function pageOrder(): string[] {
  return [...document.querySelectorAll("ytd-playlist-video-renderer:not(.y3s-removed)")].map(
    (r) => /v=([^&]+)/.exec(r.querySelector("a")!.getAttribute("href")!)![1],
  );
}
const rowEl = (i: number) => document.querySelectorAll<HTMLElement>("ytd-playlist-video-renderer")[i];
const click = (el: Element, init: MouseEventInit = {}) =>
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
const key = (k: string, init: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });

async function ready(tools: PlaylistTools) {
  for (let i = 0; i < 20 && tools.access === "checking"; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

let tools: PlaylistTools | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  tools?.destroy();
  tools = null;
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("filter bar", () => {
  test("filters, counts and shows the runtime", async () => {
    const v = [
      { id: "a", title: "Rain piano", dur: "1:00:00" },
      { id: "b", title: "City jazz", dur: "30:00" },
      { id: "c", title: "Piano jazz", dur: "15:00" },
    ];
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    expect(tools.bar.textContent).toContain("3 videos · 1h 45m");
    tools.setQuery("piano");
    expect(tools.visibleRows()).toHaveLength(2);
    expect(tools.bar.textContent).toContain("2 of 3 videos");
    tools.setQuery("piano jazz");
    expect(tools.visibleRows()).toHaveLength(1);
    tools.setQuery("zzz");
    expect(tools.empty.hidden).toBe(false);
  });

  test("duplicates chip and count", async () => {
    const v = [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "a", title: "A" }];
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    const chip = [...tools.bar.querySelectorAll(".y3s-chip")].find((c) => c.textContent!.startsWith("Duplicates"))!;
    expect(chip.textContent).toBe("Duplicates · 2");
    click(chip);
    expect(tools.visibleRows()).toHaveLength(2);
  });
});

describe("selection", () => {
  test("checkbox click, shift-range, select all, clear", async () => {
    const v = vids(8);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    click(rowEl(1).querySelector(".y3s-cbwrap")!);
    click(rowEl(4).querySelector(".y3s-cbwrap")!, { shiftKey: true });
    expect(document.querySelectorAll(".y3s-selected")).toHaveLength(4);
    expect(tools.bar.classList.contains("y3s-selecting")).toBe(true);
    expect(tools.bar.textContent).toContain("4 selected");
    tools.selectAllVisible();
    expect(document.querySelectorAll(".y3s-selected")).toHaveLength(8);
    tools.clearSelection();
    expect(tools.bar.classList.contains("y3s-selecting")).toBe(false);
  });

  test("keyboard: j/k focus, x select, Shift+J extend, Esc clears", async () => {
    const v = vids(6);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    const press = (k: string, init?: KeyboardEventInit) => tools!.onKey(key(k, init));
    press("j");
    press("j");
    expect(rowEl(1).classList.contains("y3s-focus")).toBe(true);
    press("x");
    press("J", { shiftKey: true });
    expect(document.querySelectorAll(".y3s-selected")).toHaveLength(2);
    press("Escape");
    expect(document.querySelectorAll(".y3s-selected")).toHaveLength(0);
  });
});

describe("saving to YouTube", () => {
  test("move to top applies at once and saves after the undo window with minimal writes", async () => {
    const v = vids(10);
    const be = new FakeBackend(tracks(v));
    tools = new PlaylistTools(mount(v), be);
    await ready(tools);
    expect(tools.access).toBe("editable");
    click(rowEl(7).querySelector(".y3s-cbwrap")!);
    click(rowEl(8).querySelector(".y3s-cbwrap")!);
    await tools.moveTo("top");
    expect(pageOrder().slice(0, 3)).toEqual(["v7", "v8", "v0"]);
    expect(snackText()).toContain("Moved 2 videos to top");
    expect(be.applied).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(be.applied).toHaveLength(1);
    expect(be.applied[0]).toHaveLength(2);
    expect(be.order()).toEqual(pageOrder());
    expect(snackText()).toContain("Saved");
  });

  test("undo inside the window means nothing is written", async () => {
    const v = vids(5);
    const be = new FakeBackend(tracks(v));
    tools = new PlaylistTools(mount(v), be);
    await ready(tools);
    click(rowEl(3).querySelector(".y3s-cbwrap")!);
    tools.removeSelected();
    expect(pageOrder()).toEqual(["v0", "v1", "v2", "v4"]);
    tools.onKey(key("z"));
    expect(pageOrder()).toEqual(["v0", "v1", "v2", "v3", "v4"]);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(be.applied).toHaveLength(0);
  });

  test("several edits inside the window are saved as one batch", async () => {
    const v = vids(6);
    const be = new FakeBackend(tracks(v));
    tools = new PlaylistTools(mount(v), be);
    await ready(tools);
    click(rowEl(5).querySelector(".y3s-cbwrap")!);
    await tools.moveTo("top"); // v5 first
    tools.clearSelection();
    click(rowEl(3).querySelector(".y3s-cbwrap")!); // v2 (index shifted)
    tools.removeSelected();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(be.applied).toHaveLength(1);
    expect(be.order()).toEqual(["v5", "v0", "v1", "v3", "v4"]);
    expect(pageOrder()).toEqual(be.order());
  });

  test("remove extra copies deletes the later copies", async () => {
    const v = [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "a", title: "A" }, { id: "a", title: "A" }];
    const be = new FakeBackend(tracks(v));
    tools = new PlaylistTools(mount(v), be);
    await ready(tools);
    tools.removeExtraCopies();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(be.applied[0].map((c) => [c.kind, c.playlistItemId])).toEqual([
      ["delete", "p2"],
      ["delete", "p3"],
    ]);
    expect(be.order()).toEqual(["a", "b"]);
    expect(document.querySelectorAll("ytd-playlist-video-renderer")).toHaveLength(2);
  });

  test("unavailable videos YouTube hides are counted and can be removed", async () => {
    const shown = vids(3);
    const server: ServerTrack[] = [
      { playlistItemId: "p0", videoId: "v0", title: "Video 0" },
      { playlistItemId: "px", videoId: "gone1", title: "Private video" },
      { playlistItemId: "p1", videoId: "v1", title: "Video 1" },
      { playlistItemId: "p2", videoId: "v2", title: "Video 2" },
      { playlistItemId: "py", videoId: "gone2", title: "Deleted video" },
    ];
    const be = new FakeBackend(server);
    tools = new PlaylistTools(mount(shown), be);
    await ready(tools);
    expect(tools.bar.textContent).toContain("Unavailable · 2");
    tools.removeUnavailable();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(be.order()).toEqual(["v0", "v1", "v2"]);
    expect(be.applied[0].every((c) => c.kind === "delete")).toBe(true);
  });

  test("hidden items keep their place when the page is reordered", async () => {
    const shown = vids(3);
    const server: ServerTrack[] = [
      { playlistItemId: "p0", videoId: "v0", title: "Video 0" },
      { playlistItemId: "px", videoId: "gone", title: "Private video" },
      { playlistItemId: "p1", videoId: "v1", title: "Video 1" },
      { playlistItemId: "p2", videoId: "v2", title: "Video 2" },
    ];
    const be = new FakeBackend(server);
    tools = new PlaylistTools(mount(shown), be);
    await ready(tools);
    click(rowEl(2).querySelector(".y3s-cbwrap")!);
    await tools.moveTo("top");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(be.order()).toEqual(["v2", "v0", "gone", "v1"]);
  });

  test("sorting an owned playlist saves the new order", async () => {
    const v = [{ id: "c", title: "Cherry" }, { id: "a", title: "apple" }, { id: "b", title: "Banana" }];
    const be = new FakeBackend(tracks(v));
    tools = new PlaylistTools(mount(v), be);
    await ready(tools);
    await tools.sortBy("title");
    expect(pageOrder()).toEqual(["a", "b", "c"]);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(be.order()).toEqual(["a", "b", "c"]);
  });

  test("large batches ask first; cancelling restores the page", async () => {
    const v = vids(40);
    const be = new FakeBackend(tracks(v));
    tools = new PlaylistTools(mount(v), be);
    await ready(tools);
    await tools.sortBy("reverse");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    const dialog = document.querySelector(".y3s-dialog")!;
    expect(dialog.textContent).toContain("39 changes");
    expect(dialog.textContent).toContain("1,950");
    click([...dialog.querySelectorAll("button")].find((b) => b.textContent === "Undo changes")!);
    await vi.advanceTimersByTimeAsync(10);
    expect(be.applied).toHaveLength(0);
    expect(pageOrder()).toEqual(v.map((x) => x.id));
  });

  test("large batches save after confirming", async () => {
    const v = vids(30);
    const be = new FakeBackend(tracks(v));
    tools = new PlaylistTools(mount(v), be);
    await ready(tools);
    await tools.sortBy("reverse");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    click([...document.querySelectorAll(".y3s-dialog button")].find((b) => b.textContent === "Save")!);
    await vi.advanceTimersByTimeAsync(10);
    expect(be.order()).toEqual(v.map((x) => x.id).reverse());
  });

  test("a failed save reports partial progress and stops further saves", async () => {
    const v = vids(5);
    const be = new FakeBackend(tracks(v));
    be.failAt = 1;
    tools = new PlaylistTools(mount(v), be);
    await ready(tools);
    tools.selectAllVisible();
    tools.removeSelected();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(snackText()).toContain("Couldn't save");
    expect(snackText()).toContain("1 of 5 saved");
    expect(be.server).toHaveLength(4);
    tools.selectAllVisible();
    tools.removeSelected();
    expect(snackText()).toContain("Reload");
  });
});

describe("permissions", () => {
  test("signed out: edits ask to sign in and change nothing", async () => {
    const v = vids(3);
    const be = new FakeBackend(tracks(v), { signedIn: false, owned: true });
    tools = new PlaylistTools(mount(v), be);
    await ready(tools);
    expect(tools.access).toBe("signed-out");
    expect(tools.bar.textContent).toContain("Sign in to edit");
    click(rowEl(0).querySelector(".y3s-cbwrap")!);
    tools.removeSelected();
    expect(pageOrder()).toHaveLength(3);
    expect(snackText()).toContain("Sign in");
    await tools.signIn();
    expect(tools.access).toBe("editable");
  });

  test("someone else's playlist: no edit buttons, sorting is page-only", async () => {
    const v = [{ id: "b", title: "B" }, { id: "a", title: "A" }];
    const be = new FakeBackend(tracks(v), { signedIn: true, owned: false });
    tools = new PlaylistTools(mount(v), be);
    await ready(tools);
    expect(tools.access).toBe("view-only");
    const labels = [...tools.bar.querySelectorAll<HTMLElement>(".y3s-sel-actions .y3s-btn")]
      .filter((b) => !b.hidden)
      .map((b) => b.textContent);
    expect(labels).toEqual(["Play", "New phase"]);
    await tools.sortBy("title");
    expect(pageOrder()).toEqual(["a", "b"]);
    expect(snackText()).toContain("only on this page");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(be.applied).toHaveLength(0);
  });

  test("when YouTube shows a non-manual order, reordering is refused but deletes still save", async () => {
    const v = vids(4);
    const server = tracks(v);
    const be = new FakeBackend([server[2], server[0], server[1], server[3]]);
    tools = new PlaylistTools(mount(v), be);
    await ready(tools);
    click(rowEl(3).querySelector(".y3s-cbwrap")!);
    await tools.moveTo("top");
    expect(pageOrder()[0]).toBe("v0");
    expect(snackText()).toContain("Manual");
    await tools.sortBy("reverse");
    expect(snackText()).toContain("only on this page");
    tools.removeSelected();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(be.applied[0]).toEqual([{ kind: "delete", playlistItemId: "p3", videoId: "v3" }]);
  });
});

describe("misc", () => {
  test("playlist order restores the original view", async () => {
    const v = vids(4);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v), { signedIn: true, owned: false }));
    await ready(tools);
    await tools.sortBy("reverse");
    await tools.sortBy("manual");
    expect(pageOrder()).toEqual(["v0", "v1", "v2", "v3"]);
  });

  test("destroy removes everything it added", async () => {
    const v = vids(2);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    tools.destroy();
    tools = null;
    expect(document.querySelector(".y3s-bar, .y3s-cbwrap, .y3s-row")).toBeNull();
  });

  test("server items unknown to the page are matched as rows appear", async () => {
    const v = vids(4);
    const be = new FakeBackend(tracks(v));
    tools = new PlaylistTools(mount(v.slice(0, 2), { continuation: true }), be);
    await ready(tools);
    const contents = document.querySelector("ytd-playlist-video-list-renderer #contents")!;
    const tpl = document.createElement("template");
    tpl.innerHTML = v.slice(2).map((x, i) => rowHtml(x, i + 2)).join("");
    contents.querySelector("ytd-continuation-item-renderer")!.before(tpl.content);
    contents.querySelector("ytd-continuation-item-renderer")!.remove();
    await vi.advanceTimersByTimeAsync(200);
    const ids = [...document.querySelectorAll<HTMLElement>("ytd-playlist-video-renderer")].map((r) => r.dataset.y3sItem);
    expect(ids).toEqual(["p0", "p1", "p2", "p3"]);
  });

  test("server snapshot replay helper sanity", () => {
    const s: ServerItem[] = [{ playlistItemId: "a", videoId: "1" }];
    expect(applyChanges(s, [])).toEqual(s);
  });
});

// ───────────────────────────────────────────────────────── phases

const headers = () => [...document.querySelectorAll<HTMLElement>(".y3s-phase")];
const phaseIdAt = (i: number) => headers()[i].dataset.y3sKey!.slice(1);
const visibleIds = () =>
  [...document.querySelectorAll("ytd-playlist-video-renderer:not(.y3s-removed):not(.y3s-collapsed):not(.y3s-hidden)")].map(
    (r) => /v=([^&]+)/.exec(r.querySelector("a")!.getAttribute("href")!)![1],
  );
const layout = () =>
  [...document.querySelector("ytd-playlist-video-list-renderer #contents")!.children].map((el) =>
    el.classList.contains("y3s-phase")
      ? `[${el.querySelector(".y3s-phase-name")!.textContent}]`
      : /v=([^&]+)/.exec(el.querySelector("a")!.getAttribute("href")!)![1],
  );

describe("phases", () => {
  beforeEach(() => {
    (chrome.storage.local as unknown as { data: Record<string, unknown> }).data = {};
  });

  test("split makes collapsed phases with counts; expanding shows the videos", async () => {
    const v = vids(7);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    await tools.splitInto(3);
    expect(tools.phaseNames()).toEqual(["Videos 1–3", "Videos 4–6", "Videos 7–7"]);
    expect(headers().every((h) => h.classList.contains("y3s-folded"))).toBe(true);
    expect(visibleIds()).toEqual([]);
    expect(headers()[1].textContent).toContain("3 videos");
    click(headers()[2]);
    expect(visibleIds()).toEqual(["v6"]);
  });

  test("filtering finds videos inside folded phases", async () => {
    const v = vids(6);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    await tools.splitInto(3);
    tools.setQuery("Video 4");
    expect(visibleIds()).toEqual(["v4"]);
    expect(headers()[0].hidden).toBe(true);
    expect(headers()[1].textContent).toContain("1 of 3 videos");
    tools.setQuery("");
    expect(visibleIds()).toEqual([]);
  });

  test("moving videos into another phase saves the new order", async () => {
    const v = vids(6);
    const be = new FakeBackend(tracks(v));
    tools = new PlaylistTools(mount(v), be);
    await ready(tools);
    await tools.splitInto(3);
    tools.setAllCollapsed(false);
    click(rowEl(4).querySelector(".y3s-cbwrap")!);
    await tools.moveSelectionToPhase(phaseIdAt(0));
    expect(layout()).toEqual(["[Videos 1–3]", "v0", "v1", "v2", "v4", "[Videos 4–6]", "v3", "v5"]);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(be.order()).toEqual(["v0", "v1", "v2", "v4", "v3", "v5"]);
    expect(be.applied[0]).toHaveLength(1);
  });

  test("moving a phase block and sorting inside a phase are saved", async () => {
    const v = [
      { id: "a", title: "Cherry" },
      { id: "b", title: "apple" },
      { id: "c", title: "Banana" },
      { id: "d", title: "Date" },
      { id: "e", title: "Elder" },
    ];
    const be = new FakeBackend(tracks(v));
    tools = new PlaylistTools(mount(v), be);
    await ready(tools);
    await tools.splitInto(3);
    await tools.movePhaseTo(phaseIdAt(1), "top");
    expect(layout()).toEqual(["[Videos 4–5]", "d", "e", "[Videos 1–3]", "a", "b", "c"]);
    await tools.sortPhase(phaseIdAt(1), "title");
    expect(layout()).toEqual(["[Videos 4–5]", "d", "e", "[Videos 1–3]", "b", "c", "a"]);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(be.order()).toEqual(["d", "e", "b", "c", "a"]);
  });

  test("new phase from a scattered selection gathers it after the first video's section", async () => {
    const v = vids(5);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v), { signedIn: true, owned: false }));
    await ready(tools);
    click(rowEl(1).querySelector(".y3s-cbwrap")!);
    click(rowEl(3).querySelector(".y3s-cbwrap")!);
    await tools.newPhaseFromSelection();
    (document.querySelector(".y3s-phase-input") as HTMLInputElement).value = "Keepers";
    document.querySelector(".y3s-phase-input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(layout()).toEqual(["v0", "v2", "v4", "[Keepers]", "v1", "v3"]);
    expect(snackText()).toContain("only on this page");
  });

  test("start phase here splits without moving; remove phase keeps the videos; undo", async () => {
    const v = vids(4);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    tools.onKey(key("j"));
    tools.onKey(key("j"));
    tools.onKey(key("p"));
    document.querySelector(".y3s-phase-input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(layout()).toEqual(["v0", "[Phase 1]", "v1", "v2", "v3"]);
    tools.removePhase(phaseIdAt(0));
    expect(layout()).toEqual(["v0", "v1", "v2", "v3"]);
    tools.undo();
    expect(layout()).toEqual(["v0", "[Phase 1]", "v1", "v2", "v3"]);
  });

  test("phases are kept per playlist and come back folded", async () => {
    const v = vids(6);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    await tools.splitInto(2);
    tools.setAllCollapsed(false);
    tools.destroy();
    tools = null;
    expect(document.querySelector(".y3s-phase")).toBeNull();

    tools = new PlaylistTools(document.querySelector("ytd-playlist-video-list-renderer")!, new FakeBackend(tracks(v)));
    await ready(tools);
    await vi.advanceTimersByTimeAsync(10);
    expect(tools.phaseNames()).toEqual(["Videos 1–2", "Videos 3–4", "Videos 5–6"]);
    expect(layout()).toEqual(["[Videos 1–2]", "v0", "v1", "[Videos 3–4]", "v2", "v3", "[Videos 5–6]", "v4", "v5"]);
    expect(headers().every((h) => h.classList.contains("y3s-folded"))).toBe(true);
  });

  test("clear all phases forgets them", async () => {
    const v = vids(4);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    await tools.splitInto(2);
    tools.clearPhases();
    await vi.advanceTimersByTimeAsync(400);
    expect(headers()).toHaveLength(0);
    expect(Object.keys((chrome.storage.local as unknown as { data: object }).data)).toHaveLength(0);
  });

  test("dividers YouTube re-renders away are put back", async () => {
    const v = vids(4);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    await tools.splitInto(2);
    await vi.advanceTimersByTimeAsync(400);
    headers().forEach((h) => h.remove());
    await vi.advanceTimersByTimeAsync(200);
    expect(layout()).toEqual(["[Videos 1–2]", "v0", "v1", "[Videos 3–4]", "v2", "v3"]);
  });
});

describe("splitting phases and playing them", () => {
  beforeEach(() => {
    (chrome.storage.local as unknown as { data: Record<string, unknown> }).data = {};
    sessionStorage.clear();
  });

  test("New phase on one selected video splits its phase there and renumbers range names", async () => {
    const v = vids(10);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    await tools.splitInto(10);
    tools.setAllCollapsed(false);
    click(rowEl(4).querySelector(".y3s-cbwrap")!);
    await tools.newPhaseFromSelection();
    expect(layout()).toEqual(["[Videos 1–4]", "v0", "v1", "v2", "v3", "[Videos 5–10]", "v4", "v5", "v6", "v7", "v8", "v9"]);
    expect(snackText()).toContain("Split Videos 1–10");
    expect(document.querySelector(".y3s-phase-input")).toBeNull();
  });

  test("a run of neighbours splits too; a named phase keeps its name and the new one gets renamed", async () => {
    const v = vids(6);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    tools.onKey(key("j"));
    tools.onKey(key("p"));
    const input = document.querySelector(".y3s-phase-input") as HTMLInputElement;
    input.value = "Chill";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    click(rowEl(3).querySelector(".y3s-cbwrap")!);
    click(rowEl(4).querySelector(".y3s-cbwrap")!);
    await tools.newPhaseFromSelection();
    const nameInput = document.querySelector(".y3s-phase-input") as HTMLInputElement;
    nameInput.value = "Hype";
    nameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(layout()).toEqual(["[Chill]", "v0", "v1", "v2", "[Hype]", "v3", "v4", "v5"]);
  });

  test("selecting the first video of a phase doesn't add an empty split", async () => {
    const v = vids(4);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    await tools.splitInto(2);
    tools.setAllCollapsed(false);
    click(rowEl(2).querySelector(".y3s-cbwrap")!);
    await tools.newPhaseFromSelection();
    expect(headers()).toHaveLength(2);
    expect(snackText()).toContain("already starts here");
  });

  test("Loop phase stores the phase's videos with playlist positions and opens the first", async () => {
    const v = vids(6);
    tools = new PlaylistTools(mount(v), new FakeBackend(tracks(v)));
    await ready(tools);
    await tools.splitInto(3);
    const clicked: string[] = [];
    document.addEventListener("click", (e) => {
      const a = (e.target as Element).closest("a");
      if (a) {
        e.preventDefault();
        clicked.push(a.getAttribute("href")!);
      }
    });
    tools.playPhase(phaseIdAt(1), { loop: true });
    const st = JSON.parse(sessionStorage.getItem("y3s:play")!);
    expect(st.items).toEqual([
      { videoId: "v3", index: 4 },
      { videoId: "v4", index: 5 },
      { videoId: "v5", index: 6 },
    ]);
    expect(st.loop).toBe(true);
    expect(st.name).toBe("Videos 4–6");
    expect(clicked[0]).toContain("v=v3");
  });
});

test("rows that arrive just before an edit are included in it", async () => {
  vi.useFakeTimers();
  const v = vids(6);
  tools = new PlaylistTools(mount(v.slice(0, 3)), new FakeBackend(tracks(v), { signedIn: true, owned: false }));
  await ready(tools);
  const contents = document.querySelector("ytd-playlist-video-list-renderer #contents")!;
  const tpl = document.createElement("template");
  tpl.innerHTML = v.slice(3).map((x, i) => rowHtml(x, i + 3)).join("");
  contents.append(tpl.content); // no time for the observer to run
  await tools.splitInto(3);
  expect(layout()).toEqual(["[Videos 1–3]", "v0", "v1", "v2", "[Videos 4–6]", "v3", "v4", "v5"]);
  await tools.sortBy("reverse");
  tools.setAllCollapsed(false);
  expect(layout()).toEqual(["[Videos 1–3]", "v2", "v1", "v0", "[Videos 4–6]", "v5", "v4", "v3"]);
});
