// Keeps playback inside a phase (or selection) on the watch page.
//
// Just before a video ends, y3s pauses it and opens the next video of the
// phase itself, so YouTube's autoplay never gets the chance to walk out of the
// phase. If YouTube gets there first anyway (background tab, missed tick), the
// next page load is redirected. Choosing a video outside the phase yourself
// ends phase playback.
//
// State lives in the tab's sessionStorage so it survives YouTube's page
// changes and reloads, and never leaks into other tabs.

import {
  advance,
  contains,
  current,
  locate,
  setShuffle,
  watchUrl,
  type PlayItem,
  type PlayState,
} from "../core/phase-play";
import { h, icon, ICONS } from "./ui/dom";
import { showSnack } from "./ui/snackbar";
import { findPlaylistPanel, SEL } from "./yt-dom";

const KEY = "y3s:play";
/** Seconds before the end at which we move on ourselves. */
const LEAD = 0.6;

export function loadPlay(): PlayState | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlayState) : null;
  } catch {
    return null;
  }
}

export function savePlay(s: PlayState | null): void {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: playback just won't survive a page change */
  }
}

const videoParam = () => new URLSearchParams(location.search).get("v");

function mainVideo(): HTMLVideoElement | null {
  return (
    document.querySelector<HTMLVideoElement>("#movie_player video.html5-main-video") ??
    document.querySelector<HTMLVideoElement>("#movie_player video") ??
    document.querySelector<HTMLVideoElement>("video")
  );
}

const adShowing = () => !!document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting");

export class PhasePlayer {
  private s: PlayState;
  private video: HTMLVideoElement | null = null;
  private jumpedFrom: string | null = null;
  private endedAt = 0;
  private finished = false;
  private seenVideo: string | null = null;
  private pill: HTMLElement | null = null;
  private pillPanel: HTMLElement | null = null;
  private stopped = false;
  private redirects = 0;

  constructor(state: PlayState) {
    this.s = state;
    this.tick();
  }

  get state(): PlayState {
    return this.s;
  }
  get playlistId(): string {
    return this.s.playlistId;
  }

  destroy(): void {
    this.detachVideo();
    this.pill?.remove();
    this.pill = null;
    for (const r of document.querySelectorAll(".y3s-outside")) r.classList.remove("y3s-outside");
  }

  /** Called on every navigation and once a second. */
  tick(): void {
    if (this.stopped) return;
    const v = videoParam();
    if (v && v !== this.seenVideo) {
      this.seenVideo = v;
      this.onNavigate(v);
      if (this.stopped) return;
    }
    const video = mainVideo();
    if (video !== this.video) {
      this.detachVideo();
      this.video = video;
      video?.addEventListener("timeupdate", this.onTime);
      video?.addEventListener("ended", this.onEnded);
    }
    this.render();
  }

  private detachVideo(): void {
    this.video?.removeEventListener("timeupdate", this.onTime);
    this.video?.removeEventListener("ended", this.onEnded);
    this.video = null;
  }

  private update(next: PlayState): void {
    this.s = next;
    savePlay(next);
  }

  private onNavigate(v: string): void {
    this.jumpedFrom = null;
    this.finished = false;
    const s = this.s;
    if (s.pending === v || contains(s, v)) {
      this.redirects = 0;
      const pos = locate(s, v);
      this.update({ ...s, pos: pos < 0 ? s.pos : pos, pending: null });
      return;
    }
    // Outside the phase. Either YouTube's autoplay beat us to it, or the
    // user picked another video.
    if ((s.pending || Date.now() - this.endedAt < 8000) && this.redirects < 3) {
      const target = s.pending ? s.items.find((i) => i.videoId === s.pending) : this.nextItem();
      if (target) {
        this.redirects++;
        return this.go(target);
      }
    }
    this.stop(`Stopped playing ${s.name}`);
  }

  private nextItem(): PlayItem | null {
    const n = advance(this.s);
    if (!n) return null;
    this.update(n);
    return current(n) ?? null;
  }

  private onTime = () => {
    const vid = this.video;
    if (!vid || this.finished || adShowing() || !isFinite(vid.duration) || vid.duration < 1) return;
    const playing = videoParam();
    if (!playing || !contains(this.s, playing) || this.jumpedFrom === playing) return;
    if (vid.duration - vid.currentTime > LEAD) return;
    this.finishCurrent(vid, playing);
  };

  private onEnded = () => {
    this.endedAt = Date.now();
    const vid = this.video;
    const playing = videoParam();
    if (vid && playing && contains(this.s, playing) && this.jumpedFrom !== playing && !this.finished) {
      this.finishCurrent(vid, playing);
    }
  };

  private finishCurrent(vid: HTMLVideoElement, playing: string): void {
    this.jumpedFrom = playing;
    const next = advance(this.s);
    if (!next) {
      // End of a non-looping run: stop here instead of letting YouTube go on.
      this.finished = true;
      vid.pause();
      this.render();
      showSnack(`End of ${this.s.name}`, { label: "Replay", run: () => this.restart() }, 0);
      return;
    }
    const target = current(next)!;
    this.update(next);
    if (target.videoId === playing) {
      // A one-video loop: rewind instead of navigating.
      this.jumpedFrom = null;
      vid.currentTime = 0;
      void vid.play().catch(() => undefined);
      return;
    }
    vid.pause();
    this.go(target);
  }

  restart(): void {
    const first = { ...this.s, pos: 0 };
    this.update(first);
    this.finished = false;
    this.go(current(first)!);
  }

  /** Open a video of the phase, through the playlist panel when possible. */
  private go(item: PlayItem): void {
    this.update({ ...this.s, pending: item.videoId });
    const links = [...document.querySelectorAll<HTMLAnchorElement>(`${SEL.panelRow} a[href*="watch?v="]`)].filter(
      (a) => new URLSearchParams(a.getAttribute("href")!.split("?")[1]).get("v") === item.videoId,
    );
    const best =
      links.find((a) => new URLSearchParams(a.getAttribute("href")!.split("?")[1]).get("index") === String(item.index)) ??
      links[0];
    if (best) best.click();
    else location.assign(watchUrl(this.s, item));
  }

  stop(message?: string): void {
    this.stopped = true;
    savePlay(null);
    this.destroy();
    if (message) showSnack(message);
  }

  // ─────────────────────────────────────────────────────────── UI

  private render(): void {
    const panel = findPlaylistPanel();
    if (panel !== this.pillPanel) {
      this.pill?.remove();
      this.pill = null;
      this.pillPanel = panel;
    }
    if (panel && (!this.pill || !this.pill.isConnected)) {
      this.pill = this.buildPill();
      const items = panel.querySelector("#items");
      const filterBar = panel.querySelector(".y3s-panel-bar");
      (filterBar ?? items)?.before(this.pill);
    }
    if (this.pill) this.fillPill();

    if (panel) {
      const ids = new Set(this.s.items.map((i) => i.videoId));
      for (const row of panel.querySelectorAll<HTMLElement>(SEL.panelRow)) {
        const a = row.querySelector("a[href*='watch?v=']");
        const v = a ? new URLSearchParams(a.getAttribute("href")!.split("?")[1]).get("v") : null;
        row.classList.toggle("y3s-outside", !!v && !ids.has(v));
      }
    }
  }

  private buildPill(): HTMLElement {
    const btn = (label: string, ic: string, fn: () => void, cls = "") =>
      h("button", { class: `y3s-icon-btn ${cls}`, "aria-label": label, title: label, onclick: fn }, icon(ic));
    return h(
      "div",
      { class: "y3s-play-pill", role: "group", "aria-label": "Phase playback" },
      h("span", { class: "y3s-play-icon" }, icon(ICONS.play)),
      h("div", { class: "y3s-play-text" }, h("span", { class: "y3s-play-name" }), h("span", { class: "y3s-play-pos" })),
      btn("Shuffle within phase", ICONS.shuffle, () => this.toggleShuffle(), "y3s-play-shuffle"),
      btn("Loop phase", ICONS.loop, () => this.toggleLoop(), "y3s-play-loop"),
      btn("Stop phase playback", ICONS.close, () => this.stop(`Stopped playing ${this.s.name}`)),
    );
  }

  private fillPill(): void {
    const p = this.pill!;
    const verb = this.finished ? "Finished" : this.s.loop ? "Looping" : "Playing";
    p.querySelector(".y3s-play-name")!.textContent = `${verb} ${this.s.name}`;
    p.querySelector(".y3s-play-pos")!.textContent = `${this.s.pos + 1} of ${this.s.items.length}${this.s.shuffle ? " · shuffled" : ""}`;
    p.querySelector(".y3s-play-loop")!.setAttribute("aria-pressed", String(this.s.loop));
    p.querySelector(".y3s-play-shuffle")!.setAttribute("aria-pressed", String(this.s.shuffle));
  }

  toggleLoop(): void {
    this.update({ ...this.s, loop: !this.s.loop });
    if (this.finished && this.s.loop) this.restart();
    this.render();
    showSnack(this.s.loop ? `Looping ${this.s.name}` : `${this.s.name} will stop at its last video`);
  }

  toggleShuffle(): void {
    this.update(setShuffle(this.s, !this.s.shuffle));
    this.render();
    showSnack(this.s.shuffle ? "Shuffling within the phase" : "Playing the phase in order");
  }
}
