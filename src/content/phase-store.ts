// Phases are kept per playlist in chrome.storage.local until cleared.

/** How a divider finds the row it follows again after a reload. */
export interface StoredAnchor {
  /** playlistItemId, when known (survives reorders). */
  item?: string;
  videoId: string | null;
  /** Which copy of the video, for repeated videos. */
  nth: number;
}

export interface StoredPhase {
  id: string;
  name: string;
  after: StoredAnchor | null;
}

const key = (playlistId: string) => `y3s:phases:${playlistId}`;
const storage = () => (typeof chrome !== "undefined" ? chrome.storage?.local : undefined);

export async function loadPhases(playlistId: string): Promise<StoredPhase[]> {
  try {
    const got = await storage()?.get(key(playlistId));
    const v = got?.[key(playlistId)] as { phases?: StoredPhase[] } | undefined;
    return Array.isArray(v?.phases) ? v!.phases : [];
  } catch {
    return [];
  }
}

export async function savePhases(playlistId: string, phases: StoredPhase[]): Promise<void> {
  try {
    if (phases.length) await storage()?.set({ [key(playlistId)]: { phases, savedAt: Date.now() } });
    else await storage()?.remove(key(playlistId));
  } catch {
    /* storage unavailable: phases just won't survive a reload */
  }
}
