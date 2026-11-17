// Pure view logic: which tasks a view shows, and how they are grouped and sorted.
import { addDays, todayKey } from "./dates";
import type { GroupBy, List, Section, SortBy, Task, ViewMode } from "../shared/schema";

export type SmartId = "all" | "today" | "next7" | "inbox" | "deadlines" | "completed";

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
  { id: "deadlines", name: "Deadlines" },
  { id: "inbox", name: "Inbox" },
  { id: "completed", name: "Completed" },
];

export const SMART_DEFAULTS: Record<SmartId, ViewPrefs> = {
  all: { view_mode: "list", group_by: "list", sort_by: "date" },
  today: { view_mode: "list", group_by: "date", sort_by: "priority" },
  next7: { view_mode: "list", group_by: "date", sort_by: "priority" },
  deadlines: { view_mode: "list", group_by: "deadline", sort_by: "deadline" },
  inbox: { view_mode: "list", group_by: "none", sort_by: "manual" },
  completed: { view_mode: "list", group_by: "none", sort_by: "date" },
};

export const PRIORITY_LABELS = ["None", "Low", "Medium", "High"];

export interface Data {
  lists: List[];
  sections: Section[];
  tasks: Task[];
  /** Lists hidden from All, from Today / Next 7 Days, and from the calendar. */
  hidden?: Hidden;
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
  if (view.kind === "calendar") return roots.filter((t) => (showCompleted || t.status === 0) && shownIn("calendar")(t));
  if (view.kind === "smart" && view.id === "completed") return roots.filter((t) => t.status !== 0);
  const open = roots.filter((t) => showCompleted || t.status === 0);
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

export function dateBucket(date: string | null, today: string): string {
  if (!date) return "none";
  if (date < today) return "overdue";
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  if (date <= addDays(today, 6)) return "week";
  return "later";
}

const DATE_BUCKETS: { key: string; label: string; date: (today: string) => string | null }[] = [
  { key: "overdue", label: "Overdue", date: (t) => t },
  { key: "today", label: "Today", date: (t) => t },
  { key: "tomorrow", label: "Tomorrow", date: (t) => addDays(t, 1) },
  { key: "week", label: "Next 7 Days", date: (t) => addDays(t, 2) },
  { key: "later", label: "Later", date: (t) => addDays(t, 7) },
  { key: "none", label: "No Date", date: () => null },
];

export function compareTasks(sort: SortBy): (a: Task, b: Task) => number {
  const nullsLast = (x: string | null, y: string | null) =>
    x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? -1 : 1;
  const byPos = (a: Task, b: Task) => a.position - b.position || a.created_at - b.created_at;
  return (a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    if (a.status !== b.status) return a.status - b.status;
    switch (sort) {
      case "date":
        return nullsLast(a.start_date, b.start_date) || nullsLast(a.start_time, b.start_time) || byPos(a, b);
      case "deadline":
        return nullsLast(a.deadline_date, b.deadline_date) || nullsLast(a.deadline_time, b.deadline_time) || byPos(a, b);
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
): Group[] {
  const cmp = compareTasks(prefs.sort_by);
  const make = (key: string, label: string, patch: Partial<Task>, pick: (t: Task) => boolean, tone?: "overdue"): Group => ({
    key,
    label,
    patch,
    tone,
    tasks: tasks.filter(pick).sort(cmp),
  });
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
      const groups = DATE_BUCKETS.map((b) =>
        make(
          b.key,
          b.key === "none" ? (groupBy === "date" ? "No Date" : "No Deadline") : b.label,
          b.key === "overdue" ? {} : ({ [field]: b.date(today) } as Partial<Task>),
          (t) => dateBucket(t[field], today) === b.key,
          b.key === "overdue" ? "overdue" : undefined,
        ),
      );
      return groups.filter((g) => g.tasks.length || g.key === "today" || g.key === "tomorrow" || g.key === "none");
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
  const pinned = tasks.filter((t) => t.pinned);
  const rest = tasks.filter((t) => !t.pinned);
  if (pinned.length) out.push({ key: "pinned", label: "Pinned", tasks: pinned, tone: "pinned" });
  if (sort === "date" || sort === "deadline") {
    const field = sort === "date" ? "start_date" : "deadline_date";
    for (const b of DATE_BUCKETS) {
      const inBucket = rest.filter((t) => dateBucket(t[field], today) === b.key);
      if (!inBucket.length) continue;
      const label = b.key === "none" ? (sort === "date" ? "No Date" : "No Deadline") : b.label;
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
    if (view.id === "deadlines") return { deadline_date: today };
  }
  return {};
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
  // Multi-day spans first and in a stable order, so their bars line up from
  // one day to the next; then all-day entries; then timed ones by time.
  const span = (e: DayEntry) =>
    e.kind === "planned" && e.task.end_date && e.task.start_date && e.task.end_date > e.task.start_date;
  return out.sort((a, b) => {
    const sa = span(a);
    const sb = span(b);
    if (sa !== sb) return sa ? -1 : 1;
    if (sa && sb) return a.task.start_date! < b.task.start_date! ? -1 : a.task.start_date! > b.task.start_date! ? 1 : a.task.id < b.task.id ? -1 : 1;
    const ta = a.kind === "planned" ? a.task.start_time : a.task.deadline_time;
    const tb = b.kind === "planned" ? b.task.start_time : b.task.deadline_time;
    if (ta === tb) return a.task.position - b.task.position;
    if (ta === null) return -1;
    if (tb === null) return 1;
    return ta < tb ? -1 : 1;
  });
}
