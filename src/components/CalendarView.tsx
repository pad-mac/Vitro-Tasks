import { useEffect, useMemo, useRef, useState } from "react";
import {
  MONTHS_LONG,
  WEEKDAYS,
  addDays,
  addMonths,
  diffDays,
  isWeekend,
  minutesOf,
  startOfMonth,
  startOfWeek,
  todayKey,
} from "../lib/dates";
import { entriesForDay, tasksForView, type DayEntry } from "../lib/views";
import { useStore } from "../store";
import { dragProps, useCreateTask, useDropTarget } from "./tasks";
import { Icon, InlineInput } from "./ui";

type Mode = "month" | "week";
const HOUR_H = 44;
const MAX_CHIPS = 4;

function useMoveEntry() {
  const tasks = useStore((s) => s.tasks);
  const updateTask = useStore((s) => s.updateTask);
  /** Moves the planned span or the deadline to another day. */
  return (taskId: string, kind: string, day: string) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (kind === "deadline") return void updateTask(taskId, { deadline_date: day });
    const shift = t.start_date ? diffDays(t.start_date, day) : 0;
    void updateTask(taskId, {
      start_date: day,
      end_date: t.end_date && t.start_date ? addDays(t.end_date, shift) : null,
    });
  };
}

function Chip({ entry, day, timed }: { entry: DayEntry; day: string; timed?: boolean }) {
  const lists = useStore((s) => s.lists);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const { task, kind } = entry;
  const color = lists.find((l) => l.id === task.list_id)?.color ?? "var(--muted)";
  const time = kind === "planned" ? task.start_time : task.deadline_time;
  const spanEnd = task.end_date && task.start_date && task.end_date > task.start_date ? task.end_date : null;
  const cls = [
    "cal-chip",
    kind === "deadline" ? "is-deadline" : "",
    task.status ? "is-done" : "",
    selectedId === task.id ? "is-selected" : "",
    kind === "planned" && spanEnd && day > task.start_date! ? "cont-left" : "",
    kind === "planned" && spanEnd && day < spanEnd ? "cont-right" : "",
    startOfWeek(day) === day ? "week-start" : "",
  ].join(" ");
  return (
    <div
      className={cls}
      style={{ ["--c" as string]: color }}
      title={`${kind === "deadline" ? "Deadline: " : ""}${task.title}`}
      onClick={(e) => {
        e.stopPropagation();
        select(task.id);
      }}
      {...dragProps(task.id, kind)}
    >
      {kind === "deadline" && <Icon name="flag" size={11} />}
      <span className="cal-chip-title">{task.title}</span>
      {time && !timed && <span className="cal-chip-time mono">{time}</span>}
    </div>
  );
}

function DayCell({
  day,
  entries,
  outside,
  onAdd,
  adding,
  onExpand,
}: {
  day: string;
  entries: DayEntry[];
  outside: boolean;
  onAdd: (day: string | null) => void;
  adding: boolean;
  onExpand: (day: string) => void;
}) {
  const today = todayKey();
  const moveEntry = useMoveEntry();
  const create = useCreateTask();
  const drop = useDropTarget((id, kind) => moveEntry(id, kind, day));
  const shown = entries.slice(0, adding ? MAX_CHIPS - 1 : MAX_CHIPS);
  return (
    <div
      className={`cal-cell ${outside ? "is-out" : ""} ${isWeekend(day) ? "is-weekend" : ""} ${drop.over ? "is-drop" : ""}`}
      onClick={() => onAdd(day)}
      {...drop.props}
    >
      <span className={`cal-daynum mono ${day === today ? "is-today" : ""}`}>
        {+day.slice(8) === 1 ? `${MONTHS_LONG[+day.slice(5, 7) - 1].slice(0, 3)} 1` : +day.slice(8)}
      </span>
      {shown.map((e) => (
        <Chip key={`${e.task.id}:${e.kind}`} entry={e} day={day} />
      ))}
      {adding && (
        <div onClick={(e) => e.stopPropagation()}>
          <InlineInput
            className="cal-input"
            placeholder="New task"
            onCommit={(v) => {
              void create(v, { start_date: day });
              onAdd(null);
            }}
            onCancel={() => onAdd(null)}
          />
        </div>
      )}
      {entries.length > shown.length && (
        <button
          type="button"
          className="cal-more mono"
          onClick={(e) => {
            e.stopPropagation();
            onExpand(day);
          }}
        >
          +{entries.length - shown.length}
        </button>
      )}
    </div>
  );
}

function WeekGrid({ start, byDay, onAdd, adding }: {
  start: string;
  byDay: (day: string) => DayEntry[];
  onAdd: (day: string | null) => void;
  adding: string | null;
}) {
  const today = todayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const scroller = useRef<HTMLDivElement>(null);
  const create = useCreateTask();
  const moveEntry = useMoveEntry();
  const updateTask = useStore((s) => s.updateTask);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 7 * HOUR_H });
  }, [start]);
  const now = new Date();
  const nowY = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_H;
  return (
    <div className="week">
      <div className="week-head">
        <span className="week-gutter" />
        {days.map((d, i) => (
          <span key={d} className={`week-day ${d === today ? "is-today" : ""}`}>
            <i>{WEEKDAYS[i]}</i>
            <b className="mono">{+d.slice(8)}</b>
          </span>
        ))}
      </div>
      <div className="week-allday">
        <span className="week-gutter micro">all day</span>
        {days.map((d) => (
          <AllDayCell key={d} day={d} entries={byDay(d).filter((e) => !(e.kind === "planned" ? e.task.start_time : e.task.deadline_time))} onAdd={onAdd} adding={adding === d} />
        ))}
      </div>
      <div className="week-scroll" ref={scroller}>
        <div className="week-grid" style={{ height: 24 * HOUR_H }}>
          <div className="week-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="week-hour mono" style={{ top: h * HOUR_H }}>
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const timed = byDay(d).filter((e) => (e.kind === "planned" ? e.task.start_time : e.task.deadline_time));
            return (
              <HourColumn
                key={d}
                day={d}
                weekend={isWeekend(d)}
                onDropAt={(id, kind, minutes) => {
                  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
                  moveEntry(id, kind, d);
                  void updateTask(id, kind === "deadline" ? { deadline_date: d, deadline_time: time } : { start_time: time });
                }}
                onCreateAt={(minutes, title) => {
                  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:00`;
                  void create(title, { start_date: d, start_time: time });
                }}
              >
                {d === today && <i className="week-now" style={{ top: nowY }} />}
                {timed.map((e) => {
                  const t = e.kind === "planned" ? e.task.start_time! : e.task.deadline_time!;
                  const startMin = minutesOf(t);
                  const endMin =
                    e.kind === "planned" && e.task.end_time && (!e.task.end_date || e.task.end_date === e.task.start_date)
                      ? Math.max(minutesOf(e.task.end_time), startMin + 30)
                      : startMin + (e.kind === "deadline" ? 30 : 60);
                  return (
                    <div
                      key={`${e.task.id}:${e.kind}`}
                      className="week-event"
                      style={{ top: (startMin / 60) * HOUR_H, height: ((endMin - startMin) / 60) * HOUR_H - 2 }}
                    >
                      <Chip entry={e} day={d} timed />
                      <span className="week-event-time mono">{t}</span>
                    </div>
                  );
                })}
              </HourColumn>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AllDayCell({ day, entries, onAdd, adding }: { day: string; entries: DayEntry[]; onAdd: (d: string | null) => void; adding: boolean }) {
  const moveEntry = useMoveEntry();
  const updateTask = useStore((s) => s.updateTask);
  const create = useCreateTask();
  const drop = useDropTarget((id, kind) => {
    moveEntry(id, kind, day);
    void updateTask(id, kind === "deadline" ? { deadline_date: day, deadline_time: null } : { start_time: null, end_time: null });
  });
  return (
    <div className={`week-allday-cell ${drop.over ? "is-drop" : ""} ${isWeekend(day) ? "is-weekend" : ""}`} onClick={() => onAdd(day)} {...drop.props}>
      {entries.map((e) => (
        <Chip key={`${e.task.id}:${e.kind}`} entry={e} day={day} />
      ))}
      {adding && (
        <div onClick={(e) => e.stopPropagation()}>
          <InlineInput
            className="cal-input"
            placeholder="New task"
            onCommit={(v) => {
              void create(v, { start_date: day });
              onAdd(null);
            }}
            onCancel={() => onAdd(null)}
          />
        </div>
      )}
    </div>
  );
}

function HourColumn({ day, weekend, children, onDropAt, onCreateAt }: {
  day: string;
  weekend: boolean;
  children: React.ReactNode;
  onDropAt: (id: string, kind: string, minutes: number) => void;
  onCreateAt: (minutes: number, title: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastY = useRef(0);
  const [draft, setDraft] = useState<number | null>(null);
  const drop = useDropTarget((id, kind) => {
    const minutes = Math.max(0, Math.min(23 * 60 + 30, Math.round(((lastY.current / HOUR_H) * 60) / 30) * 30));
    onDropAt(id, kind, minutes);
  });
  const yOf = (clientY: number) => clientY - (ref.current?.getBoundingClientRect().top ?? 0);
  return (
    <div
      ref={ref}
      data-day={day}
      className={`week-col ${weekend ? "is-weekend" : ""} ${drop.over ? "is-drop" : ""}`}
      {...drop.props}
      onDragOver={(e) => {
        lastY.current = yOf(e.clientY);
        drop.props.onDragOver(e);
      }}
      onDoubleClick={(e) => setDraft(Math.floor(yOf(e.clientY) / HOUR_H) * 60)}
    >
      {children}
      {draft !== null && (
        <div className="week-event" style={{ top: (draft / 60) * HOUR_H, height: HOUR_H - 2 }} onDoubleClick={(e) => e.stopPropagation()}>
          <InlineInput
            className="cal-input"
            placeholder="New task"
            onCommit={(v) => {
              onCreateAt(draft, v);
              setDraft(null);
            }}
            onCancel={() => setDraft(null)}
          />
        </div>
      )}
    </div>
  );
}

export function CalendarView() {
  const today = todayKey();
  const [mode, setMode] = useState<Mode>("month");
  const [anchor, setAnchor] = useState(today);
  const [adding, setAdding] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const lists = useStore((s) => s.lists);
  const sections = useStore((s) => s.sections);
  const tasks = useStore((s) => s.tasks);
  const showCompleted = useStore((s) => s.showCompleted);
  const setShowCompleted = useStore((s) => s.setShowCompleted);

  const visible = useMemo(
    () => tasksForView({ kind: "calendar" }, { lists, sections, tasks }, showCompleted),
    [lists, sections, tasks, showCompleted],
  );
  const byDay = useMemo(() => {
    const cache = new Map<string, DayEntry[]>();
    return (day: string) => {
      let v = cache.get(day);
      if (!v) cache.set(day, (v = entriesForDay(visible, day)));
      return v;
    };
  }, [visible]);

  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);
  const weekStart = startOfWeek(anchor);
  const step = (dir: number) => setAnchor(mode === "month" ? addMonths(anchor, dir) : addDays(anchor, dir * 7));
  const titleKey = mode === "month" ? monthStart : addDays(weekStart, 3);
  const [ty, tm] = titleKey.split("-").map(Number);

  useEffect(() => {
    if (!expanded) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(null);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);

  return (
    <div className="calendar">
      <header className="view-head">
        <h1>
          {MONTHS_LONG[tm - 1]} <span className="mono thin">{ty}</span>
        </h1>
        <div className="head-tools">
          <button type="button" className={`btn ${showCompleted ? "is-on" : ""}`} onClick={() => setShowCompleted(!showCompleted)} title="Show completed tasks">
            <Icon name="done" size={14} /> Completed
          </button>
          <div className="segmented">
            <button type="button" className={mode === "month" ? "is-active" : ""} onClick={() => setMode("month")}>Month</button>
            <button type="button" className={mode === "week" ? "is-active" : ""} onClick={() => setMode("week")}>Week</button>
          </div>
          <div className="stepper">
            <button type="button" aria-label="Previous" onClick={() => step(-1)}><span className="flip"><Icon name="chevron" size={14} /></span></button>
            <button type="button" className="stepper-today" onClick={() => setAnchor(today)}>Today</button>
            <button type="button" aria-label="Next" onClick={() => step(1)}><Icon name="chevron" size={14} /></button>
          </div>
        </div>
      </header>
      {mode === "month" ? (
        <div className="month">
          <div className="month-dow">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="month-grid">
            {Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map((d) => (
              <DayCell
                key={d}
                day={d}
                entries={byDay(d)}
                outside={d.slice(0, 7) !== monthStart.slice(0, 7)}
                adding={adding === d}
                onAdd={setAdding}
                onExpand={setExpanded}
              />
            ))}
          </div>
        </div>
      ) : (
        <WeekGrid start={weekStart} byDay={byDay} onAdd={setAdding} adding={adding} />
      )}
      {expanded && (
        <div className="overlay" onClick={() => setExpanded(null)}>
          <div className="day-sheet" onClick={(e) => e.stopPropagation()}>
            <header>
              <b>{MONTHS_LONG[+expanded.slice(5, 7) - 1]} <span className="mono">{+expanded.slice(8)}</span></b>
              <button type="button" className="icon-btn" onClick={() => setExpanded(null)} aria-label="Close"><Icon name="x" size={14} /></button>
            </header>
            {byDay(expanded).map((e) => (
              <Chip key={`${e.task.id}:${e.kind}`} entry={e} day={expanded} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
