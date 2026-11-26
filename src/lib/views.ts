// Pure view logic: which tasks a view shows, and how they are grouped and sorted.
import { addDays, diffDays, todayKey } from "./dates";
import { dueThisWeek, horizonOverdue, horizonWeek, thisWeek, weeksAway } from "./horizon";
import { occurrences, parseRule } from "./repeat";
import { applyRanks, type Ranks } from "./order";
import type { GroupBy, List, Section, SortBy, Task, ViewMode } from "../shared/schema";

export type SmartId = "all" | "today" | "next7" | "thisweek" | "inbox" | "deadlines" | "completed" | "trash";

export type ViewRef =
  | { kind: "smart"; id: SmartId }
  | { kind: "list"; id: string }
  | { kind: "calendar" };

export interface ViewPrefs {
  view_mode: ViewMode;
  group_by: GroupBy;
  sort_by: SortBy;
}

export const SMART_VIEWS: { id: SmartId; name: string }[] = [
  { id: "all", name: "All" },
  { id: "today", name: "Today" },
  { id: "next7", name: "Next 7 Days" },
  { id: "thisweek", name: "This Week" },
  { id: "deadlines", name: "Deadlines" },
  { id: "inbox", name: "Inbox" },
  { id: "completed", name: "Completed" },
  // Hidden by default (Settings → Sidebar shows it, or opens it from there).
  { id: "trash", name: "Trash" },
];

export const SMART_DEFAULTS: Record<SmartId, ViewPrefs> = {
  all: { view_mode: "list", group_by: "list", sort_by: "date" },
  today: { view_mode: "list", group_by: "date", sort_by: "priority" },
  next7: { view_mode: "list", group_by: "date", sort_by: "priority" },
  thisweek: { view_mode: "list", group_by: "date", sort_by: "priority" },
  deadlines: { view_mode: "list", group_by: "deadline", sort_by: "deadline" },
  inbox: { view_mode: "list", group_by: "none", sort_by: "manual" },
  completed: { view_mode: "list", group_by: "none", sort_by: "date" },
  trash: { view_mode: "list", group_by: "none", sort_by: "date" },
};

/** View mode, grouping and sorting for a view: stored on the list, or in settings for smart views. */
export function computePrefs(view: ViewRef, lists: List[], settings: Record<string, string>): ViewPrefs {
  if (view.kind === "list") {
    const l = lists.find((x) => x.id === view.id);
    if (l) return { view_mode: l.view_mode, group_by: l.group_by, sort_by: l.sort_by };
  }
  const id: SmartId = view.kind === "smart" ? view.id : "all";
  const base = SMART_DEFAULTS[id];
  try {
    const raw = settings[`view:${id}`];
    return raw ? { ...base, ...(JSON.parse(raw) as Partial<ViewPrefs>) } : base;
  } catch {
    return base;
  }
}


export const PRIORITY_LABELS = ["None", "Low", "Medium", "High"];

export interface Data {
  lists: List[];
  sections: Section[];
  tasks: Task[];
  /** Lists hidden from All, from Today / Next 7 Days, and from the calendar. */
  hidden?: Hidden;
  /** Just completed: still shown (struck through) for a moment. */
  lingering?: Record<string, true>;
}

export type VisibilityKey = "all" | "today" | "calendar";
export type Hidden = Record<VisibilityKey, Set<string>>;
export type ListVisibility = Record<VisibilityKey, boolean>;

export const SHOWN_EVERYWHERE: ListVisibility = { all: true, today: true, calendar: true };

/** Per-list visibility, stored as synced settings `listvis:<listId>`. */
export function listVisibility(settings: Record<string, string>, listId: string): ListVisibility {
  try {
    const raw = settings[`listvis:${listId}`];
    return raw ? { ...SHOWN_EVERYWHERE, ...(JSON.parse(raw) as Partial<ListVisibility>) } : SHOWN_EVERYWHERE;
  } catch {
    return SHOWN_EVERYWHERE;
  }
}

export function hiddenLists(settings: Record<string, string>): Hidden {
  const out: Hidden = { all: new Set(), today: new Set(), calendar: new Set() };
  for (const key of Object.keys(settings)) {
    if (!key.startsWith("listvis:")) continue;
    const id = key.slice(8);
    const v = listVisibility(settings, id);
    for (const k of ["all", "today", "calendar"] as VisibilityKey[]) if (!v[k]) out[k].add(id);
  }
  return out;
}

/** The list itself plus all of its sublists, depth first. */
export function listWithDescendants(lists: List[], id: string): string[] {
  const out = [id];
  for (const child of lists.filter((l) => l.parent_id === id)) out.push(...listWithDescendants(lists, child.id));
  return out;
}

export function childLists(lists: List[], parentId: string | null): List[] {
  return lists.filter((l) => (l.parent_id ?? null) === parentId).sort((a, b) => a.position - b.position);
}

/** The earliest date that matters for a task: its planned date or its deadline. */
function firstDate(t: Task): string | null {
  if (t.start_date && t.deadline_date) return t.start_date < t.deadline_date ? t.start_date : t.deadline_date;
  return t.start_date ?? t.deadline_date;
}

/** Top-level tasks belonging to a view (subtasks hang under their parent). */
export function tasksForView(view: ViewRef, data: Data, showCompleted: boolean, today = todayKey()): Task[] {
  const roots = data.tasks.filter((t) => !t.parent_id);
  const shownIn = (key: VisibilityKey) => (t: Task) => !t.list_id || !data.hidden?.[key].has(t.list_id);
  const shown = (t: Task) => showCompleted || t.status === 0 || !!data.lingering?.[t.id];
  if (view.kind === "calendar") return roots.filter((t) => shown(t) && shownIn("calendar")(t));
  if (view.kind === "smart" && view.id === "completed") return roots.filter((t) => t.status !== 0);
  // Deleted tasks are not loaded with the rest: the trash reads them itself (see the store).
  if (view.kind === "smart" && view.id === "trash") return [];
  const open = roots.filter(shown);
  if (view.kind === "list") {
    const ids = new Set(listWithDescendants(data.lists, view.id));
    return open.filter((t) => t.list_id !== null && ids.has(t.list_id));
  }
  switch (view.id) {
    case "all":
      return open.filter(shownIn("all"));
    case "inbox":
      return open.filter((t) => t.list_id === null);
    case "today":
      return open.filter((t) => {
        const d = firstDate(t);
        return d !== null && d <= today && shownIn("today")(t);
      });
    case "next7": {
      const end = addDays(today, 6);
      return open.filter((t) => {
        const d = firstDate(t);
        return d !== null && d <= end && shownIn("today")(t);
      });
    }
    case "thisweek":
      // Planned for this week, or for a week gone by (shown as overdue).
      return open.filter((t) => dueThisWeek(t, today) && shownIn("today")(t));
    case "deadlines":
      return open.filter((t) => t.deadline_date !== null);
    default:
      return open;
  }
}

export interface Group {
  key: string;
  label: string;
  tasks: Task[];
  /** Fields a task receives when it is dropped into this group (kanban) or added here. */
  patch: Partial<Task>;
  tone?: "overdue";
}

/** A task's bucket by its planned date, or by its horizon when it has none. */
export function planBucket(t: Pick<Task, "start_date" | "horizon">, today: string): string {
  if (!t.start_date && horizonWeek(t.horizon)) return horizonOverdue(t.horizon, today) ? "overdue" : (weeksAway(t.horizon, today) ?? 0) > 0 ? "later" : "thisweek";
  return dateBucket(t.start_date, today);
}

export function dateBucket(date: string | null, today: string): string {
  if (!date) return "none";
  if (date < today) return "overdue";
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  if (date <= addDays(today, 6)) return "week";
  return "later";
}

const DATE_BUCKETS: { key: string; label: string; date: (today: string) => string | null; planned?: boolean }[] = [
  { key: "overdue", label: "Overdue", date: (t) => t },
  { key: "today", label: "Today", date: (t) => t },
  { key: "tomorrow", label: "Tomorrow", date: (t) => addDays(t, 1) },
  // Only by planned date: tasks with This Week as their horizon.
  { key: "thisweek", label: "This Week", date: () => null, planned: true },
  { key: "week", label: "Next 7 Days", date: (t) => addDays(t, 2) },
  { key: "later", label: "Later", date: (t) => addDays(t, 7) },
  { key: "none", label: "No Date", date: () => null },
];

/**
 * A task's first date: its planned date or its deadline, whichever comes first
 * (with its time; a day without a time after the timed ones that day).
 */
export function firstWhen(t: Task): string | null {
  const a = t.start_date ? `${t.start_date}T${t.start_time ?? "~"}` : null;
  const b = t.deadline_date ? `${t.deadline_date}T${t.deadline_time ?? "~"}` : null;
  return a && b ? (a < b ? a : b) : (a ?? b);
}

export function compareTasks(sort: SortBy): (a: Task, b: Task) => number {
  const nullsLast = (x: string | null, y: string | null) =>
    x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? -1 : 1;
  const byPos = (a: Task, b: Task) => a.position - b.position || a.created_at - b.created_at;
  return (a, b) => {
    // Completed tasks always come last, newest completion first, whatever the sort (pinned or not).
    const ad = a.status !== 0, bd = b.status !== 0;
    if (ad !== bd) return ad ? 1 : -1;
    if (ad) return (b.completed_at ?? 0) - (a.completed_at ?? 0) || byPos(a, b);
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    switch (sort) {
      case "date":
        return nullsLast(a.start_date, b.start_date) || nullsLast(a.start_time, b.start_time) || byPos(a, b);
      case "deadline":
        return nullsLast(a.deadline_date, b.deadline_date) || nullsLast(a.deadline_time, b.deadline_time) || byPos(a, b);
      case "datedeadline":
        return nullsLast(firstWhen(a), firstWhen(b)) || byPos(a, b);
      case "priority":
        return b.priority - a.priority || nullsLast(a.start_date, b.start_date) || byPos(a, b);
      case "title":
        return a.title.localeCompare(b.title) || byPos(a, b);
      case "created":
        return b.created_at - a.created_at;
      default:
        return byPos(a, b);
    }
  };
}

/**
 * Groups a view's tasks. Structural groupings (section, priority, list) keep
 * empty groups so kanban columns stay put; date groupings drop empty buckets
 * except the ones you would want to drop a card into.
 */
export function groupTasks(
  tasks: Task[],
  prefs: Pick<ViewPrefs, "group_by" | "sort_by">,
  view: ViewRef,
  data: Data,
  today = todayKey(),
  /** A custom order dragged into place (not used with the "Custom" sort, which uses positions). */
  ranks?: Ranks,
): Group[] {
  const cmp = compareTasks(prefs.sort_by);
  const custom = ranks && prefs.sort_by !== "manual" ? ranks : null;
  const make = (key: string, label: string, patch: Partial<Task>, pick: (t: Task) => boolean, tone?: "overdue"): Group => {
    const sorted = tasks.filter(pick).sort(cmp);
    return { key, label, patch, tone, tasks: custom ? applyRanks(sorted, custom) : sorted };
  };
  let groupBy = prefs.group_by;
  // Sections only exist inside one concrete list.
  if (groupBy === "section" && view.kind !== "list") groupBy = "none";

  switch (groupBy) {
    case "section": {
      const listId = (view as { id: string }).id;
      const sections = data.sections.filter((s) => s.list_id === listId).sort((a, b) => a.position - b.position);
      const known = new Set(sections.map((s) => s.id));
      const groups = [
        make("nosection", "No Section", { section_id: null, list_id: listId }, (t) => !t.section_id || !known.has(t.section_id)),
        ...sections.map((s) => make(s.id, s.name, { section_id: s.id, list_id: listId }, (t) => t.section_id === s.id)),
      ];
      // Hide the catch-all column when sections exist and nothing is in it.
      return sections.length && !groups[0].tasks.length ? groups.slice(1) : groups;
    }
    case "priority":
      return [3, 2, 1, 0].map((p) => make(`p${p}`, PRIORITY_LABELS[p], { priority: p }, (t) => t.priority === p));
    case "list": {
      const groups = [
        make("inbox", "Inbox", { list_id: null, section_id: null }, (t) => t.list_id === null),
        ...orderedLists(data.lists).map((l) =>
          make(l.id, l.name, { list_id: l.id, section_id: null }, (t) => t.list_id === l.id),
        ),
      ];
      return groups.filter((g) => g.tasks.length);
    }
    case "date":
    case "deadline": {
      const field = groupBy === "date" ? "start_date" : "deadline_date";
      const bucket = (t: Task) => (groupBy === "date" ? planBucket(t, today) : dateBucket(t.deadline_date, today));
      const groups = DATE_BUCKETS.filter((b) => !b.planned || groupBy === "date").map((b) =>
        make(
          b.key,
          b.key === "none" ? (groupBy === "date" ? "No Date" : "No Deadline") : b.label,
          b.key === "overdue" ? {} : b.key === "thisweek" ? { horizon: thisWeek(today) } : groupBy === "date" ? { start_date: b.date(today), horizon: null } : ({ [field]: b.date(today) } as Partial<Task>),
          (t) => bucket(t) === b.key,
          b.key === "overdue" ? "overdue" : undefined,
        ),
      );
      // Empty groups stay only where a task could land in this view (as drop targets):
      // Today can only hold today's tasks, Next 7 Days nothing undated.
      const keepEmpty =
        view.kind === "smart" && view.id === "today"
          ? ["today"]
          : view.kind === "smart" && view.id === "thisweek"
            ? ["thisweek"]
          : view.kind === "smart" && view.id === "next7"
            ? ["today", "tomorrow"]
            : ["today", "tomorrow", "none"];
      return groups.filter((g) => g.tasks.length || keepEmpty.includes(g.key));
    }
    default:
      return [make("all", "", view.kind === "list" ? { list_id: view.id } : {}, () => true)];
  }
}

export interface Subgroup {
  key: string;
  label: string;
  tasks: Task[];
  tone?: "overdue" | "pinned";
}

/**
 * Splits one board lane into sub-groups that follow the sort order, the way
 * TickTick does: sorted by date gives Overdue / Today / ... / No Date, sorted
 * by priority gives High / Medium / Low / None. Pinned tasks always come first.
 */
export function subgroupTasks(tasks: Task[], sort: SortBy, today = todayKey()): Subgroup[] {
  const out: Subgroup[] = [];
  const pinned = tasks.filter((t) => t.pinned && t.status === 0);
  const rest = tasks.filter((t) => !t.pinned || t.status !== 0);
  if (pinned.length) out.push({ key: "pinned", label: "Pinned", tasks: pinned, tone: "pinned" });
  if (sort === "date" || sort === "deadline" || sort === "datedeadline") {
    const day = (t: Task) => (sort === "date" ? t.start_date : sort === "deadline" ? t.deadline_date : (firstWhen(t)?.slice(0, 10) ?? null));
    const bucket = (t: Task) => (sort === "deadline" ? dateBucket(day(t), today) : !day(t) ? planBucket(t, today) : dateBucket(day(t), today));
    for (const b of DATE_BUCKETS) {
      const inBucket = rest.filter((t) => bucket(t) === b.key);
      if (!inBucket.length) continue;
      const label = b.key === "none" ? (sort === "deadline" ? "No Deadline" : "No Date") : b.label;
      out.push({ key: b.key, label, tasks: inBucket, tone: b.key === "overdue" ? "overdue" : undefined });
    }
  } else if (sort === "priority") {
    for (const p of [3, 2, 1, 0]) {
      const inPrio = rest.filter((t) => t.priority === p);
      if (inPrio.length) out.push({ key: `p${p}`, label: PRIORITY_LABELS[p], tasks: inPrio });
    }
  } else if (rest.length) {
    out.push({ key: "all", label: out.length ? "Others" : "", tasks: rest });
  }
  return out;
}

/** Lists flattened in sidebar order (parents before their sublists). */
export function orderedLists(lists: List[], parentId: string | null = null, depth = 0): (List & { depth: number })[] {
  const out: (List & { depth: number })[] = [];
  for (const l of childLists(lists, parentId)) {
    out.push({ ...l, depth });
    out.push(...orderedLists(lists, l.id, depth + 1));
  }
  return out;
}

export function subtasksOf(tasks: Task[], parentId: string): Task[] {
  return tasks.filter((t) => t.parent_id === parentId).sort((a, b) => a.position - b.position || a.created_at - b.created_at);
}

/** Open-task counters for the sidebar. */
export function countOpen(view: ViewRef, data: Data, today = todayKey()): number {
  return tasksForView(view, data, false, today).length;
}

/** Default fields for a task created inside a view. */
export function defaultsForView(view: ViewRef, today = todayKey()): Partial<Task> {
  if (view.kind === "list") return { list_id: view.id };
  if (view.kind === "smart") {
    if (view.id === "today") return { start_date: today };
    if (view.id === "next7") return { start_date: today };
    if (view.id === "thisweek") return { horizon: thisWeek(today) };
    if (view.id === "deadlines") return { deadline_date: today };
  }
  return {};
}

/**
 * The calendar's tasks plus the later occurrences of open repeating tasks
 * from `from` to `to`, as entries with ids "<id>~<date>" and `ghostOf` set to
 * the real task. Only the calendar shows these; every other view shows a
 * repeating task once, on its current date.
 */
export function withRepeats(tasks: Task[], from: string, to: string): Task[] {
  let out: Task[] | null = null;
  for (const t of tasks) {
    if (!t.repeat || t.status !== 0 || t.parent_id || t.ghostOf) continue;
    const base = t.start_date ?? t.deadline_date;
    const rule = base ? parseRule(t.repeat) : null;
    if (!rule || !base) continue;
    // A span that starts before `from` can still reach into it.
    const span = t.start_date && t.end_date && t.end_date > t.start_date ? diffDays(t.start_date, t.end_date) : 0;
    for (const d of occurrences(rule, base, span ? addDays(from, -span) : from, to, 62)) {
      if (d === base) continue;
      const delta = diffDays(base, d);
      const shift = (x: string | null) => (x ? addDays(x, delta) : null);
      (out ??= tasks.slice()).push({
        ...t,
        id: `${t.id}~${d}`,
        ghostOf: t.id,
        start_date: shift(t.start_date),
        end_date: shift(t.end_date),
        deadline_date: shift(t.deadline_date),
      });
    }
  }
  return out ?? tasks;
}

/** Tasks that fall on a calendar day, as planned work or as a deadline. */
export interface DayEntry {
  task: Task;
  kind: "planned" | "deadline";
}

export function entriesForDay(tasks: Task[], day: string): DayEntry[] {
  const out: DayEntry[] = [];
  for (const t of tasks) {
    if (t.start_date) {
      const end = t.end_date && t.end_date >= t.start_date ? t.end_date : t.start_date;
      if (day >= t.start_date && day <= end) out.push({ task: t, kind: "planned" });
    }
    if (t.deadline_date === day) out.push({ task: t, kind: "deadline" });
  }
  // Multi-day spans first and in a stable order, so their bars line up from one day to the next;
  // then deadlines; then entries without a time; then timed ones by time. Ties by the tasks' position.
  // (Each rank is a number: a check that answered null for one task and false for another made the
  // sort inconsistent, and the day came out in storage order.)
  const rank = (e: DayEntry) => (e.kind === "deadline" ? 1 : e.task.end_date && e.task.start_date && e.task.end_date > e.task.start_date ? 0 : e.task.start_time ? 3 : 2);
  const timeOf = (e: DayEntry) => (e.kind === "planned" ? e.task.start_time : e.task.deadline_time) ?? "";
  return out.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return a.task.start_date! < b.task.start_date! ? -1 : a.task.start_date! > b.task.start_date! ? 1 : a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0;
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.task.position - b.task.position;
  });
}
