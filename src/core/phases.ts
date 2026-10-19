// Phases are dividers in the playlist. A phase holds every video below its
// divider until the next divider; videos above the first divider are
// "unphased" and always stay first.
//
// Everything here works on a sequence of keys: row keys, plus phase markers
// written as PHASE + id. Pure functions; the page applies the result.

export const PHASE = "§";
export const isPhase = (k: string) => k.startsWith(PHASE);
export const marker = (id: string) => PHASE + id;
export const phaseId = (k: string) => k.slice(PHASE.length);

export interface Section {
  /** null for the unphased videos at the top. */
  phase: string | null;
  rows: string[];
}

export function sections(seq: string[]): Section[] {
  const out: Section[] = [{ phase: null, rows: [] }];
  for (const k of seq) {
    if (isPhase(k)) out.push({ phase: phaseId(k), rows: [] });
    else out[out.length - 1].rows.push(k);
  }
  return out;
}

export function join(secs: Section[]): string[] {
  const out: string[] = [];
  for (const s of secs) {
    if (s.phase !== null) out.push(marker(s.phase));
    out.push(...s.rows);
  }
  return out;
}

export const phaseIds = (seq: string[]) => seq.filter(isPhase).map(phaseId);
export const rowsOnly = (seq: string[]) => seq.filter((k) => !isPhase(k));

/** The phase a row is in (null = unphased). */
export function sectionOf(seq: string[], row: string): string | null {
  let cur: string | null = null;
  for (const k of seq) {
    if (isPhase(k)) cur = phaseId(k);
    else if (k === row) return cur;
  }
  return null;
}

function findSection(secs: Section[], phase: string | null): Section {
  const s = secs.find((x) => x.phase === phase);
  if (!s) throw new Error(`no phase ${phase}`);
  return s;
}

/**
 * Move rows (kept in their current relative order) to the very top, the very
 * bottom, or the end of a phase.
 */
export function moveRows(seq: string[], rows: Set<string>, where: "top" | "bottom" | { phase: string | null }): string[] {
  const picked = seq.filter((k) => rows.has(k));
  const rest = seq.filter((k) => !rows.has(k));
  if (where === "top") return [...picked, ...rest];
  if (where === "bottom") return [...rest, ...picked];
  const secs = sections(rest);
  findSection(secs, where.phase).rows.push(...picked);
  return join(secs);
}

/** Move a phase (with its videos) among the other phases. */
export function movePhase(seq: string[], id: string, to: "up" | "down" | "top" | "bottom"): string[] {
  const [lead, ...phases] = sections(seq);
  const i = phases.findIndex((s) => s.phase === id);
  if (i < 0) throw new Error(`no phase ${id}`);
  const [block] = phases.splice(i, 1);
  const j = to === "top" ? 0 : to === "bottom" ? phases.length : to === "up" ? Math.max(0, i - 1) : Math.min(phases.length, i + 1);
  phases.splice(j, 0, block);
  return join([lead, ...phases]);
}

/** Reorder the videos of one section with `order` (given and returning row keys). */
export function sortSection(seq: string[], phase: string | null, order: (rows: string[]) => string[]): string[] {
  const secs = sections(seq);
  const s = findSection(secs, phase);
  const next = order(s.rows);
  if (next.length !== s.rows.length || new Set(next).size !== s.rows.length || next.some((r) => !s.rows.includes(r))) {
    throw new Error("sortSection: order must be a permutation");
  }
  s.rows = next;
  return join(secs);
}

/** "Start phase here": a divider right before `row`. Nothing moves. */
export function startPhaseAt(seq: string[], id: string, row: string): string[] {
  const i = seq.indexOf(row);
  if (i < 0) throw new Error(`no row ${row}`);
  return [...seq.slice(0, i), marker(id), ...seq.slice(i)];
}

/**
 * A new phase holding exactly `rows`. If they already sit together at the end
 * of one section, only a divider is added. Otherwise they move into a new
 * phase placed right after the section the first of them was in.
 */
export function phaseFromRows(seq: string[], id: string, rows: Set<string>): string[] {
  const picked = seq.filter((k) => rows.has(k));
  if (!picked.length) throw new Error("phaseFromRows: no rows");
  const secs = sections(seq);
  const home = secs.find((s) => s.rows.includes(picked[0]))!;
  const tail = home.rows.slice(home.rows.length - picked.length);
  if (tail.length === picked.length && tail.every((k, i) => k === picked[i])) {
    return startPhaseAt(seq, id, picked[0]);
  }
  for (const s of secs) s.rows = s.rows.filter((k) => !rows.has(k));
  secs.splice(secs.indexOf(home) + 1, 0, { phase: id, rows: picked });
  return join(secs);
}

/** Drop a divider; its videos join the section above. */
export function removePhase(seq: string[], id: string): string[] {
  return seq.filter((k) => k !== marker(id));
}

/** Divide the whole list into phases of `size` (replaces existing dividers). */
export function splitEvery(seq: string[], size: number, newId: (n: number) => string): string[] {
  const rows = rowsOnly(seq);
  const out: string[] = [];
  rows.forEach((r, i) => {
    if (i % size === 0) out.push(marker(newId(i / size)));
    out.push(r);
  });
  return out;
}

export interface Anchor {
  id: string;
  /** The row the divider follows; null = top of the list. */
  after: string | null;
}

/** Where each divider sits, in order, for saving. */
export function anchorsOf(seq: string[]): Anchor[] {
  const out: Anchor[] = [];
  let last: string | null = null;
  for (const k of seq) {
    if (isPhase(k)) out.push({ id: phaseId(k), after: last });
    else last = k;
  }
  return out;
}

/**
 * Put saved dividers back between `rows`. Dividers whose row isn't on the
 * page (not loaded yet, or deleted) come back as `pending`.
 */
export function placeAnchors(rows: string[], anchors: Anchor[]): { seq: string[]; pending: Anchor[] } {
  const present = new Set(rows);
  const front: string[] = [];
  const after = new Map<string, string[]>();
  const pending: Anchor[] = [];
  for (const a of anchors) {
    if (a.after === null) front.push(marker(a.id));
    else if (present.has(a.after)) after.set(a.after, [...(after.get(a.after) ?? []), marker(a.id)]);
    else pending.push(a);
  }
  const seq = [...front];
  for (const r of rows) seq.push(r, ...(after.get(r) ?? []));
  return { seq, pending };
}

/** True when `rows` sit next to each other in one section (no divider between). */
export function isContiguous(seq: string[], rows: Set<string>): boolean {
  const idx = seq.map((k, i) => (rows.has(k) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return false;
  return idx[idx.length - 1] - idx[0] === idx.length - 1;
}

const RANGE = /^Videos \d+–\d+$/;
export const isRangeName = (name: string) => RANGE.test(name);
