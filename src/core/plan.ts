// Turns "what the playlist looks like now on YouTube" plus "what the user made
// it look like on the page" into the smallest list of API writes.
//
// Pure functions, no DOM or chrome APIs.

import type { Change } from "../shared/types";

export interface ServerItem {
  playlistItemId: string;
  videoId: string;
}

/**
 * Indices (into `seq`) of one longest strictly increasing subsequence.
 * Items on it can stay put; everything else has to move.
 */
export function longestIncreasing(seq: number[]): Set<number> {
  const tails: number[] = []; // index into seq of the smallest tail per length
  const prev = new Array<number>(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i !== -1; i = prev[i]) keep.add(i);
  return keep;
}

/**
 * Moves that turn `current` into `target` (both lists of unique ids holding
 * the same members). Each move's `position` is the 0-based index the item
 * ends up at, which is what playlistItems.update expects when applied in
 * order. Uses the fewest moves possible.
 */
export function planMoves(current: string[], target: string[]): { id: string; position: number }[] {
  if (current.length !== target.length) throw new Error("planMoves: lists differ in length");
  const tIndex = new Map(target.map((id, i) => [id, i]));
  if (tIndex.size !== target.length) throw new Error("planMoves: duplicate ids in target");
  const seq = current.map((id) => {
    const i = tIndex.get(id);
    if (i === undefined) throw new Error(`planMoves: ${id} missing from target`);
    return i;
  });
  const keepIdx = longestIncreasing(seq);
  const settled = new Set([...keepIdx].map((i) => current[i]));

  const sim = current.slice();
  const out: { id: string; position: number }[] = [];
  for (let k = 0; k < target.length; k++) {
    const id = target[k];
    if (settled.has(id)) continue;
    sim.splice(sim.indexOf(id), 1);
    // Everything in target[0..k-1] is already in final relative order, so
    // placing right after target[k-1] keeps the settled set ordered.
    const pos = k === 0 ? 0 : sim.indexOf(target[k - 1]) + 1;
    sim.splice(pos, 0, id);
    out.push({ id, position: pos });
    settled.add(id);
  }
  return out;
}

/** Replays changes against a server list, returning the resulting list. */
export function applyChanges(server: ServerItem[], changes: Change[]): ServerItem[] {
  const list = server.slice();
  for (const c of changes) {
    const i = list.findIndex((s) => s.playlistItemId === c.playlistItemId);
    if (i < 0) throw new Error(`applyChanges: unknown item ${c.playlistItemId}`);
    const [item] = list.splice(i, 1);
    if (c.kind === "move") list.splice(c.position, 0, item);
  }
  return list;
}

/**
 * Full desired order for the server list.
 *
 * `shown` is the order of the items the page shows (by playlistItemId). Items
 * the page doesn't show (YouTube hides unavailable videos) keep their place
 * next to the shown item they followed; ones after the last shown item stay at
 * the end.
 */
export function desiredOrder(server: ServerItem[], shown: string[]): string[] {
  const shownSet = new Set(shown);
  const leading: string[] = [];
  const followers = new Map<string, string[]>();
  let last: string | null = null;
  let lastShownIdx = -1;
  server.forEach((s, i) => {
    if (shownSet.has(s.playlistItemId)) lastShownIdx = i;
  });
  const trailing: string[] = [];
  server.forEach((s, i) => {
    const id = s.playlistItemId;
    if (shownSet.has(id)) {
      last = id;
      return;
    }
    if (i > lastShownIdx) trailing.push(id);
    else if (last === null) leading.push(id);
    else followers.set(last, [...(followers.get(last) ?? []), id]);
  });
  const out = [...leading];
  for (const id of shown) out.push(id, ...(followers.get(id) ?? []));
  out.push(...trailing);
  return out;
}

/**
 * Everything needed to make the server list match the page: deletes first
 * (they never shift the planned move positions), then the minimal moves.
 */
export function planChanges(server: ServerItem[], shown: string[], removed: Set<string>): Change[] {
  const byId = new Map(server.map((s) => [s.playlistItemId, s]));
  for (const id of [...shown, ...removed]) {
    if (!byId.has(id)) throw new Error(`planChanges: ${id} is not in the playlist`);
  }
  const changes: Change[] = [];
  for (const s of server) {
    if (removed.has(s.playlistItemId)) {
      changes.push({ kind: "delete", playlistItemId: s.playlistItemId, videoId: s.videoId });
    }
  }
  const remaining = server.filter((s) => !removed.has(s.playlistItemId));
  const target = desiredOrder(
    remaining,
    shown.filter((id) => !removed.has(id)),
  );
  for (const m of planMoves(
    remaining.map((s) => s.playlistItemId),
    target,
  )) {
    changes.push({ kind: "move", playlistItemId: m.id, videoId: byId.get(m.id)!.videoId, position: m.position });
  }
  return changes;
}
