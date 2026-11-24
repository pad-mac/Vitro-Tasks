import { flushSync } from "react-dom";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent, type WheelEvent } from "react";
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
import { entriesForDay, hiddenLists, tasksForView, withRepeats, type DayEntry } from "../lib/views";
import { describeRepeat } from "../lib/repeat";
import type { Task } from "../shared/schema";
import { anchorOf, useStore, type Anchor } from "../store";
import { dragProps, useDropTarget, useTaskMenu } from "./tasks";
import { useSwipe } from "./Mobile";
import { TaskRow } from "./tasks";
import { haptic, isMobile } from "../lib/platform";
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

/** A wheel event's distance in pixels (some mice report lines or pages). */
function wheelPx(e: WheelEvent, delta: number, page: number): number {
  return e.deltaMode === 1 ? delta * 16 : e.deltaMode === 2 ? delta * page : delta;
}

/**
 * Wheel and trackpad move a view smoothly and it settles on whole steps (a
 * week row, a day column). The track holds one extra step on each side; once
 * it has moved a whole step, the view steps and the track jumps back by one in
 * the same frame, so nothing visibly jumps. When the wheel rests, it glides on
 * to the next step (a quarter of one is enough) or back.
 */
function useGlide(size: number, onStep: (dir: number) => void, apply: (px: number) => void) {
  const st = useRef({ target: 0, shown: 0, raf: 0, idle: 0 });
  const cfg = useRef({ size, onStep, apply });
  cfg.current = { size, onStep, apply };
  useEffect(
    () => () => {
      cancelAnimationFrame(st.current.raf);
      clearTimeout(st.current.idle);
    },
    [],
  );
  const frame = () => {
    const s = st.current;
    const { size: z, onStep: step, apply: put } = cfg.current;
    s.raf = 0;
    if (!z) return;
    const d = s.target - s.shown;
    s.shown = Math.abs(d) < 0.5 ? s.target : s.shown + d * 0.35;
    while (s.shown >= z) {
      s.shown -= z;
      s.target -= z;
      flushSync(() => step(1));
    }
    while (s.shown <= -z) {
      s.shown += z;
      s.target += z;
      flushSync(() => step(-1));
    }
    put(s.shown);
    if (s.shown !== s.target) s.raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!st.current.raf) st.current.raf = requestAnimationFrame(frame);
  };
  return (delta: number) => {
    const s = st.current;
    const z = cfg.current.size;
    if (!z) return;
    // A fast flick still moves step by step, never far ahead of what is shown.
    s.target = Math.max(s.shown - 3 * z, Math.min(s.shown + 3 * z, s.target + delta));
    clearTimeout(s.idle);
    s.idle = window.setTimeout(() => {
      // Moved at least a quarter of a step: on to the next one (a wheel notch is often less than a wide day); less: back.
      const n = s.target / z;
      const whole = Math.trunc(n);
      s.target = (Math.abs(n - whole) >= 0.25 ? whole + Math.sign(n - whole) : whole) * z;
      kick();
    }, 110);
    kick();
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

/** The mark on an entry of a repeating task (its later occurrences in the calendar are projections of it). */
function RepeatMark({ task }: { task: Task }) {
  if (!task.repeat || task.status !== 0) return null;
  return (
    <span className="cal-repeat" title={describeRepeat(task.repeat, task.start_date ?? task.deadline_date, true)}>
      <Icon name="repeat" size={10} />
    </span>
  );
}

function Chip({ entry, timed, children }: { entry: DayEntry; timed?: boolean; children?: React.ReactNode }) {
  const lists = useStore((s) => s.lists);
  const { task, kind } = entry;
  // A projected occurrence opens (and gets the menu of) the real task, and does not move.
  const ghost = task.ghostOf;
  const real = ghost ?? task.id;
  const isSelected = useStore((s) => !ghost && s.selectedId === task.id);
  const select = useStore((s) => s.select);
  const onMenu = useTaskMenu(real);
  const color = lists.find((l) => l.id === task.list_id)?.color ?? "var(--faint)";
  const time = timeOf(entry);
  return (
    <div
      className={`cal-chip ${kind === "deadline" ? "is-deadline" : time && !timed ? "is-timed" : ""} ${task.status ? "is-done" : ""} ${isSelected ? "is-selected" : ""} ${ghost ? "is-ghost" : ""}`}
      data-id={ghost ? undefined : task.id}
      data-ghost={ghost}
      style={{ ["--c" as string]: color }}
      title={`${kind === "deadline" ? "Deadline: " : ""}${plainText(task.title)}`}
      onClick={(e) => {
        e.stopPropagation();
        select(real, anchorOf(e.currentTarget));
      }}
      onContextMenu={onMenu}
      {...(ghost ? {} : dragProps(task.id, kind))}
    >
      {timed ? (
        <span className="cal-chip-line">
          {kind === "deadline" && <Icon name="deadline" size={11} />}
          <span className="cal-chip-title">{plainText(task.title) || "Untitled"}</span>
          <RepeatMark task={task} />
        </span>
      ) : (
        <>
          {kind === "deadline" && <Icon name="deadline" size={11} />}
          <span className="cal-chip-title">{plainText(task.title) || "Untitled"}</span>
          <RepeatMark task={task} />
        </>
      )}
      {children}
      {time && !timed && <span className="cal-chip-time">{time}</span>}
      {kind === "planned" && !time && !timed && !ghost && <EdgeHandles task={task} />}
    </div>
  );
}

function SpanBar({ task, c0, c1, lane, top, from, to, n }: { task: Task; c0: number; c1: number; lane: number; top: number; from: string; to: string; n: number }) {
  const lists = useStore((s) => s.lists);
  const ghost = task.ghostOf;
  const real = ghost ?? task.id;
  const isSelected = useStore((s) => !ghost && s.selectedId === task.id);
  const select = useStore((s) => s.select);
  const onMenu = useTaskMenu(real);
  const color = lists.find((l) => l.id === task.list_id)?.color ?? "var(--faint)";
  const left = task.start_date! < from;
  const right = task.end_date! > to;
  return (
    <div
      className={`cal-chip cal-span ${left ? "cont-left" : ""} ${right ? "cont-right" : ""} ${task.status ? "is-done" : ""} ${isSelected ? "is-selected" : ""} ${ghost ? "is-ghost" : ""} ${(task.end_date ?? task.start_date)! < todayKey() ? "is-past" : ""}`}
      data-id={ghost ? undefined : task.id}
      data-ghost={ghost}
      style={{
        ["--c" as string]: color,
        // Inset like the day's own chips (the cell's padding), so bars and chips start in line.
        left: `calc(${(c0 / n) * 100}% + ${left ? "0px" : "var(--span-inset)"})`,
        width: `calc(${((c1 - c0 + 1) / n) * 100}% - ${left ? "0px" : "var(--span-inset)"} - ${right ? "0px" : "var(--span-inset)"})`,
        top: top + lane * CHIP_H,
      }}
      title={plainText(task.title)}
      onClick={(e) => {
        e.stopPropagation();
        select(real, anchorOf(e.currentTarget));
      }}
      onContextMenu={onMenu}
      {...(ghost ? {} : dragProps(task.id, "planned"))}
    >
      <span className="cal-chip-title">{plainText(task.title) || "Untitled"}</span>
      <RepeatMark task={task} />
      {!ghost && <EdgeHandles task={task} start={!left} end={!right} />}
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
  /** In a dragged range: false, or its end classes ("sel-l", "sel-r"). */
  selected: string | false;
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
      className={`cal-cell ${outside ? "is-out" : ""} ${day < today ? "is-past" : ""} ${isWeekend(day) ? "is-weekend" : ""} ${drop.over ? "is-drop" : ""} ${selected ? `is-sel ${selected}` : ""}`}
      style={{ paddingTop: (month ? 30 : 4) + lanes * CHIP_H }}
      {...drop.props}
    >
      {month && (
        <span className={`cal-daynum ${day === today ? "is-today" : ""}`}>
          {+day.slice(8) === 1 && !isMobile && <em>{MONTHS_LONG[+day.slice(5, 7) - 1].slice(0, 3)}</em>}
          <b>{+day.slice(8)}</b>
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
  // With the later occurrences of repeating tasks in these days.
  const all = useMemo(() => withRepeats(tasks, start, end), [tasks, start, end]);
  const { spans, lanesAt } = useMemo(() => {
    const list = all
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
  }, [all, start, end, n]);
  const entriesByDay = useMemo(
    () => days.map((d) => entriesForDay(all, d).filter((e) => !(e.kind === "planned" && isSpan(e.task)) && (month || !timeOf(e)))),
    [all, days, month],
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
  // A dragged range of days: one bar per week row, rounded only at its ends.
  const sel = (i: number) => i >= 0 && i < days.length && !!range && days[i] >= range[0] && days[i] <= range[1];
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
          selected={sel(i) ? `${sel(i - 1) ? "" : "sel-l"} ${sel(i + 1) ? "" : "sel-r"}` : false}
          onExpand={onExpand}
        />
      ))}
      {visible.map((s) => (
        <SpanBar key={s.task.id} {...s} top={month ? 30 : 4} from={start} to={end} n={n} />
      ))}
    </div>
  );
}

/** The phone's month: a week re-renders only when its own props change (see PhoneMonth). */
const PhoneWeekRow = memo(WeekRow);

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

function TimedEvent({ p, past, resizeEnd, onResizeStart }: { p: Placed; past: boolean; resizeEnd: number | null; onResizeStart: (e: RPointerEvent, p: Placed) => void }) {
  const end = resizeEnd ?? p.end;
  const planned = p.entry.kind === "planned";
  const height = Math.max(18, ((end - p.start) / 60) * HOUR_H - 2);
  return (
    <div
      className={`week-event ${resizeEnd !== null ? "is-resizing" : ""} ${past ? "is-past" : ""}`}
      style={{
        // Wrapped titles stop at the last line that fits (with the time under them), not mid-line.
        ["--lines" as string]: Math.max(1, Math.floor((height - 4 - 14) / 15)),
        top: (p.start / 60) * HOUR_H,
        height,
        left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
        width: `calc(${100 / p.cols}% - 5px)`,
      }}
    >
      <Chip entry={p.entry} timed>
        <span className="week-event-time">
          {toTime(p.start)}
          {planned && (p.entry.task.end_time || resizeEnd !== null) ? ` – ${toTime(Math.min(end, 24 * 60 - 1))}` : ""}
        </span>
      </Chip>
      {planned && !p.entry.task.ghostOf && <span className="week-resize" title="Drag to change the duration" onPointerDown={(e) => onResizeStart(e, p)} />}
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
  // Today's entries fade once they are over; earlier days fade as a whole (.week-col.is-past).
  const today = todayKey();
  const isToday = day === today;
  const nowMin = useMinutesNow(isToday);
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
      className={`week-col ${isWeekend(day) ? "is-weekend" : ""} ${day < today ? "is-past" : ""} ${drop.over ? "is-drop" : ""}`}
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
      {isToday && <NowLine />}
      {placed.map((p) => (
        <TimedEvent
          key={`${p.entry.task.id}:${p.entry.kind}`}
          p={p}
          past={isToday && p.end <= nowMin}
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

// The minute now, one clock for everything in the calendar that follows it
// (the now line, today's entries that are over), ticking on the minute.
let clockNow = Date.now();
const clockSubs = new Set<() => void>();
let clockTimer: ReturnType<typeof setTimeout> | undefined;
const nextTick = () => setTimeout(tickClock, 60_000 - (Date.now() % 60_000) + 20);
function tickClock() {
  clockNow = Date.now();
  clockSubs.forEach((f) => f());
  clockTimer = nextTick();
}
function subscribeClock(f: () => void) {
  clockSubs.add(f);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = nextTick();
  }
  return () => {
    clockSubs.delete(f);
    if (!clockSubs.size) {
      clearTimeout(clockTimer);
      clockTimer = undefined;
    }
  };
}
const noClock = () => () => {};
/** Minutes into the day now; follows the clock only where `live` (today's column), else read once. */
function useMinutesNow(live: boolean): number {
  const at = useSyncExternalStore(live ? subscribeClock : noClock, () => clockNow);
  const d = new Date(live ? at : Date.now());
  return d.getHours() * 60 + d.getMinutes();
}

function NowLine() {
  const now = useMinutesNow(true);
  return <i className="week-now" style={{ top: (now / 60) * HOUR_H }} />;
}

/** A day's header in the week view; a task dropped on it goes to that day's all-day row. */
function WeekDayHead({ day, today, deadline }: { day: string; today: string; deadline: boolean }) {
  const moveEntry = useMoveEntry();
  const drop = useDropTarget((id, kind) => moveEntry(id, kind, day, null));
  return (
    <span
      data-day={day}
      className={`week-day ${day === today ? "is-today" : ""} ${isWeekend(day) ? "is-weekend" : ""} ${deadline ? "has-deadline" : ""} ${drop.over ? "is-drop" : ""}`}
      title={deadline ? "A deadline is due this day" : undefined}
      {...drop.props}
    >
      <i>{WEEKDAYS[(fromKey(day).getDay() + 6) % 7]}</i>
      <b>{+day.slice(8)}</b>
    </span>
  );
}

function WeekView({ start, n, tasks, onShift, onExpand }: { start: string; n: number; tasks: Task[]; onShift: (days: number) => void; onExpand: (day: string, anchor: Anchor) => void }) {
  const today = todayKey();
  // One hidden day on each side: sideways scrolling glides into them (see useGlide).
  const days = Array.from({ length: n + 2 }, (_, i) => addDays(start, i - 1));
  const scroller = useRef<HTMLDivElement>(null);
  const [paneRef, paneW] = useElementWidth<HTMLDivElement>();
  const colW = (paneW || 700) / n;
  const tracks = useRef<(HTMLDivElement | null)[]>([]);
  const wrap = useStore((s) => s.calWrap);
  // The hour grid with the later occurrences of repeating tasks (the all-day row adds its own).
  const first = days[0];
  const last = days[n + 1];
  const shown = useMemo(() => withRepeats(tasks, first, last), [tasks, first, last]);
  // Days with an open deadline get a frame in the header, whatever the deadline's time.
  const deadlineDays = useMemo(() => new Set(shown.filter((t) => t.status === 0 && t.deadline_date).map((t) => t.deadline_date!)), [shown]);
  const { range, handlers } = useDayRange();
  const glide = useGlide(colW, onShift, (px) => {
    for (const t of tracks.current) if (t) t.style.transform = `translateX(${-colW - px}px)`;
  });
  // From 07:00 (its label in view), or around now when now would be below what that shows.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const from = 7 * HOUR_H - 10;
    const d = new Date();
    const now = (d.getHours() + d.getMinutes() / 60) * HOUR_H;
    el.scrollTo({ top: now > from + el.clientHeight - 1.5 * HOUR_H ? Math.max(0, now - el.clientHeight / 3) : from });
  }, []);
  // Sideways scrolling (trackpad, or Shift + wheel) moves the week smoothly, settling on a day.
  const onWheel = (e: WheelEvent) => {
    if (e.shiftKey && e.deltaY) glide(wheelPx(e, e.deltaY, colW));
    else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) glide(wheelPx(e, e.deltaX, colW));
  };
  const track = (i: number, extra: React.CSSProperties = {}) => ({
    ref: (el: HTMLDivElement | null) => {
      tracks.current[i] = el;
    },
    className: "week-track",
    style: { width: colW * (n + 2), gridTemplateColumns: `repeat(${n + 2}, ${colW}px)`, transform: `translateX(${-colW}px)`, ...extra },
  });
  return (
    <div className={`week ${wrap ? "is-wrap" : ""}`} onWheel={onWheel}>
      <div className="week-head">
        <span className="week-gutter" />
        {/* As wide as the hour grid's days (with or without a scrollbar beside them), so the days line up. */}
        <div className="week-pane" style={{ width: paneW || undefined }}>
          <div {...track(0)}>
            {days.map((d) => (
              <WeekDayHead key={d} day={d} today={today} deadline={deadlineDays.has(d)} />
            ))}
          </div>
        </div>
      </div>
      <div className="week-allday">
        <span className="week-gutter">all day</span>
        <div className="week-allday-row week-pane" style={{ width: paneW || undefined }} {...handlers}>
          <div {...track(1, { display: "block" })}>
            <WeekRow start={days[0]} tasks={tasks} month={false} capacity={99} range={range} onExpand={onExpand} n={n + 2} />
          </div>
        </div>
      </div>
      <div className="week-scroll" ref={scroller}>
        <div className="week-grid" style={{ height: 24 * HOUR_H }}>
          <div className="week-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="week-hour" style={{ top: h * HOUR_H }}>
                {pad(h)}:00
              </span>
            ))}
          </div>
          <div className="week-pane" ref={paneRef}>
            <div {...track(2, { height: "100%" })}>
              {days.map((d) => (
                <HourColumn key={d} day={d} entries={entriesForDay(shown, d).filter((e) => timeOf(e) && !(e.kind === "planned" && isSpan(e.task)))} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Month ----------

function MonthView({ top, rows = 6, tasks, titleMonth, onShift, onExpand }: { top: string; rows?: number; tasks: Task[]; titleMonth: string; onShift: (weeks: number) => void; onExpand: (day: string, anchor: Anchor) => void }) {
  const [gridRef, height] = useElementHeight<HTMLDivElement>();
  const { range, handlers } = useDayRange();
  const rowH = (height || 600) / rows;
  const track = useRef<HTMLDivElement>(null);
  // The wheel moves the weeks smoothly; they settle on a row (one hidden week above and below).
  const glide = useGlide(rowH, onShift, (px) => {
    if (track.current) track.current.style.transform = `translateY(${-rowH - px}px)`;
  });
  const capacity = Math.max(1, Math.floor((rowH - 32) / CHIP_H));
  return (
    <div className="month">
      <div className="month-dow">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="month-grid" ref={gridRef} onWheel={(e) => e.deltaY && !e.ctrlKey && !e.shiftKey && glide(wheelPx(e, e.deltaY, rowH))} {...handlers}>
        <div ref={track} className="month-track" style={{ gridTemplateRows: `repeat(${rows + 2}, ${rowH}px)`, height: rowH * (rows + 2), transform: `translateY(${-rowH}px)` }}>
          {Array.from({ length: rows + 2 }, (_, i) => addDays(top, (i - 1) * 7)).map((ws) => (
            <WeekRow key={ws} start={ws} tasks={tasks} month titleMonth={titleMonth} capacity={capacity} range={range} onExpand={onExpand} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Phone: one long, smoothly scrolling month ----------

/** The last day jump (from a widget) the calendar has shown: a calendar opened later starts at today again. */
let takenJump = 0;

const SPAN_WEEKS = 26;

/**
 * The phone's month view: weeks scroll freely and snap to a week row; the
 * title follows the month in view. Tapping a day opens its list under that
 * week; holding a day adds a task there (see the touch gestures).
 */
function PhoneMonth({
  rows,
  tasks,
  todaySignal,
  jump,
  onMonth,
}: {
  rows: number;
  tasks: Task[];
  todaySignal: number;
  /** A day to open (a tap on a widget's day). */
  jump: { day: string; tick: number } | null;
  onMonth: (month: string) => void;
}) {
  const today = todayKey();
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  // Room the bottom bar takes over the end of the view.
  const [barPad, setBarPad] = useState(0);
  const [anchor, setAnchor] = useState(() => startOfWeek(today));
  const [month, setMonth] = useState(today.slice(0, 7));
  // The day whose tasks show under its week, and whether the view is split open
  // (kept apart so the panel can close with an animation).
  const [focus, setFocus] = useState<string | null>(null);
  const [split, setSplit] = useState(false);
  const splitRef = useRef(false);
  splitRef.current = split;
  // Days being swept over (hold a day and move): they become a new task's span.
  const [sweep, setSweep] = useState<[string, string] | null>(null);
  // The week in view when weeks are added or dropped, and how far into it the view starts.
  const keep = useRef<{ week: string; delta: number } | null>(null);
  const placed = useRef(false);
  const rowH = Math.max(64, Math.floor((height || 600) / rows));
  const capacity = Math.max(1, Math.floor((rowH - 30) / CHIP_H));
  // While split, the open week has the height of a month row and the day's
  // list takes the rest of the view, down to the bar.
  const splitRowH = Math.max(64, Math.floor((height || 600) / 5));
  const splitCapacity = Math.max(1, Math.floor((splitRowH - 30) / CHIP_H));
  // A strip of the calendar stays in view below the list: swipe or tap there to close it.
  const panelH = Math.max(160, (height || 600) - barPad - splitRowH - 16 - 76);
  // Right after closing, the view settles; no weeks are added or dropped meanwhile.
  const quietUntil = useRef(0);
  const weeks = useMemo(() => Array.from({ length: SPAN_WEEKS * 2 + 1 }, (_, i) => addDays(anchor, (i - SPAN_WEEKS) * 7)), [anchor]);
  const focusWeek = focus ? startOfWeek(focus) : null;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setHeight(el.clientHeight);
      setBarPad(parseFloat(getComputedStyle(el).paddingBottom) || 0);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const on = (e: Event) => {
      const r = (e as CustomEvent<{ a: string; b: string } | null>).detail;
      setSweep(r ? (r.a <= r.b ? [r.a, r.b] : [r.b, r.a]) : null);
    };
    window.addEventListener("vitro:dayrange", on);
    return () => window.removeEventListener("vitro:dayrange", on);
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

  /** A short eased scroll (snapping is off meanwhile, or it would pull against it). */
  const glide = useRef(0);
  const scrollToY = (target: number) => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(glide.current);
    const from = el.scrollTop;
    const d = target - from;
    if (Math.abs(d) < 1) return;
    el.classList.add("no-snap");
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 170);
      el.scrollTop = from + d * (1 - (1 - p) ** 3);
      if (p < 1) glide.current = requestAnimationFrame(step);
      else el.classList.remove("no-snap");
    };
    glide.current = requestAnimationFrame(step);
  };

  const closeDay = () => {
    if (!splitRef.current) return;
    quietUntil.current = Date.now() + 700;
    setSplit(false);
    window.setTimeout(() => {
      if (!splitRef.current) setFocus(null);
    }, 190);
  };
  // Weeks are memoised: opening a day re-renders its week (and the panel), not every week in the view.
  const openDayRef = useRef<(day: string) => void>(() => {});
  const expand = useCallback((day: string) => openDayRef.current(day), []);
  const focusPair = useMemo<[string, string] | null>(() => (focus ? [focus, focus] : null), [focus]);
  const openDay = (day: string) => {
    if (split && focus === day) return closeDay();
    const wasSplit = split;
    setFocus(day);
    // The title names the open day's month.
    const m = day.slice(0, 7);
    if (m !== month) {
      setMonth(m);
      onMonth(m);
    }
    if (wasSplit && focusWeek === startOfWeek(day)) return;
    clearTimeout(settle.current);
    // Mount the panel closed, then let it grow while the week moves to the top.
    requestAnimationFrame(() => {
      setSplit(true);
      const r = rowEl(startOfWeek(day));
      if (r) scrollToY(r.offsetTop);
    });
  };
  openDayRef.current = openDay;

  // "Today": back to the current week.
  useEffect(() => {
    if (!todaySignal) return;
    closeDay();
    const week = startOfWeek(todayKey());
    if (!rowEl(week)) {
      placed.current = false;
      setAnchor(week);
    } else scrollToY(rowEl(week)!.offsetTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todaySignal]);

  // A day from a widget: its week to the top, the day open under it. (This runs
  // before the calendar's own effect, which marks the jump as taken.)
  useEffect(() => {
    if (!jump || jump.tick <= takenJump) return;
    const week = startOfWeek(jump.day);
    if (!rowEl(week)) {
      placed.current = false;
      setAnchor(week);
    }
    // After the weeks around it are in place.
    requestAnimationFrame(() => requestAnimationFrame(() => openDayRef.current(jump.day)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.tick]);

  const settle = useRef(0);
  const onScroll = () => {
    const el = ref.current;
    if (!el || splitRef.current) return;
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
      if (splitRef.current || Date.now() < quietUntil.current) return;
      const near = 6 * rowH;
      const top = el.scrollTop;
      const atEdge = top < near ? -1 : el.scrollHeight - top - el.clientHeight < near ? 1 : 0;
      if (!atEdge) return;
      const inView = [...el.querySelectorAll<HTMLElement>("[data-week]")].find((r) => r.offsetTop + r.offsetHeight > top + 1);
      if (inView) keep.current = { week: inView.dataset.week!, delta: top - inView.offsetTop };
      setAnchor((a) => addDays(a, atEdge * 13 * 7));
    }, 180);
  };

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest(".cal-chip, .m-day-panel")) return;
    // Split: days of the open week switch the day; a tap on the strip below the list closes it.
    if (split && !t.closest(".m-week.is-focus")) return closeDay();
    const day = t.closest<HTMLElement>("[data-day]")?.dataset.day;
    if (day) openDay(day);
  };
  // While split the calendar does not scroll: its touches are held back
  // (switching the scroller off instead is what WebKit sometimes failed to
  // redraw). A swipe above or below the list closes it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hold = (e: TouchEvent) => {
      if (splitRef.current && !(e.target as HTMLElement).closest(".m-day-panel")) e.preventDefault();
    };
    el.addEventListener("touchmove", hold, { passive: false });
    return () => el.removeEventListener("touchmove", hold);
  }, []);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    swipe.current = split && !(e.target as HTMLElement).closest(".m-day-panel") ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s0 = swipe.current;
    swipe.current = null;
    if (!s0) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - s0.y;
    if (Math.abs(dy) > 30 && Math.abs(dy) > Math.abs(t.clientX - s0.x)) closeDay();
  };

  const dayEntries = focus ? entriesForDay(withRepeats(tasks, focus, focus), focus) : [];
  const dayTasks = [...new Map(dayEntries.map((e) => [e.task.id, e.task])).values()].filter((t) => !t.parent_id);
  const [fy, fm, fd] = (focus ?? today).split("-").map(Number);

  return (
    <div className="month m-month">
      <div className="month-dow">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w.slice(0, 1)}</span>
        ))}
      </div>
      <div
        className={`m-month-scroll ${split ? "is-split" : ""}`}
        ref={ref}
        onScroll={onScroll}
        onClick={onClick}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {weeks.map((ws) => {
          const open = split && focusWeek === ws;
          return (
            <Fragment key={ws}>
              <div className={`m-week ${focusWeek === ws ? "is-focus" : ""}`} data-week={ws} style={{ height: open ? splitRowH : rowH }}>
                <PhoneWeekRow
                  start={ws}
                  tasks={tasks}
                  month
                  titleMonth={month}
                  capacity={open ? splitCapacity : capacity}
                  range={sweep ?? (focusWeek === ws ? focusPair : null)}
                  onExpand={expand}
                />
              </div>
              {focusWeek === ws && focus && (
                <section className={`m-day-panel ${open ? "is-open" : ""}`} style={{ height: open ? panelH : 0 }}>
                  <header>
                    <b>
                      {WEEKDAYS[(fromKey(focus).getDay() + 6) % 7]}, {fd}. {MONTHS_LONG[fm - 1]}
                      {fy !== +today.slice(0, 4) ? ` ${fy}` : ""}
                    </b>
                    <button type="button" className="icon-btn" aria-label="Close" onClick={closeDay}>
                      <Icon name="x" size={14} />
                    </button>
                  </header>
                  <div className="m-day-list">
                    {dayTasks.length ? (
                      dayTasks.map((t) => (t.ghostOf ? <GhostRow key={t.id} task={t} /> : <TaskRow key={t.id} task={t} showList />))
                    ) : (
                      <p className="m-day-empty">Nothing on this day. Hold a day to add a task to it, or hold and move across days for a longer one.</p>
                    )}
                  </div>
                </section>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** A later occurrence of a repeating task in the phone's day list: it opens the task, which sits on its current date. */
function GhostRow({ task }: { task: Task }) {
  const select = useStore((s) => s.select);
  const real = useStore((s) => s.tasks.find((t) => t.id === task.ghostOf));
  if (!real) return null;
  return (
    <button type="button" className="ghost-row" onClick={() => select(real.id)}>
      <Icon name="repeat" size={14} />
      <span className="ghost-title">{plainText(task.title) || "Untitled"}</span>
      <span className="ghost-meta">{describeRepeat(real.repeat, real.start_date ?? real.deadline_date)}</span>
    </button>
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

function CalendarViewImpl() {
  const today = todayKey();
  const mode = useStore((s) => s.calMode);
  const setMode = useStore((s) => s.setCalMode);
  const todayTick = useStore((s) => s.calTodayTick);
  const detached = useStore((s) => s.detached);
  // Week: the seven days (on phones too, in narrow columns). Multi-day: 1–6 days side by side.
  const calDays = useStore((s) => s.calDays);
  const setCalDays = useStore((s) => s.setCalDays);
  const n = mode === "days" ? calDays : 7;
  // Month: Monday of the first visible row. Week: first visible day. Multi-day: its first day (today to start with).
  const [top, setTop] = useState(() => startOfWeek(startOfMonth(today)));
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
  const [dayStart, setDayStart] = useState(today);
  const start = mode === "days" ? dayStart : weekStart;
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
  const lingering = useStore((s) => s.lingering);
  const setShowCompleted = useStore((s) => s.setShowCompleted);
  const calWrap = useStore((s) => s.calWrap);
  const setCalWrap = useStore((s) => s.setCalWrap);
  const openComposer = useStore((s) => s.openComposer);

  const visible = useMemo(
    () => tasksForView({ kind: "calendar" }, { lists, sections, tasks, hidden: hiddenLists(settings), lingering }, showCompleted),
    [lists, sections, tasks, settings, showCompleted, lingering],
  );

  // The month the grid mostly shows: the one its middle day falls in.
  const titleKey = mode === "month" ? addDays(top, 20) : mode === "multiweek" ? addDays(mwTop, Math.floor((weeks * 7) / 2)) : addDays(start, Math.floor((n - 1) / 2));
  const titleMonth = titleKey.slice(0, 7);
  const [ty, tm] = titleKey.split("-").map(Number);
  const step = (dir: number) => {
    if (mode === "month") setTop(startOfWeek(addMonths(`${titleMonth}-01`, dir)));
    else if (mode === "multiweek") setMwTop(addDays(mwTop, dir * weeks * 7));
    else if (mode === "days") setDayStart(addDays(dayStart, dir * n));
    else setWeekStart(addDays(weekStart, dir * 7));
  };
  const goToday = () => {
    setTop(startOfWeek(startOfMonth(today)));
    setMwTop(startOfWeek(today));
    setWeekStart(startOfWeek(today));
    setDayStart(today);
  };
  useEffect(() => {
    if (todayTick) goToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayTick]);
  // A day from a widget: every mode shows it (the phone's month opens it under its week).
  const jump = useStore((s) => s.calJump);
  useEffect(() => {
    if (!jump || jump.tick <= takenJump) return;
    takenJump = jump.tick;
    setTop(startOfWeek(startOfMonth(jump.day)));
    setMwTop(startOfWeek(jump.day));
    setWeekStart(startOfWeek(jump.day));
    setDayStart(jump.day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.tick]);
  const onExpand = (day: string, anchor: Anchor) => setExpanded({ day, anchor });
  // Phones scroll the month views; the week and multi-day views page by swiping.
  const phoneMonth = isMobile && mode !== "week" && mode !== "days";
  const swipe = useSwipe(step, false);
  const [todaySignal, setTodaySignal] = useState(0);
  const [phoneTitle, setPhoneTitle] = useState(today.slice(0, 7));

  return (
    <div className="calendar" {...(phoneMonth ? {} : swipe)}>
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
                {mode === "month" ? "Month" : mode === "multiweek" ? `${weeks} Weeks` : mode === "days" ? (calDays === 1 ? "Day" : `${calDays} Days`) : "Week"}
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
                <div className={`menu-item multiweek-item ${mode === "days" ? "is-active" : ""}`}>
                  <button type="button" className="menu-label mw-label" onClick={() => { setMode("days"); close(); }}>
                    Multi-Day
                  </button>
                  <span className="mw-stepper">
                    <button type="button" aria-label="Fewer days" disabled={calDays <= 1} onClick={() => { setCalDays(calDays - 1); setMode("days"); }}>−</button>
                    <b>{calDays}</b>
                    <button type="button" aria-label="More days" disabled={calDays >= 6} onClick={() => { setCalDays(calDays + 1); setMode("days"); }}>+</button>
                  </span>
                </div>
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
                if (isMobile) haptic("light");
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
                <MenuItem active={calWrap} onClick={() => { setCalWrap(!calWrap); close(); }}>
                  <Icon name="lines" size={15} /> Wrap Titles in Week View
                </MenuItem>
              </div>
            )}
          </Popover>
        </div>
      </header>
      {phoneMonth ? (
        <PhoneMonth rows={mode === "month" ? 5 : weeks} tasks={visible} todaySignal={todaySignal + todayTick} jump={jump} onMonth={setPhoneTitle} />
      ) : mode === "month" ? (
        <MonthView top={top} tasks={visible} titleMonth={titleMonth} onShift={(w) => setTop((t) => addDays(t, w * 7))} onExpand={onExpand} />
      ) : mode === "multiweek" ? (
        <MonthView top={mwTop} rows={weeks} tasks={visible} titleMonth="" onShift={(w) => setMwTop((t) => addDays(t, w * 7))} onExpand={onExpand} />
      ) : (
        <WeekView key={mode} start={start} n={n} tasks={visible} onShift={(d) => (mode === "days" ? setDayStart : setWeekStart)((s) => addDays(s, d))} onExpand={onExpand} />
      )}
      {expanded && (
        <FloatingPanel anchor={expanded.anchor} onClose={() => setExpanded(null)} className="day-sheet">
          <header>
            {MONTHS_LONG[+expanded.day.slice(5, 7) - 1]} {+expanded.day.slice(8)}
          </header>
          {entriesForDay(withRepeats(visible, expanded.day, expanded.day), expanded.day).map((e) => (
            <Chip key={`${e.task.id}:${e.kind}`} entry={e} />
          ))}
        </FloatingPanel>
      )}
    </div>
  );
}

/** Memoised: App re-renders for the sheet, the drawer, the quick add and the keyboard; the calendar under them need not. */
export const CalendarView = memo(CalendarViewImpl);
