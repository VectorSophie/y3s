// Playing a phase (or a selection) inside the real playlist: which video comes
// next, looping, shuffling. Pure; the watch page drives it.

export interface PlayItem {
  videoId: string;
  /** 1-based position in the playlist, as a hint for YouTube's `index`. */
  index: number;
}

export interface PlayState {
  playlistId: string;
  name: string;
  items: PlayItem[];
  /** Play order, as indexes into items. */
  order: number[];
  /** Position in `order` of the video playing now. */
  pos: number;
  loop: boolean;
  shuffle: boolean;
  /** Video we're navigating to, so its arrival isn't mistaken for the user leaving. */
  pending: string | null;
  startedAt: number;
}

export function shuffled(n: number, random: () => number = Math.random, avoidFirst?: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  // Don't replay the same video straight after a reshuffle.
  if (avoidFirst !== undefined && n > 1 && a[0] === avoidFirst) [a[0], a[n - 1]] = [a[n - 1], a[0]];
  return a;
}

export function startPlay(
  o: { playlistId: string; name: string; items: PlayItem[]; loop: boolean; shuffle: boolean },
  random: () => number = Math.random,
  now = Date.now(),
): PlayState {
  const order = o.shuffle ? shuffled(o.items.length, random) : o.items.map((_, i) => i);
  return { ...o, order, pos: 0, pending: o.items[order[0]]?.videoId ?? null, startedAt: now };
}

export const current = (s: PlayState): PlayItem | undefined => s.items[s.order[s.pos]];

export function contains(s: PlayState, videoId: string | null): boolean {
  return !!videoId && s.items.some((i) => i.videoId === videoId);
}

/**
 * Where `videoId` is in the play order: the copy at or after the current
 * position first (a phase can hold the same video twice), else the first one.
 */
export function locate(s: PlayState, videoId: string): number {
  const at = (p: number) => s.items[s.order[p]]?.videoId === videoId;
  for (let p = s.pos; p < s.order.length; p++) if (at(p)) return p;
  for (let p = 0; p < s.pos; p++) if (at(p)) return p;
  return -1;
}

/**
 * The state after the current video finishes, or null at the end of a
 * non-looping run. Looping a shuffled phase reshuffles each round.
 */
export function advance(s: PlayState, random: () => number = Math.random): PlayState | null {
  if (s.pos + 1 < s.order.length) return { ...s, pos: s.pos + 1 };
  if (!s.loop) return null;
  const order = s.shuffle ? shuffled(s.items.length, random, s.order[s.pos]) : s.order;
  return { ...s, order, pos: 0 };
}

/** Turn shuffle on or off without changing the video playing now. */
export function setShuffle(s: PlayState, on: boolean, random: () => number = Math.random): PlayState {
  if (on === s.shuffle) return s;
  const now = s.order[s.pos];
  if (!on) return { ...s, shuffle: false, order: s.items.map((_, i) => i), pos: now };
  const rest = shuffled(s.items.length, random).filter((i) => i !== now);
  return { ...s, shuffle: true, order: [now, ...rest], pos: 0 };
}

export function watchUrl(s: PlayState, item: PlayItem): string {
  return `/watch?v=${encodeURIComponent(item.videoId)}&list=${encodeURIComponent(s.playlistId)}&index=${item.index}`;
}

/** The state for "previous in phase": one back, wrapping only when looping. */
export function back(s: PlayState): PlayState {
  if (s.pos > 0) return { ...s, pos: s.pos - 1 };
  return s.loop ? { ...s, pos: s.order.length - 1 } : s;
}
