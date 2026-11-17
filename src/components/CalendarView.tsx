import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent } from "react";
import {
  MONTHS_LONG,
  WEEKDAYS,
  addDays,
  addMonths,
  diffDays,
  fromKey,
  isWeekend,
  minutesOf,
  pad,
  startOfMonth,
  startOfWeek,
  todayKey,
} from "../lib/dates";
import { plainText } from "../lib/rich";
import { entriesForDay, hiddenLists, tasksForView, type DayEntry } from "../lib/views";
import type { Task } from "../shared/schema";
import { anchorOf, useStore, type Anchor } from "../store";
import { dragProps, useDropTarget, useTaskMenu } from "./tasks";
import { useSwipe } from "./Mobile";
import { TaskRow } from "./tasks";
import { isMobile } from "../lib/platform";
import { FloatingPanel, Icon, MenuItem, Popover } from "./ui";

const HOUR_H = 48;
const SNAP = 15;
const CHIP_H = 22;

const isSpan = (t: Task) => !!t.start_date && !!t.end_date && t.end_date > t.start_date;
const timeOf = (e: DayEntry) => (e.kind === "planned" ? e.task.start_time : e.task.deadline_time);
const toTime = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const clampMin = (m: number) => Math.max(0, Math.min(24 * 60, m));

function useMoveEntry() {
  const tasks = useStore((s) => s.tasks);
  const updateTask = useStore((s) => s.updateTask);
  /**
   * Moves the planned span or the deadline to another day.
   * minutes: undefined keeps the time, null makes it all-day, a number sets the start time.
   */
  return (taskId: string, kind: string, day: string, minutes?: number | null) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (kind === "deadline") {
      return void updateTask(taskId, {
        deadline_date: day,
        ...(minutes === undefined ? {} : { deadline_time: minutes === null ? null : toTime(minutes) }),
      });
    }
    const shift = t.start_date ? diffDays(t.start_date, day) : 0;
    const patch: Partial<Task> = { start_date: day, end_date: t.end_date && t.start_date ? addDays(t.end_date, shift) : null };
    if (minutes === null) {
      patch.start_time = null;
      patch.end_time = null;
    } else if (minutes !== undefined) {
      // Keep the duration when a timed entry is dropped at another time.
      const len = t.start_time && t.end_time ? Math.max(SNAP, minutesOf(t.end_time) - minutesOf(t.start_time)) : null;
      patch.start_time = toTime(Math.min(minutes, 24 * 60 - SNAP));
      patch.end_time = len ? toTime(Math.min(24 * 60 - 1, minutes + len)) : null;
    }
    void updateTask(taskId, patch);
  };
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function useElementHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  return [ref, h] as const;
}

/** Wheel and trackpad scrolling that moves a view in whole steps. */
function useStepWheel(step: (dir: number) => void, threshold: number) {
  const acc = useRef(0);
  const last = useRef(0);
  return (delta: number) => {
    const now = performance.now();
    if (now - last.current > 400) acc.current = 0;
    last.current = now;
    acc.current += delta;
    while (Math.abs(acc.current) >= threshold) {
      const dir = Math.sign(acc.current);
      acc.current -= dir * threshold;
      step(dir);
    }
  };
}

// ---------- Entries ----------

/**
 * Dragging the start or end edge of an all-day entry changes its range day by
 * day; the calendar shows the new range while dragging and saves on release.
 */
function useEdgeResize(task: Task) {
  const preview = useStore((s) => s.previewTask);
  const updateTask = useStore((s) => s.updateTask);
  return (edge: "start" | "end") => (e: RPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || e.pointerType === "touch" || !task.start_date) return;
    e.preventDefault();
    e.stopPropagation();
    const first = task.start_date;
    const last = task.end_date ?? task.start_date;
    let cur = { start: first, end: last };
    const html = document.documentElement;
    const onMove = (ev: PointerEvent) => {
      const day = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-day]")?.dataset.day;
      if (!day) return;
      const next = edge === "end" ? { start: first, end: day < first ? first : day } : { start: day > last ? last : day, end: last };
      if (next.start === cur.start && next.end === cur.end) return;
      cur = next;
      preview(task.id, { start_date: next.start, end_date: next.end > next.start ? next.end : null });
    };
    const finish = (save: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey, true);
      html.classList.remove("is-resizing-days");
      const patch = save
        ? { start_date: cur.start, end_date: cur.end > cur.start ? cur.end : null }
        : { start_date: task.start_date, end_date: task.end_date };
      if (save && patch.start_date === task.start_date && patch.end_date === task.end_date) return;
      if (save) void updateTask(task.id, patch);
      else preview(task.id, patch);
    };
    const onUp = () => finish(true);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey, true);
    html.classList.add("is-resizing-days");
  };
}

/** The draggable start and end edges of an all-day entry. */
function EdgeHandles({ task, start = true, end = true }: { task: Task; start?: boolean; end?: boolean }) {
  const resize = useEdgeResize(task);
  return (
    <>
      {start && <span className="edge-handle is-start" data-nodrag title="Drag to change the first day" onPointerDown={resize("start")} />}
      {end && <span className="edge-handle is-end" data-nodrag title="Drag to change the last day" onPointerDown={resize("end")} />}
    </>
  );
}

function Chip({ entry, timed }: { entry: DayEntry; timed?: boolean }) {
  const lists = useStore((s) => s.lists);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const { task, kind } = entry;
  const onMenu = useTaskMenu(task.id);
  const color = lists.find((l) => l.id === task.list_id)?.color ?? "var(--faint)";
  const time = timeOf(entry);
  return (
    <div
      className={`cal-chip ${kind === "deadline" ? "is-deadline" : time && !timed ? "is-timed" : ""} ${task.status ? "is-done" : ""} ${selectedId === task.id ? "is-selected" : ""}`}
      style={{ ["--c" as string]: color }}
      title={`${kind === "deadline" ? "Deadline: " : ""}${plainText(task.title)}`}
      onClick={(e) => {
        e.stopPropagation();
        select(task.id, anchorOf(e.currentTarget));
      }}
      onContextMenu={onMenu}
      {...dragProps(task.id, kind)}
    >
      {kind === "deadline" && <Icon name="deadline" size={11} />}
      <span className="cal-chip-title">{plainText(task.title) || "Untitled"}</span>
      {time && !timed && <span className="cal-chip-time">{time}</span>}
      {kind === "planned" && !time && !timed && <EdgeHandles task={task} />}
    </div>
  );
}

function SpanBar({ task, c0, c1, lane, top, from, to, n }: { task: Task; c0: number; c1: number; lane: number; top: number; from: string; to: string; n: number }) {
  const lists = useStore((s) => s.lists);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const onMenu = useTaskMenu(task.id);
  const color = lists.find((l) => l.id === task.list_id)?.color ?? "var(--faint)";
  const left = task.start_date! < from;
  const right = task.end_date! > to;
  return (
    <div
      className={`cal-chip cal-span ${left ? "cont-left" : ""} ${right ? "cont-right" : ""} ${task.status ? "is-done" : ""} ${selectedId === task.id ? "is-selected" : ""}`}
      style={{
        ["--c" as string]: color,
        left: `calc(${(c0 / n) * 100}% + ${left ? 0 : 4}px)`,
        width: `calc(${((c1 - c0 + 1) / n) * 100}% - ${(left ? 0 : 4) + (right ? 0 : 4)}px)`,
        top: top + lane * CHIP_H,
      }}
      title={plainText(task.title)}
      onClick={(e) => {
        e.stopPropagation();
        select(task.id, anchorOf(e.currentTarget));
      }}
      onContextMenu={onMenu}
      {...dragProps(task.id, "planned")}
    >
      <span className="cal-chip-title">{plainText(task.title) || "Untitled"}</span>
      <EdgeHandles task={task} start={!left} end={!right} />
    </div>
  );
}

// ---------- A row of seven days (month rows and the week's all-day strip) ----------

function DayCell({
  day,
  entries,
  lanes,
  hiddenSpans = 0,
  capacity,
  month,
  outside,
  selected,
  onExpand,
}: {
  day: string;
  entries: DayEntry[];
  lanes: number;
  hiddenSpans?: number;
  capacity: number;
  month: boolean;
  outside: boolean;
  selected: boolean;
  onExpand: (day: string, anchor: Anchor) => void;
}) {
  const today = todayKey();
  const moveEntry = useMoveEntry();
  const drop = useDropTarget((id, kind) => moveEntry(id, kind, day, month ? undefined : null));
  const room = Math.max(0, capacity - lanes);
  const shown = entries.length + hiddenSpans > room ? entries.slice(0, Math.max(0, room - 1)) : entries;
  const hidden = entries.length - shown.length + hiddenSpans;
  return (
    <div
      data-day={day}
      className={`cal-cell ${outside ? "is-out" : ""} ${isWeekend(day) ? "is-weekend" : ""} ${drop.over ? "is-drop" : ""} ${selected ? "is-sel" : ""}`}
      style={{ paddingTop: (month ? 30 : 4) + lanes * CHIP_H }}
      {...drop.props}
    >
      {month && (
        <span className={`cal-daynum ${day === today ? "is-today" : ""}`}>
          {+day.slice(8) === 1 && !isMobile ? `${MONTHS_LONG[+day.slice(5, 7) - 1].slice(0, 3)} 1` : +day.slice(8)}
        </span>
      )}
      {shown.map((e) => (
        <Chip key={`${e.task.id}:${e.kind}`} entry={e} />
      ))}
      {hidden > 0 && (
        <button type="button" className="cal-more" onClick={(e) => onExpand(day, anchorOf(e.currentTarget))}>
          +{hidden}
        </button>
      )}
    </div>
  );
}

function WeekRow({
  start,
  tasks,
  month,
  titleMonth,
  capacity,
  range,
  onExpand,
  n = 7,
}: {
  start: string;
  tasks: Task[];
  month: boolean;
  titleMonth?: string;
  capacity: number;
  range: [string, string] | null;
  onExpand: (day: string, anchor: Anchor) => void;
  /** Number of day columns (narrow windows show fewer days in the week view). */
  n?: number;
}) {
  const days = useMemo(() => Array.from({ length: n }, (_, i) => addDays(start, i)), [start, n]);
  const end = days[n - 1];
  const { spans, lanesAt } = useMemo(() => {
    const list = tasks
      .filter((t) => isSpan(t) && t.start_date! <= end && t.end_date! >= start)
      .sort((a, b) => (a.start_date! < b.start_date! ? -1 : a.start_date! > b.start_date! ? 1 : a.end_date! > b.end_date! ? -1 : a.id < b.id ? -1 : 1));
    const laneEnds: number[] = [];
    const lanesAt = Array.from({ length: n }, () => 0);
    const spans = list.map((task) => {
      const c0 = Math.max(0, diffDays(start, task.start_date!));
      const c1 = Math.min(n - 1, diffDays(start, task.end_date!));
      let lane = laneEnds.findIndex((e) => e < c0);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = c1;
      for (let c = c0; c <= c1; c++) lanesAt[c] = Math.max(lanesAt[c], lane + 1);
      return { task, c0, c1, lane };
    });
    return { spans, lanesAt };
  }, [tasks, start, end, n]);
  const entriesByDay = useMemo(
    () => days.map((d) => entriesForDay(tasks, d).filter((e) => !(e.kind === "planned" && isSpan(e.task)) && (month || !timeOf(e)))),
    [tasks, days, month],
  );
  // Rows that do not fit: bars in the last row stay only where nothing on their
  // days overflows; the rest of the overflow is counted in the "+N" row.
  const { visible, shownLanes, hiddenSpans } = useMemo(() => {
    const fits = (c: number) => lanesAt[c] + entriesByDay[c].length <= capacity;
    const visible = spans.filter((s) => s.lane < capacity - 1 || (s.lane === capacity - 1 && Array.from({ length: s.c1 - s.c0 + 1 }, (_, k) => s.c0 + k).every(fits)));
    const shownLanes = Array.from({ length: n }, () => 0);
    const hiddenSpans = Array.from({ length: n }, () => 0);
    for (const s of spans) {
      const on = visible.includes(s);
      for (let c = s.c0; c <= s.c1; c++) {
        if (on) shownLanes[c] = Math.max(shownLanes[c], s.lane + 1);
        else hiddenSpans[c]++;
      }
    }
    return { visible, shownLanes, hiddenSpans };
  }, [spans, lanesAt, entriesByDay, capacity, n]);
  return (
    <div className={`cal-week ${month ? "" : "is-allday"}`} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      {days.map((d, i) => (
        <DayCell
          key={d}
          day={d}
          entries={entriesByDay[i]}
          lanes={shownLanes[i]}
          hiddenSpans={hiddenSpans[i]}
          capacity={capacity}
          month={month}
          outside={!!titleMonth && d.slice(0, 7) !== titleMonth}
          selected={!!range && d >= range[0] && d <= range[1]}
          onExpand={onExpand}
        />
      ))}
      {visible.map((s) => (
        <SpanBar key={s.task.id} {...s} top={month ? 30 : 4} from={start} to={end} n={n} />
      ))}
    </div>
  );
}

/** Press on an empty day and drag across days; the range opens the new-task card. */
function useDayRange() {
  const openComposer = useStore((s) => s.openComposer);
  const composer = useStore((s) => s.composer);
  const [sel, setSel] = useState<{ a: string; b: string } | null>(null);
  // On a touch screen a tap on a day adds a task there; dragging is left to swipes.
  const tap = useRef<{ x: number; y: number; day: string } | null>(null);
  const cellAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day]") ?? null;
  const handlers = {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest(".cal-chip, button, input, .floating")) return;
      const cell = cellAt(e.clientX, e.clientY);
      if (!cell?.dataset.day) return;
      if (e.pointerType === "touch") {
        tap.current = { x: e.clientX, y: e.clientY, day: cell.dataset.day };
        return;
      }
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointers cannot be captured */
      }
      setSel({ a: cell.dataset.day, b: cell.dataset.day });
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      if (!sel) return;
      const day = cellAt(e.clientX, e.clientY)?.dataset.day;
      if (day && day !== sel.b) setSel({ ...sel, b: day });
    },
    onPointerUp: (e: RPointerEvent<HTMLElement>) => {
      const t = tap.current;
      tap.current = null;
      if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10) {
        const cell = e.currentTarget.querySelector(`[data-day="${t.day}"]`) ?? e.currentTarget;
        openComposer({ start_date: t.day }, anchorOf(cell));
        return;
      }
      if (!sel) return;
      const [from, to] = sel.a <= sel.b ? [sel.a, sel.b] : [sel.b, sel.a];
      const cell = e.currentTarget.querySelector(`[data-day="${to}"]`) ?? e.currentTarget;
      setSel(null);
      openComposer({ start_date: from, end_date: to > from ? to : null }, anchorOf(cell));
    },
    onPointerCancel: () => {
      tap.current = null;
      setSel(null);
    },
  };
  // While dragging, or while the new-task card for an all-day range is open, show the range.
  const pending = composer && composer.base.start_date && !composer.base.start_time ? composer.base : null;
  const range: [string, string] | null = sel
    ? sel.a <= sel.b
      ? [sel.a, sel.b]
      : [sel.b, sel.a]
    : pending
      ? [pending.start_date!, pending.end_date ?? pending.start_date!]
      : null;
  return { range, handlers };
}

// ---------- Week: hour grid ----------

interface Placed {
  entry: DayEntry;
  start: number;
  end: number;
  col: number;
  cols: number;
}

/** Side-by-side columns for entries that overlap in time. */
export function placeTimed(entries: DayEntry[]): Placed[] {
  const items: Placed[] = entries
    .map((entry) => {
      const start = minutesOf(timeOf(entry)!);
      const t = entry.task;
      const end = entry.kind === "planned" && t.end_time ? Math.max(minutesOf(t.end_time), start + SNAP) : start + (entry.kind === "deadline" ? 30 : 60);
      return { entry, start, end: Math.min(end, 24 * 60), col: 0, cols: 1 };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const colEnds: number[] = [];
  const flush = () => {
    const cols = cluster.reduce((m, p) => Math.max(m, p.col), 0) + 1;
    for (const p of cluster) p.cols = cols;
    cluster = [];
    colEnds.length = 0;
  };
  for (const it of items) {
    if (it.start >= clusterEnd) flush();
    let col = colEnds.findIndex((e) => e <= it.start);
    if (col === -1) col = colEnds.length;
    colEnds[col] = it.end;
    it.col = col;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return items;
}

function TimedEvent({ p, resizeEnd, onResizeStart }: { p: Placed; resizeEnd: number | null; onResizeStart: (e: RPointerEvent, p: Placed) => void }) {
  const end = resizeEnd ?? p.end;
  const planned = p.entry.kind === "planned";
  return (
    <div
      className={`week-event ${resizeEnd !== null ? "is-resizing" : ""}`}
      style={{
        top: (p.start / 60) * HOUR_H,
        height: Math.max(18, ((end - p.start) / 60) * HOUR_H - 2),
        left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
        width: `calc(${100 / p.cols}% - 5px)`,
      }}
    >
      <Chip entry={p.entry} timed />
      <span className="week-event-time">
        {toTime(p.start)}
        {planned && (p.entry.task.end_time || resizeEnd !== null) ? ` – ${toTime(Math.min(end, 24 * 60 - 1))}` : ""}
      </span>
      {planned && <span className="week-resize" title="Drag to change the duration" onPointerDown={(e) => onResizeStart(e, p)} />}
    </div>
  );
}

function HourColumn({ day, entries }: { day: string; entries: DayEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastY = useRef(0);
  const moveEntry = useMoveEntry();
  const updateTask = useStore((s) => s.updateTask);
  const openComposer = useStore((s) => s.openComposer);
  const composer = useStore((s) => s.composer);
  const [draft, setDraft] = useState<{ a: number; b: number } | null>(null);
  const touchTap = useRef<{ x: number; y: number } | null>(null);
  const [resize, setResize] = useState<{ id: string; start: number; end: number } | null>(null);
  const yOf = (clientY: number) => clientY - (ref.current?.getBoundingClientRect().top ?? 0);
  const snap = (y: number) => clampMin(Math.round(((y / HOUR_H) * 60) / SNAP) * SNAP);
  const drop = useDropTarget((id, kind) => moveEntry(id, kind, day, Math.min(snap(lastY.current), 24 * 60 - SNAP)));
  const placed = useMemo(() => placeTimed(entries), [entries]);
  const capture = (id: number) => {
    try {
      ref.current?.setPointerCapture(id);
    } catch {
      /* synthetic pointers cannot be captured */
    }
  };

  const pending =
    composer && composer.base.start_date === day && composer.base.start_time
      ? {
          a: minutesOf(composer.base.start_time),
          b: composer.base.end_time ? minutesOf(composer.base.end_time) : minutesOf(composer.base.start_time) + 60,
        }
      : null;
  const box = draft ? { a: Math.min(draft.a, draft.b), b: Math.max(draft.a, draft.b) } : pending;

  return (
    <div
      ref={ref}
      data-day={day}
      className={`week-col ${isWeekend(day) ? "is-weekend" : ""} ${drop.over ? "is-drop" : ""}`}
      {...drop.props}
      onDragOver={(e) => {
        lastY.current = yOf(e.clientY);
        drop.props.onDragOver(e);
      }}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest(".week-event, .floating")) return;
        if (e.pointerType === "touch") {
          touchTap.current = { x: e.clientX, y: e.clientY };
          return;
        }
        capture(e.pointerId);
        const m = Math.min(snap(yOf(e.clientY)), 24 * 60 - SNAP);
        setDraft({ a: m, b: m });
      }}
      onPointerMove={(e) => {
        if (draft) setDraft({ ...draft, b: snap(yOf(e.clientY)) });
        if (resize) setResize({ ...resize, end: Math.max(resize.start + SNAP, snap(yOf(e.clientY))) });
      }}
      onPointerUp={(e) => {
        const tt = touchTap.current;
        touchTap.current = null;
        if (tt && Math.hypot(e.clientX - tt.x, e.clientY - tt.y) < 10) {
          const a = Math.min(Math.floor(yOf(e.clientY) / 30) * 30, 23 * 60);
          const r = ref.current!.getBoundingClientRect();
          openComposer(
            { start_date: day, start_time: toTime(a), end_time: toTime(Math.min(a + 60, 24 * 60 - 1)) },
            { x: r.left, y: r.top + (a / 60) * HOUR_H, w: r.width, h: HOUR_H },
          );
          return;
        }
        if (resize) {
          void updateTask(resize.id, { end_time: toTime(Math.min(resize.end, 24 * 60 - 1)) });
          setResize(null);
        }
        if (!draft) return;
        let a = Math.min(draft.a, draft.b);
        let b = Math.max(draft.a, draft.b);
        if (b - a < SNAP) {
          // A plain click makes a one-hour slot starting on the half hour that was hit.
          a = Math.floor(a / 30) * 30;
          b = Math.min(a + 60, 24 * 60);
        }
        setDraft(null);
        const r = ref.current!.getBoundingClientRect();
        openComposer(
          { start_date: day, start_time: toTime(a), end_time: toTime(Math.min(b, 24 * 60 - 1)) },
          { x: r.left, y: r.top + (a / 60) * HOUR_H, w: r.width, h: ((b - a) / 60) * HOUR_H },
        );
      }}
      onPointerCancel={() => {
        touchTap.current = null;
        setDraft(null);
        setResize(null);
      }}
    >
      {day === todayKey() && <NowLine />}
      {placed.map((p) => (
        <TimedEvent
          key={`${p.entry.task.id}:${p.entry.kind}`}
          p={p}
          resizeEnd={resize?.id === p.entry.task.id ? resize.end : null}
          onResizeStart={(e, item) => {
            e.stopPropagation();
            e.preventDefault();
            capture(e.pointerId);
            setResize({ id: item.entry.task.id, start: item.start, end: item.end });
          }}
        />
      ))}
      {box && (
        <div className="week-draft" style={{ top: (box.a / 60) * HOUR_H, height: Math.max(12, ((box.b - box.a) / 60) * HOUR_H - 2) }}>
          {toTime(box.a)} – {toTime(Math.min(box.b, 24 * 60 - 1))}
        </div>
      )}
    </div>
  );
}

function NowLine() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return <i className="week-now" style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_H }} />;
}

function WeekView({ start, n, tasks, onShift, onExpand }: { start: string; n: number; tasks: Task[]; onShift: (days: number) => void; onExpand: (day: string, anchor: Anchor) => void }) {
  const today = todayKey();
  const days = Array.from({ length: n }, (_, i) => addDays(start, i));
  const cols = { gridTemplateColumns: `58px repeat(${n}, minmax(0, 1fr))` };
  const scroller = useRef<HTMLDivElement>(null);
  // Days with an open deadline get a frame in the header, whatever the deadline's time.
  const deadlineDays = useMemo(() => new Set(tasks.filter((t) => t.status === 0 && t.deadline_date).map((t) => t.deadline_date!)), [tasks]);
  const { range, handlers } = useDayRange();
  const wheel = useStepWheel(onShift, 70);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 7 * HOUR_H });
  }, []);
  // Sideways scrolling (trackpad, or Shift + wheel) moves the week day by day.
  const onWheel = (e: WheelEvent) => {
    if (e.shiftKey && e.deltaY) wheel(e.deltaY);
    else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) wheel(e.deltaX);
  };
  return (
    <div className="week" onWheel={onWheel}>
      <div className="week-head" style={cols}>
        <span className="week-gutter" />
        {days.map((d) => (
          <span key={d} className={`week-day ${d === today ? "is-today" : ""} ${isWeekend(d) ? "is-weekend" : ""} ${deadlineDays.has(d) ? "has-deadline" : ""}`} title={deadlineDays.has(d) ? "A deadline is due this day" : undefined}>
            <i>{WEEKDAYS[(fromKey(d).getDay() + 6) % 7]}</i>
            <b>{+d.slice(8)}</b>
          </span>
        ))}
      </div>
      <div className="week-allday">
        <span className="week-gutter">all day</span>
        <div className="week-allday-row" {...handlers}>
          <WeekRow start={start} tasks={tasks} month={false} capacity={99} range={range} onExpand={onExpand} n={n} />
        </div>
      </div>
      <div className="week-scroll" ref={scroller}>
        <div className="week-grid" style={{ height: 24 * HOUR_H, ...cols }}>
          <div className="week-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="week-hour" style={{ top: h * HOUR_H }}>
                {pad(h)}:00
              </span>
            ))}
          </div>
          {days.map((d) => (
            <HourColumn key={d} day={d} entries={entriesForDay(tasks, d).filter((e) => timeOf(e) && !(e.kind === "planned" && isSpan(e.task)))} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Month ----------

function MonthView({ top, rows = 6, tasks, titleMonth, onShift, onExpand }: { top: string; rows?: number; tasks: Task[]; titleMonth: string; onShift: (weeks: number) => void; onExpand: (day: string, anchor: Anchor) => void }) {
  const [gridRef, height] = useElementHeight<HTMLDivElement>();
  const { range, handlers } = useDayRange();
  const wheel = useStepWheel(onShift, 90);
  const capacity = Math.max(1, Math.floor((height / rows - 32) / CHIP_H));
  return (
    <div className="month">
      <div className="month-dow">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="month-grid" ref={gridRef} style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }} onWheel={(e) => e.deltaY && !e.ctrlKey && !e.shiftKey && wheel(e.deltaY)} {...handlers}>
        {Array.from({ length: rows }, (_, i) => addDays(top, i * 7)).map((ws) => (
          <WeekRow key={ws} start={ws} tasks={tasks} month titleMonth={titleMonth} capacity={capacity} range={range} onExpand={onExpand} />
        ))}
      </div>
    </div>
  );
}

// ---------- Phone: one long, smoothly scrolling month ----------

const SPAN_WEEKS = 26;

/**
 * The phone's month view: weeks scroll freely and snap to a week row; the
 * title follows the month in view. Tapping a day opens its list under that
 * week; holding a day adds a task there (see the touch gestures).
 */
function PhoneMonth({ rows, tasks, todaySignal, onMonth }: { rows: number; tasks: Task[]; todaySignal: number; onMonth: (month: string) => void }) {
  const today = todayKey();
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [anchor, setAnchor] = useState(() => startOfWeek(today));
  const [month, setMonth] = useState(today.slice(0, 7));
  const [focus, setFocus] = useState<string | null>(null);
  // The week in view when weeks are added or dropped, and how far into it the view starts.
  const keep = useRef<{ week: string; delta: number } | null>(null);
  const placed = useRef(false);
  const rowH = Math.max(64, Math.floor((height || 600) / rows));
  const capacity = Math.max(1, Math.floor((rowH - 30) / CHIP_H));
  const weeks = useMemo(() => Array.from({ length: SPAN_WEEKS * 2 + 1 }, (_, i) => addDays(anchor, (i - SPAN_WEEKS) * 7)), [anchor]);
  const focusWeek = focus ? startOfWeek(focus) : null;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const rowEl = (week: string) => ref.current?.querySelector<HTMLElement>(`[data-week="${week}"]`) ?? null;
  // First layout: the current week at the top.
  useLayoutEffect(() => {
    if (!height || placed.current || !ref.current) return;
    placed.current = true;
    ref.current.scrollTop = rowEl(anchor)?.offsetTop ?? 0;
  });
  // Weeks were added above or dropped: keep the same week in view. (Measured,
  // not computed, as browsers may already have moved the view to keep their
  // snap position.)
  useLayoutEffect(() => {
    const k = keep.current;
    keep.current = null;
    const r = k && rowEl(k.week);
    if (r && ref.current) ref.current.scrollTop = r.offsetTop + k.delta;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);
  // "Today": back to the current week.
  useEffect(() => {
    if (!todaySignal) return;
    const week = startOfWeek(todayKey());
    if (!rowEl(week)) {
      placed.current = false;
      setAnchor(week);
    } else ref.current?.scrollTo({ top: rowEl(week)!.offsetTop, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todaySignal]);

  const settle = useRef(0);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    // The month of the week a third of the way down names the view.
    const probe = el.scrollTop + el.clientHeight / 3;
    const hit = [...el.querySelectorAll<HTMLElement>("[data-week]")].find((r) => r.offsetTop + r.offsetHeight > probe);
    if (hit) {
      const m = addDays(hit.dataset.week!, 3).slice(0, 7);
      if (m !== month) {
        setMonth(m);
        onMonth(m);
      }
    }
    // Near either end, more weeks come in once the scrolling has settled.
    clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const near = 6 * rowH;
      const top = el.scrollTop;
      const atEdge = top < near ? -1 : el.scrollHeight - top - el.clientHeight < near ? 1 : 0;
      if (!atEdge) return;
      const inView = [...el.querySelectorAll<HTMLElement>("[data-week]")].find((r) => r.offsetTop + r.offsetHeight > top + 1);
      if (inView) keep.current = { week: inView.dataset.week!, delta: top - inView.offsetTop };
      setAnchor((a) => addDays(a, atEdge * 13 * 7));
    }, 180);
  };

  const openDay = (day: string) => {
    if (focus === day) return setFocus(null);
    setFocus(day);
    requestAnimationFrame(() => {
      const r = rowEl(startOfWeek(day));
      if (r) ref.current?.scrollTo({ top: r.offsetTop, behavior: "smooth" });
    });
  };
  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest(".cal-chip, .m-day-panel")) return;
    const day = t.closest<HTMLElement>("[data-day]")?.dataset.day;
    if (day) openDay(day);
  };
  const dayEntries = focus ? entriesForDay(tasks, focus) : [];
  const dayTasks = [...new Map(dayEntries.map((e) => [e.task.id, e.task])).values()].filter((t) => !t.parent_id);
  const [fy, fm, fd] = (focus ?? today).split("-").map(Number);

  return (
    <div className="month m-month">
      <div className="month-dow">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w.slice(0, 1)}</span>
        ))}
      </div>
      <div className="m-month-scroll" ref={ref} onScroll={onScroll} onClick={onClick}>
        {weeks.map((ws) => (
          <Fragment key={ws}>
            <div className="m-week" data-week={ws} style={{ height: rowH }}>
              <WeekRow
                start={ws}
                tasks={tasks}
                month
                titleMonth={month}
                capacity={capacity}
                range={focus && focusWeek === ws ? [focus, focus] : null}
                onExpand={(day) => openDay(day)}
              />
            </div>
            {focusWeek === ws && focus && (
              <section className="m-day-panel" style={{ maxHeight: Math.max(220, (height || 600) - rowH - 8) }}>
                <header>
                  <b>{WEEKDAYS[(fromKey(focus).getDay() + 6) % 7]}, {fd}. {MONTHS_LONG[fm - 1]}{fy !== +today.slice(0, 4) ? ` ${fy}` : ""}</b>
                  <button type="button" className="icon-btn" aria-label="Close" onClick={() => setFocus(null)}>
                    <Icon name="x" size={14} />
                  </button>
                </header>
                {dayTasks.length ? (
                  dayTasks.map((t) => <TaskRow key={t.id} task={t} showList />)
                ) : (
                  <p className="m-day-empty">Nothing on this day. Hold a day to add a task to it.</p>
                )}
              </section>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** "November 2026", "Nov – Dec 2026" or "Dec 2026 – Jan 2027" for a span of days. */
function rangeTitle(from: string, to: string): string {
  const [y1, m1] = from.split("-").map(Number);
  const [y2, m2] = to.split("-").map(Number);
  const short = (m: number) => MONTHS_LONG[m - 1].slice(0, 3);
  if (y1 === y2 && m1 === m2) return `${MONTHS_LONG[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${short(m1)} – ${short(m2)} ${y1}`;
  return `${short(m1)} ${y1} – ${short(m2)} ${y2}`;
}

/** Popup / side pane switch, shown next to the sort and options buttons. */
export function EditModeToggle({ view }: { view: import("../lib/views").ViewRef }) {
  const mode = useStore((s) => s.editMode(view));
  const setMode = useStore((s) => s.setEditMode);
  const next = mode === "popup" ? "pane" : "popup";
  return (
    <button
      type="button"
      className="icon-btn icon-btn-lg edit-mode-toggle"
      title={mode === "popup" ? "Editing in a popup. Click to edit in the side pane" : "Editing in the side pane. Click to edit in a popup"}
      onClick={() => void setMode(view, next)}
    >
      <Icon name={mode === "popup" ? "editpopup" : "editpane"} size={20} />
    </button>
  );
}

export function CalendarView() {
  const today = todayKey();
  const mode = useStore((s) => s.calMode);
  const setMode = useStore((s) => s.setCalMode);
  const todayTick = useStore((s) => s.calTodayTick);
  const detached = useStore((s) => s.detached);
  const [rootRef, width] = useElementWidth<HTMLDivElement>();
  const n = width === 0 || width >= 640 ? 7 : width >= 430 ? 3 : 1;
  // Month: Monday of the first visible row. Week: first visible day.
  const [top, setTop] = useState(() => startOfWeek(startOfMonth(today)));
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
  // Multi-week: Monday of the first row; starts with the current week.
  const [mwTop, setMwTop] = useState(() => startOfWeek(today));
  const weeks = useStore((s) => s.calWeeks);
  const setWeeks = useStore((s) => s.setCalWeeks);
  const shortcuts = useStore((s) => s.shortcuts);
  const calMonthLike = useStore((s) => s.calMonthLike);
  const [expanded, setExpanded] = useState<{ day: string; anchor: Anchor } | null>(null);
  const lists = useStore((s) => s.lists);
  const sections = useStore((s) => s.sections);
  const tasks = useStore((s) => s.tasks);
  const settings = useStore((s) => s.settings);
  const showCompleted = useStore((s) => s.showCompleted);
  const setShowCompleted = useStore((s) => s.setShowCompleted);
  const openComposer = useStore((s) => s.openComposer);

  const visible = useMemo(
    () => tasksForView({ kind: "calendar" }, { lists, sections, tasks, hidden: hiddenLists(settings) }, showCompleted),
    [lists, sections, tasks, settings, showCompleted],
  );

  // The month the grid mostly shows: the one its middle day falls in.
  const titleKey = mode === "month" ? addDays(top, 20) : mode === "multiweek" ? addDays(mwTop, Math.floor((weeks * 7) / 2)) : addDays(weekStart, 3);
  const titleMonth = titleKey.slice(0, 7);
  const [ty, tm] = titleKey.split("-").map(Number);
  const step = (dir: number) => {
    if (mode === "month") setTop(startOfWeek(addMonths(`${titleMonth}-01`, dir)));
    else if (mode === "multiweek") setMwTop(addDays(mwTop, dir * weeks * 7));
    else setWeekStart(addDays(weekStart, dir * n));
  };
  const goToday = () => {
    setTop(startOfWeek(startOfMonth(today)));
    setMwTop(startOfWeek(today));
    setWeekStart(n === 7 ? startOfWeek(today) : today);
  };
  useEffect(() => {
    if (todayTick) goToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayTick]);
  const onExpand = (day: string, anchor: Anchor) => setExpanded({ day, anchor });
  // Phones scroll the month views; only the week view pages by swiping.
  const phoneMonth = isMobile && mode !== "week";
  const swipe = useSwipe(step, false);
  const [todaySignal, setTodaySignal] = useState(0);
  const [phoneTitle, setPhoneTitle] = useState(today.slice(0, 7));

  return (
    <div className="calendar" ref={rootRef} {...(phoneMonth ? {} : swipe)}>
      <header className="view-head" data-tauri-drag-region={detached ? true : undefined}>
        <h1 data-tauri-drag-region={detached ? true : undefined}>
          {phoneMonth
            ? `${MONTHS_LONG[+phoneTitle.slice(5, 7) - 1]}${phoneTitle.slice(0, 4) !== today.slice(0, 4) ? ` ${phoneTitle.slice(0, 4)}` : ""}`
            : mode === "multiweek"
              ? rangeTitle(mwTop, addDays(mwTop, weeks * 7 - 1))
              : `${MONTHS_LONG[tm - 1]} ${ty}`}
        </h1>
        <div className="head-tools">
          <button type="button" className="btn btn-square cal-add" title="New task today" onClick={(e) => openComposer({ start_date: today }, anchorOf(e.currentTarget))}>
            <Icon name="plus" />
          </button>
          <Popover
            align="right"
            trigger={
              <span className="btn">
                {mode === "month" ? "Month" : mode === "multiweek" ? `${weeks} Weeks` : "Week"}
                <span className="down">
                  <Icon name="chevron" size={12} />
                </span>
              </span>
            }
          >
            {(close) => (
              <div className="menu">
                <MenuItem active={mode === "week"} onClick={() => { setMode("week"); close(); }}>
                  Week <kbd className="menu-kbd">{shortcuts.calWeek}</kbd>
                </MenuItem>
                <MenuItem active={mode === "month"} onClick={() => { setMode("month"); close(); }}>
                  Month <kbd className="menu-kbd">{calMonthLike === "month" ? shortcuts.calMonth : ""}</kbd>
                </MenuItem>
                <div className="cm-sep" />
                <div className={`menu-item multiweek-item ${mode === "multiweek" ? "is-active" : ""}`}>
                  <button type="button" className="menu-label mw-label" onClick={() => { setMode("multiweek"); close(); }}>
                    Multi-Week {calMonthLike === "multiweek" && <kbd className="menu-kbd">{shortcuts.calMonth}</kbd>}
                  </button>
                  <span className="mw-stepper">
                    <button type="button" aria-label="Fewer weeks" disabled={weeks <= 2} onClick={() => { setWeeks(weeks - 1); setMode("multiweek"); }}>−</button>
                    <b>{weeks}</b>
                    <button type="button" aria-label="More weeks" disabled={weeks >= 6} onClick={() => { setWeeks(weeks + 1); setMode("multiweek"); }}>+</button>
                  </span>
                </div>
              </div>
            )}
          </Popover>
          <div className="stepper">
            <button type="button" aria-label="Previous" onClick={() => step(-1)}>
              <span className="flip"><Icon name="chevron" size={14} /></span>
            </button>
            <button
              type="button"
              className="stepper-today"
              onClick={() => {
                goToday();
                setTodaySignal((n) => n + 1);
              }}
            >
              Today
            </button>
            <button type="button" aria-label="Next" onClick={() => step(1)}>
              <Icon name="chevron" size={14} />
            </button>
          </div>
          <EditModeToggle view={{ kind: "calendar" }} />
          <Popover align="right" title="Options" trigger={<span className="icon-btn icon-btn-lg"><Icon name="dots" size={18} /></span>}>
            {(close) => (
              <div className="menu">
                <MenuItem active={showCompleted} onClick={() => { setShowCompleted(!showCompleted); close(); }}>
                  <Icon name="done" size={15} /> Show Completed
                </MenuItem>
              </div>
            )}
          </Popover>
        </div>
      </header>
      {phoneMonth ? (
        <PhoneMonth rows={mode === "month" ? 5 : weeks} tasks={visible} todaySignal={todaySignal + todayTick} onMonth={setPhoneTitle} />
      ) : mode === "month" ? (
        <MonthView top={top} tasks={visible} titleMonth={titleMonth} onShift={(w) => setTop((t) => addDays(t, w * 7))} onExpand={onExpand} />
      ) : mode === "multiweek" ? (
        <MonthView top={mwTop} rows={weeks} tasks={visible} titleMonth="" onShift={(w) => setMwTop((t) => addDays(t, w * 7))} onExpand={onExpand} />
      ) : (
        <WeekView start={weekStart} n={n} tasks={visible} onShift={(d) => setWeekStart((s) => addDays(s, d))} onExpand={onExpand} />
      )}
      {expanded && (
        <FloatingPanel anchor={expanded.anchor} onClose={() => setExpanded(null)} className="day-sheet">
          <header>
            {MONTHS_LONG[+expanded.day.slice(5, 7) - 1]} {+expanded.day.slice(8)}
          </header>
          {entriesForDay(visible, expanded.day).map((e) => (
            <Chip key={`${e.task.id}:${e.kind}`} entry={e} />
          ))}
        </FloatingPanel>
      )}
    </div>
  );
}
