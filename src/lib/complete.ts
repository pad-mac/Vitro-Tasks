// What completing (or skipping) a task writes, shared by the app and the
// widgets' own sync (src/widget/core.ts): a repeating task moves on to its
// next date and leaves a done copy of this occurrence; any other task is
// done with its open subtasks.
import { addDays, diffDays, todayKey } from "./dates";
import { advance } from "./repeat";
import type { Task } from "../shared/schema";

export interface RepeatStep {
  task: Task;
  kids: Task[];
  copy: Task;
  kidCopies: Task[];
  next: Partial<Task>;
}

/**
 * The step a repeating task takes when it is done (1) or skipped (2): a copy
 * with this occurrence's dates and that status (its subtasks with it), and
 * the task's dates moved by the same number of days to the next occurrence.
 * Null when it does not repeat or its series is over (it is then done as usual).
 */
export function repeatStep(cur: Task, kids: Task[], status: 1 | 2, at: number, uid: () => string, today = todayKey()): RepeatStep | null {
  const base = cur.start_date ?? cur.deadline_date;
  if (!cur.repeat || !base || cur.parent_id) return null;
  const next = advance(cur.repeat, base, today);
  if (!next) return null;
  const delta = diffDays(base, next.date);
  const shift = (d: string | null) => (d ? addDays(d, delta) : null);
  const copy: Task = { ...cur, id: uid(), status, completed_at: at, repeat: null };
  const kidCopies = kids.map((k) => ({
    ...k,
    id: uid(),
    parent_id: copy.id,
    ...(k.status === 0 && status === 1 ? { status: 1, completed_at: at } : {}),
  }));
  return {
    task: cur,
    kids,
    copy,
    kidCopies,
    next: { start_date: shift(cur.start_date), end_date: shift(cur.end_date), deadline_date: shift(cur.deadline_date), repeat: next.repeat },
  };
}

/** Every row the step writes: the copies, the task at its next date, and its checklist open again. */
export function stepRows(step: RepeatStep): Task[] {
  const moved: Task = { ...step.task, ...step.next };
  const reopened = step.kids.filter((k) => k.status !== 0).map((k) => ({ ...k, status: 0, completed_at: null }));
  return [step.copy, ...step.kidCopies, moved, ...reopened];
}

/** The rows completing one open task writes (unstamped), given all tasks. */
export function completionRows(task: Task, tasks: Task[], at: number, uid: () => string, today = todayKey()): Task[] {
  if (task.status !== 0) return [];
  const kids = tasks.filter((t) => t.parent_id === task.id);
  const step = repeatStep(task, kids, 1, at, uid, today);
  if (step) return stepRows(step);
  return [task, ...kids.filter((k) => k.status === 0)].map((t) => ({ ...t, status: 1, completed_at: at }));
}
