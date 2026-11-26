// Horizons: a task planned for a stretch of time instead of a day. For now
// one kind, This Week: "week:<the Monday of that week>". It is its own date
// setting: a planned date replaces it, and it replaces a planned date.
import { diffDays, startOfWeek, todayKey } from "./dates";
import type { Task } from "../shared/schema";

/** This week's horizon. */
export const thisWeek = (today = todayKey()) => `week:${startOfWeek(today)}`;

/** The Monday of a week horizon, or null. */
export function horizonWeek(h: string | null | undefined): string | null {
  return h && /^week:\d{4}-\d{2}-\d{2}$/.test(h) ? h.slice(5) : null;
}

/** Weeks from this week to the horizon's (negative: past). */
export function weeksAway(h: string | null | undefined, today = todayKey()): number | null {
  const w = horizonWeek(h);
  return w === null ? null : Math.round(diffDays(startOfWeek(today), w) / 7);
}

/** This week, Last week, 2 weeks ago (or Next week, In 2 weeks). */
export function horizonLabel(h: string | null | undefined, today = todayKey()): string {
  const n = weeksAway(h, today);
  if (n === null) return "";
  if (n === 0) return "This week";
  if (n === -1) return "Last week";
  if (n === 1) return "Next week";
  return n < 0 ? `${-n} weeks ago` : `In ${n} weeks`;
}

/** Past its week. */
export function horizonOverdue(h: string | null | undefined, today = todayKey()): boolean {
  const n = weeksAway(h, today);
  return n !== null && n < 0;
}

/** Planned for this week or a week already past (what This Week shows). */
export function dueThisWeek(t: Pick<Task, "horizon">, today = todayKey()): boolean {
  const n = weeksAway(t.horizon, today);
  return n !== null && n <= 0;
}

/**
 * A change with the planned date and the horizon kept apart: a horizon takes
 * the planned date (and its end) away, a planned date takes the horizon away.
 */
export function separateWhen<T extends Partial<Task>>(patch: T): T {
  if (patch.horizon) return { ...patch, start_date: null, start_time: null, end_date: null, end_time: null };
  if (patch.start_date) return { ...patch, horizon: null };
  return patch;
}
