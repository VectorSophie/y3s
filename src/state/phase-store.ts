// Phase (subsection) metadata, stored locally per playlistId in
// chrome.storage.local. Phases are an extension-only concept — YouTube
// playlists are flat and we never create real headers on YouTube.

import { PHASE_COLORS, storageKeys } from "../shared/constants";
import type { Phase } from "../shared/types";
import { uid } from "../shared/utils";
import { Emitter } from "./store";

export class PhaseStore extends Emitter<Phase[]> {
  private phases: Phase[] = [];
  private playlistId = "";

  list(): Phase[] {
    return this.phases;
  }

  /** Load phases for a playlist from storage. */
  async load(playlistId: string): Promise<void> {
    this.playlistId = playlistId;
    const key = storageKeys.phases(playlistId);
    const stored = await chrome.storage.local.get(key);
    this.phases = (stored[key] as Phase[] | undefined) ?? [];
    this.emit(this.phases);
  }

  private async persist(): Promise<void> {
    await chrome.storage.local.set({
      [storageKeys.phases(this.playlistId)]: this.phases,
    });
    this.emit(this.phases);
  }

  async create(title: string): Promise<Phase> {
    const now = Date.now();
    const phase: Phase = {
      id: uid("phase"),
      playlistId: this.playlistId,
      title: title.trim() || `Phase ${this.phases.length + 1}`,
      color: PHASE_COLORS[this.phases.length % PHASE_COLORS.length],
      trackVideoIds: [],
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    };
    this.phases = [...this.phases, phase];
    await this.persist();
    return phase;
  }

  async rename(id: string, title: string): Promise<void> {
    this.update(id, (p) => ({ ...p, title: title.trim() || p.title }));
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    this.phases = this.phases.filter((p) => p.id !== id);
    await this.persist();
  }

  async toggleCollapsed(id: string): Promise<void> {
    this.update(id, (p) => ({ ...p, collapsed: !p.collapsed }));
    await this.persist();
  }

  /** Assign a set of videoIds to a phase, removing them from any other phase. */
  async assign(phaseId: string, videoIds: string[]): Promise<void> {
    const ids = new Set(videoIds);
    this.phases = this.phases.map((p) => {
      if (p.id === phaseId) {
        const merged = new Set([...(p.trackVideoIds ?? []), ...ids]);
        return { ...p, trackVideoIds: [...merged], updatedAt: Date.now() };
      }
      // Ensure a track lives in only one phase.
      const remaining = (p.trackVideoIds ?? []).filter((v) => !ids.has(v));
      return remaining.length === (p.trackVideoIds ?? []).length
        ? p
        : { ...p, trackVideoIds: remaining, updatedAt: Date.now() };
    });
    await this.persist();
  }

  /** Remove videoIds from all phases (back to "Unphased"). */
  async unassign(videoIds: string[]): Promise<void> {
    const ids = new Set(videoIds);
    this.phases = this.phases.map((p) => ({
      ...p,
      trackVideoIds: (p.trackVideoIds ?? []).filter((v) => !ids.has(v)),
    }));
    await this.persist();
  }

  /** The phase a videoId belongs to, if any. */
  phaseOf(videoId: string): Phase | undefined {
    return this.phases.find((p) => p.trackVideoIds?.includes(videoId));
  }

  private update(id: string, fn: (p: Phase) => Phase): void {
    this.phases = this.phases.map((p) =>
      p.id === id ? { ...fn(p), updatedAt: Date.now() } : p,
    );
  }
}
