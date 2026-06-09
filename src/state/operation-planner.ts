// Computes costed operation plans BEFORE anything is applied, so the UI can
// show call count / quota / risk in a confirmation modal.

import { HIGH_RISK_WRITE_THRESHOLD, QUOTA_COST } from "../shared/constants";
import type { OperationPlan, Track } from "../shared/types";
import { count, uid } from "../shared/utils";

function riskFor(writes: number): OperationPlan["riskLevel"] {
  if (writes === 0) return "none";
  if (writes >= HIGH_RISK_WRITE_THRESHOLD) return "high";
  if (writes >= 5) return "medium";
  return "low";
}

/** Plan to delete the given tracks (one delete call each). */
export function buildDeletePlan(tracks: Track[]): OperationPlan {
  const calls = tracks.length;
  return {
    id: uid("plan"),
    type: "delete",
    description: `Delete ${count(tracks.length, "track")} from this playlist.`,
    estimatedApiCalls: calls,
    estimatedQuotaCost: calls * QUOTA_COST.delete,
    riskLevel: riskFor(calls),
    affectedVideoIds: tracks.map((t) => t.videoId),
    operations: tracks.map((t) => ({
      kind: "delete" as const,
      playlistItemId: t.playlistItemId,
      videoId: t.videoId,
      label: `Delete “${t.title}”`,
    })),
  };
}

/**
 * Plan to move a set of tracks to the top or bottom. Each moved item is one
 * update call; positions are computed from the resulting order.
 */
export function buildMovePlan(
  selected: Track[],
  all: Track[],
  edge: "top" | "bottom",
): OperationPlan {
  const selectedIds = new Set(selected.map((t) => t.videoId));
  const others = all.filter((t) => !selectedIds.has(t.videoId));
  const ordered =
    edge === "top" ? [...selected, ...others] : [...others, ...selected];

  const operations = selected.map((t) => {
    const toPosition = ordered.findIndex((o) => o.videoId === t.videoId);
    return {
      kind: "updatePosition" as const,
      playlistItemId: t.playlistItemId,
      videoId: t.videoId,
      toPosition,
      label: `Move “${t.title}” → position ${toPosition + 1}`,
    };
  });

  return {
    id: uid("plan"),
    type: "move",
    description: `Move ${count(selected.length, "track")} to the ${edge}.`,
    estimatedApiCalls: operations.length,
    estimatedQuotaCost: operations.length * QUOTA_COST.update,
    riskLevel: riskFor(operations.length),
    affectedVideoIds: selected.map((t) => t.videoId),
    operations,
  };
}

/**
 * Plan to apply a fully reordered list to YouTube. Only items whose position
 * actually changes need an update call. This is the expensive one.
 */
export function buildSortPlan(
  current: Track[],
  orderedVideoIds: string[],
): OperationPlan {
  const targetIndex = new Map(orderedVideoIds.map((id, i) => [id, i]));
  const moved = current.filter((t) => targetIndex.get(t.videoId) !== t.position);

  const operations = moved
    .map((t) => {
      const toPosition = targetIndex.get(t.videoId)!;
      return {
        kind: "updatePosition" as const,
        playlistItemId: t.playlistItemId,
        videoId: t.videoId,
        toPosition,
        label: `“${t.title}” → position ${toPosition + 1}`,
      };
    })
    .sort((a, b) => a.toPosition - b.toPosition);

  return {
    id: uid("plan"),
    type: "sort",
    description: `Reorder ${count(moved.length, "track")} to match the new order.`,
    estimatedApiCalls: operations.length,
    estimatedQuotaCost: operations.length * QUOTA_COST.update,
    riskLevel: riskFor(operations.length),
    affectedVideoIds: moved.map((t) => t.videoId),
    operations,
  };
}
