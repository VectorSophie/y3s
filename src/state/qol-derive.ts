// Pure derivations over indexed rows. No DOM, no chrome — unit-testable.

import type { NativeRow } from "../shared/types";

/** videoIds that appear more than once in the list. */
export function findDuplicateVideoIds(rows: NativeRow[]): Set<string> {
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.videoId, (seen.get(r.videoId) ?? 0) + 1);
  const dup = new Set<string>();
  for (const [id, n] of seen) if (n > 1) dup.add(id);
  return dup;
}

/** Sum of known durations (seconds); rows without a duration are skipped. */
export function totalRuntimeSeconds(rows: NativeRow[]): number {
  return rows.reduce((acc, r) => acc + (r.durationSec ?? 0), 0);
}

/** Case-insensitive match against title or channel. Empty query matches all. */
export function rowMatchesQuery(row: NativeRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.title.toLowerCase().includes(q) ||
    (row.channel ?? "").toLowerCase().includes(q)
  );
}
