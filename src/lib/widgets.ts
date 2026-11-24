// The iOS home screen widgets (ios/widgets) show a snapshot the app writes
// into the shared app group whenever its data changes; the widgets only read
// it. Rows come in the app's own order (its view logic, prefs and custom
// orders), with plain dates the widget formats for the day it draws: it may
// draw after midnight before the app has run again. Taps come back as links
// (vitrotasks://…, see lib/links); ticked checkboxes come back as actions the
// app takes on when it comes forward.
import type { List, Section, Task } from "../shared/schema";
import { addDays, minutesOf, startOfWeek, todayKey } from "./dates";
import { parseRanks, orderKey } from "./order";
import {
  entriesForDay,
  groupTasks,
  hiddenLists,
  orderedLists,
  subtasksOf,
  tasksForView,
  withRepeats,
  type Data,
  type SmartId,
  type ViewPrefs,
  type ViewRef,
} from "./views";

export interface WidgetRow {
  id: string;
  title: string;
  /** Priority 0–3 (the checkbox colour). */
  p: number;
  /** The date shown on the right: planned, else the deadline. */
  date: string | null;
  time: string | null;
  /** First date that puts the task into Today / Next 7 Days (the widget filters by it after midnight). */
  first: string | null;
  /** A subtask, under `parent`. */
  sub?: 1;
  parent?: string;
}

export interface WidgetView {
  id: string;
  name: string;
  kind: "smart" | "list";
  color: string | null;
  depth: number;
  /** Open top-level tasks in the view on the snapshot's day. */
  count: number;
  /** Rows for later days are included: the widget keeps those up to the date it draws. */
  filter?: "today" | "next7";
  rows: WidgetRow[];
}

export interface WidgetEntry {
  /** Unique within the day. */
  id: string;
  /** The task to open (a repeat's projection opens the real task). */
  task: string;
  title: string;
  color: string | null;
  /** Minutes after midnight; null: all day. */
  start: number | null;
  end: number | null;
  deadline?: 1;
}

export interface WidgetSnapshot {
  v: 1;
  at: number;
  today: string;
  /** Calendar days included (Monday a week back to six weeks on). */
  from: string;
  to: string;
  views: WidgetView[];
  days: Record<string, WidgetEntry[]>;
}

const SMART: { id: SmartId; name: string }[] = [
  { id: "today", name: "Today" },
  { id: "next7", name: "Next 7 Days" },
  { id: "all", name: "All" },
  { id: "inbox", name: "Inbox" },
  { id: "deadlines", name: "Deadlines" },
];
/** More than the largest widget shows, with room for subtasks. */
const MAX_ROWS = 40;
const MAX_ENTRIES = 24;

interface Source {
  lists: List[];
  sections: Section[];
  tasks: Task[];
  settings: Record<string, string>;
}

function firstDate(t: Task): string | null {
  if (t.start_date && t.deadline_date) return t.start_date < t.deadline_date ? t.start_date : t.deadline_date;
  return t.start_date ?? t.deadline_date;
}

function rowOf(t: Task, parent?: string): WidgetRow {
  const planned = !!t.start_date;
  return {
    id: t.id,
    title: t.title,
    p: t.priority,
    date: planned ? t.start_date : t.deadline_date,
    time: planned ? t.start_time : t.deadline_time,
    first: firstDate(t),
    ...(parent ? { sub: 1 as const, parent } : {}),
  };
}

export function buildSnapshot(src: Source, prefsOf: (view: ViewRef) => ViewPrefs, today = todayKey(), now = Date.now()): WidgetSnapshot {
  const data: Data = { lists: src.lists, sections: src.sections, tasks: src.tasks, hidden: hiddenLists(src.settings) };
  const viewKey = (v: ViewRef) => (v.kind === "calendar" ? "calendar" : `${v.kind}:${v.id}`);

  const rowsFor = (view: ViewRef, filtered: boolean): { rows: WidgetRow[]; count: number } => {
    const prefs = prefsOf(view);
    const top = tasksForView(view, data, false, today);
    const ordered = groupTasks(top, prefs, view, data, today, parseRanks(src.settings[orderKey(viewKey(view), prefs.sort_by)])).flatMap((g) => g.tasks);
    // Today / Next 7 Days: the next day's newcomers come last, for a widget drawn after midnight.
    if (filtered) {
      const have = new Set(ordered.map((t) => t.id));
      const later = tasksForView(view, data, false, addDays(today, 1)).filter((t) => !have.has(t.id));
      ordered.push(...groupTasks(later, prefs, view, data, addDays(today, 1)).flatMap((g) => g.tasks));
    }
    const rows: WidgetRow[] = [];
    for (const t of ordered) {
      if (rows.length >= MAX_ROWS) break;
      rows.push(rowOf(t));
      for (const s of subtasksOf(src.tasks, t.id)) if (s.status === 0 && rows.length < MAX_ROWS) rows.push(rowOf(s, t.id));
    }
    return { rows, count: top.length };
  };

  const views: WidgetView[] = [
    ...SMART.map(({ id, name }) => {
      const filter = id === "today" || id === "next7" ? id : undefined;
      return { id, name, kind: "smart" as const, color: null, depth: 0, ...(filter ? { filter } : {}), ...rowsFor({ kind: "smart", id }, !!filter) };
    }),
    ...orderedLists(src.lists).map((l) => ({ id: l.id, name: l.name, kind: "list" as const, color: l.color || null, depth: l.depth, ...rowsFor({ kind: "list", id: l.id }, false) })),
  ];

  // Calendar: the week before this one to five weeks after it, for the week widget's arrows.
  const from = addDays(startOfWeek(today), -7);
  const to = addDays(startOfWeek(today), 7 * 6 - 1);
  const colorOf = new Map(src.lists.map((l) => [l.id, l.color || null]));
  const shown = withRepeats(tasksForView({ kind: "calendar" }, data, false, today), from, to);
  const days: Record<string, WidgetEntry[]> = {};
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const entries = entriesForDay(shown, d);
    if (!entries.length) continue;
    days[d] = entries.slice(0, MAX_ENTRIES).map(({ task: t, kind }) => {
      const deadline = kind === "deadline";
      const span = !!(t.start_date && t.end_date && t.end_date > t.start_date);
      const time = deadline ? t.deadline_time : span ? null : t.start_time;
      const start = time ? minutesOf(time) : null;
      const end =
        start === null ? null : Math.min(24 * 60, !deadline && t.end_time ? Math.max(minutesOf(t.end_time), start + 15) : start + (deadline ? 30 : 60));
      return {
        id: deadline ? `${t.id}:d` : t.id,
        task: t.ghostOf ?? t.id,
        title: t.title,
        color: t.list_id ? (colorOf.get(t.list_id) ?? null) : null,
        start,
        end,
        ...(deadline ? { deadline: 1 as const } : {}),
      };
    });
  }

  return { v: 1, at: now, today, from, to, views, days };
}
