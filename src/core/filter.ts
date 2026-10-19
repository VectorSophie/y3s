// Filtering, duplicate detection and sorting over plain row data.

import { normalize } from "../shared/utils";

export interface RowData {
  videoId: string | null;
  title: string;
  channel: string;
  /** Seconds, or null when unknown (live, unavailable). */
  duration: number | null;
  unavailable: boolean;
}

export type Chip = "all" | "dups" | "unavail";

/** Every whitespace-separated word must appear in title, channel or id. */
export function matchesQuery(row: RowData, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = normalize(`${row.title} ${row.channel} ${row.videoId ?? ""}`);
  return words.every((w) => hay.includes(w));
}

/** Video ids that appear more than once. */
export function duplicateIds(rows: RowData[]): Set<string> {
  const seen = new Map<string, number>();
  for (const r of rows) if (r.videoId) seen.set(r.videoId, (seen.get(r.videoId) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id));
}

/** Indexes of every copy after the first of each repeated video. */
export function extraCopies(rows: RowData[]): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  rows.forEach((r, i) => {
    if (!r.videoId) return;
    if (seen.has(r.videoId)) out.push(i);
    else seen.add(r.videoId);
  });
  return out;
}

export function isVisible(row: RowData, query: string, chip: Chip, dups: Set<string>): boolean {
  if (!matchesQuery(row, query)) return false;
  if (chip === "dups") return !!row.videoId && dups.has(row.videoId);
  if (chip === "unavail") return row.unavailable;
  return true;
}

const UNAVAILABLE_TITLE = /^\[?(private|deleted|unavailable) video\]?$/i;
export const isUnavailableTitle = (title: string) => UNAVAILABLE_TITLE.test(title.trim());

export type SortKey = "manual" | "title" | "channel" | "short" | "long" | "reverse" | "shuffle";

export const SORTS: [SortKey, string][] = [
  ["manual", "Playlist order"],
  ["title", "Title (A–Z)"],
  ["channel", "Channel (A–Z)"],
  ["short", "Shortest first"],
  ["long", "Longest first"],
  ["reverse", "Reverse current order"],
  ["shuffle", "Shuffle once"],
];

/**
 * New order (as indexes into `rows`) for a sort. `original` gives each row's
 * position in the playlist, used by "manual". Sorts are stable.
 */
export function sortOrder(
  rows: RowData[],
  key: SortKey,
  original: number[],
  random: () => number = Math.random,
): number[] {
  const idx = rows.map((_, i) => i);
  const text = (f: "title" | "channel") => (a: number, b: number) =>
    rows[a][f].localeCompare(rows[b][f], undefined, { sensitivity: "base", numeric: true });
  const dur = (i: number, missing: number) => rows[i].duration ?? missing;
  switch (key) {
    case "manual":
      return idx.sort((a, b) => original[a] - original[b]);
    case "title":
      return idx.sort(text("title"));
    case "channel":
      return idx.sort((a, b) => text("channel")(a, b) || text("title")(a, b));
    case "short":
      return idx.sort((a, b) => dur(a, Infinity) - dur(b, Infinity));
    case "long":
      return idx.sort((a, b) => dur(b, -1) - dur(a, -1));
    case "reverse":
      return idx.reverse();
    case "shuffle":
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      return idx;
  }
}

/** "1h 5m" / "42m" */
export function formatTotal(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
