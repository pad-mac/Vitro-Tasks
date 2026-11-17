// Reordering tasks by hand. With the "Custom" sort a drag rewrites task
// positions; with any other sort it records a custom order for that view and
// sort, which "Restore default order" removes again.
import type { SortBy, Task } from "../shared/schema";

/** Task id → rank inside its group, for one view and sort. */
export type Ranks = Record<string, number>;

export const orderKey = (viewKey: string, sort: SortBy) => `order:${viewKey}:${sort}`;

export function parseRanks(raw: string | undefined): Ranks {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Ranks) : {};
  } catch {
    return {};
  }
}

/** Pinned tasks stay first and completed ones last, whatever the order. */
const part = (t: Task) => `${t.pinned}:${t.status}`;

/**
 * Lays a custom order over an already sorted group. Tasks that have a rank
 * swap among the places ranked tasks take in the sorted list; tasks without
 * one (added since the last drag) keep their sorted place.
 */
export function applyRanks(sorted: Task[], ranks: Ranks): Task[] {
  const slots = new Map<string, number[]>();
  sorted.forEach((t, i) => {
    if (ranks[t.id] === undefined) return;
    const k = part(t);
    if (!slots.has(k)) slots.set(k, []);
    slots.get(k)!.push(i);
  });
  if (!slots.size) return sorted;
  const out = sorted.slice();
  for (const idx of slots.values()) {
    const ranked = idx.map((i) => sorted[i]).sort((a, b) => ranks[a.id] - ranks[b.id]);
    idx.forEach((i, j) => (out[i] = ranked[j]));
  }
  return out;
}

/** The group's ids after moving `id` to `index` (counted without the moved task). */
export function moveInOrder(ids: string[], id: string, index: number): string[] {
  const rest = ids.filter((x) => x !== id);
  const i = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, i), id, ...rest.slice(i)];
}

/** Ranks 1…n for a group in its new order; other groups' ranks stay. */
export function ranksFor(ids: string[], ranks: Ranks, keep?: Set<string>): Ranks {
  const next: Ranks = {};
  for (const [id, r] of Object.entries(ranks)) if (!keep || keep.has(id)) next[id] = r;
  ids.forEach((id, i) => (next[id] = i + 1));
  return next;
}

/**
 * New positions for the "Custom" sort. Usually only the moved task changes
 * (halfway between its neighbours); when its neighbours share a position the
 * moved task's part of the group is renumbered within its old range.
 */
export function positionsFor(order: Task[], movedId: string): { id: string; position: number }[] {
  const moved = order.find((t) => t.id === movedId);
  if (!moved) return [];
  const same = order.filter((t) => part(t) === part(moved));
  const i = same.indexOf(moved);
  const prev = same[i - 1];
  const next = same[i + 1];
  if (!prev && !next) return [];
  if (!prev) return [{ id: movedId, position: next.position - 1 }];
  if (!next) return [{ id: movedId, position: prev.position + 1 }];
  if (prev.position < next.position) return [{ id: movedId, position: (prev.position + next.position) / 2 }];
  const others = same.filter((t) => t !== moved);
  const lo = Math.min(...others.map((t) => t.position));
  const hi = Math.max(...others.map((t) => t.position));
  const step = hi > lo ? (hi - lo) / (same.length - 1) : 1;
  return same
    .map((t, k) => ({ id: t.id, position: lo + k * step, was: t.position }))
    .filter((p) => p.position !== p.was)
    .map(({ id, position }) => ({ id, position }));
}
