// Connects the rows YouTube rendered to the items the API returned.

import type { ServerItem } from "./plan";

/**
 * playlistItemId for each row, by video id. Repeated videos are paired in
 * order of appearance, so the 2nd row of a video gets its 2nd playlist item.
 * Rows with no matching item get null.
 */
export function matchRows(rowVideoIds: (string | null)[], server: ServerItem[]): (string | null)[] {
  const queues = new Map<string, string[]>();
  for (const s of server) {
    const q = queues.get(s.videoId) ?? [];
    q.push(s.playlistItemId);
    queues.set(s.videoId, q);
  }
  return rowVideoIds.map((v) => (v ? (queues.get(v)?.shift() ?? null) : null));
}

/**
 * True when the page lists the matched items in the same relative order as
 * the playlist itself, i.e. YouTube's view is sorted manually. When the user
 * picked "Date added" or similar on YouTube, positions on the page don't
 * mean playlist positions, so reordering must be turned off.
 */
export function inPlaylistOrder(matchedIds: (string | null)[], server: ServerItem[]): boolean {
  const pos = new Map(server.map((s, i) => [s.playlistItemId, i]));
  let last = -1;
  for (const id of matchedIds) {
    if (!id) continue;
    const p = pos.get(id);
    if (p === undefined) continue;
    if (p < last) return false;
    last = p;
  }
  return true;
}
