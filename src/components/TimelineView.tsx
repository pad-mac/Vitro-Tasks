import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { MONTHS_LONG, addDays, diffDays, fromKey, isWeekend, startOfWeek, todayKey } from "../lib/dates";
import type { Group, ViewRef } from "../lib/views";
import type { Task } from "../shared/schema";
import { useStore } from "../store";
import { DRAG_TYPE, dragProps } from "./tasks";
import { Icon } from "./ui";

type Zoom = "day" | "week" | "month";
const DAY_W: Record<Zoom, number> = { day: 44, week: 18, month: 6 };
const LEAD: Record<Zoom, number> = { day: 21, week: 56, month: 120 };
const SPAN: Record<Zoom, number> = { day: 140, week: 400, month: 800 };
const LABEL_W = 168;
const LANE_H = 30;
const ROW_PAD = 8;

interface Item {
  task: Task;
  /** Day offsets from range start; null when that part is absent. */
  s: number | null;
  e: number | null;
  d: number | null;
  lane: number;
}

type DragMode = "move" | "resize" | "deadline";
interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  dd: number;
  moved: boolean;
}

function layout(tasks: Task[], rangeStart: string, dayW: number): { items: Item[]; lanes: number } {
  const laneEnds: number[] = [];
  const items: Item[] = [];
  const dated = tasks
    .filter((t) => t.start_date || t.deadline_date)
    .sort((a, b) => ((a.start_date ?? a.deadline_date)! < (b.start_date ?? b.deadline_date)! ? -1 : 1));
  for (const task of dated) {
    const s = task.start_date ? diffDays(rangeStart, task.start_date) : null;
    const e = task.start_date ? diffDays(rangeStart, task.end_date && task.end_date >= task.start_date ? task.end_date : task.start_date) : null;
    const d = task.deadline_date ? diffDays(rangeStart, task.deadline_date) : null;
    const first = Math.min(s ?? Infinity, d ?? Infinity);
    const last = Math.max(e ?? -Infinity, d ?? -Infinity);
    const x0 = first * dayW;
    // Short bars carry their title to the right, so reserve room for it.
    const barW = s === null || e === null ? 0 : (e - s + 1) * dayW;
    const titleW = Math.min(280, task.title.length * 6.6 + 16);
    const x1 = (last + 1) * dayW + (barW >= titleW ? 0 : titleW) + 10;
    let lane = laneEnds.findIndex((end) => end <= x0);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = x1;
    items.push({ task, s, e, d, lane });
  }
  return { items, lanes: Math.max(1, laneEnds.length) };
}

export function TimelineView({ view, groups, sectioned }: { view: ViewRef; groups: Group[]; sectioned: boolean }) {
  const today = todayKey();
  const [zoom, setZoom] = useState<Zoom>("day");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const lists = useStore((s) => s.lists);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const updateTask = useStore((s) => s.updateTask);
  const dayW = DAY_W[zoom];

  const all = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);
  const { rangeStart, days } = useMemo(() => {
    let start = addDays(today, -LEAD[zoom]);
    let end = addDays(today, SPAN[zoom] - LEAD[zoom]);
    const floor = addDays(today, -730);
    const ceil = addDays(today, 1460);
    for (const t of all) {
      for (const k of [t.start_date, t.end_date, t.deadline_date]) {
        if (!k) continue;
        if (k < start && k >= floor) start = addDays(k, -7);
        if (k > end && k <= ceil) end = addDays(k, 14);
      }
    }
    start = startOfWeek(start);
    return { rangeStart: start, days: diffDays(start, end) + 1 };
  }, [all, zoom, today]);

  const todayX = diffDays(rangeStart, today) * dayW;
  const scrollToToday = (smooth: boolean) => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: Math.max(0, todayX - Math.min(240, el.clientWidth / 3)), behavior: smooth ? "smooth" : "auto" });
  };
  useLayoutEffect(() => scrollToToday(false), [zoom, rangeStart, view.kind === "list" ? view.id : view.kind]);

  // Header cells: months on top, then days (day zoom) or week starts.
  const header = useMemo(() => {
    const months: { label: string; x: number; w: number }[] = [];
    const ticks: { label: string; sub?: string; x: number; key: string; weekend: boolean; today: boolean }[] = [];
    for (let i = 0; i < days; i++) {
      const key = addDays(rangeStart, i);
      const d = fromKey(key);
      if (i === 0 || d.getDate() === 1) {
        months.push({ label: `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`, x: i * dayW, w: 0 });
      }
      months[months.length - 1].w += dayW;
      const monday = d.getDay() === 1;
      if (zoom === "day" || (zoom === "week" && monday) || (zoom === "month" && d.getDate() === 1)) {
        ticks.push({
          key,
          x: i * dayW,
          label: zoom === "month" ? "" : String(d.getDate()),
          sub: zoom === "day" ? "MTWTFSS"[(d.getDay() + 6) % 7] : undefined,
          weekend: isWeekend(key),
          today: key === today,
        });
      }
    }
    return { months, ticks };
  }, [rangeStart, days, dayW, zoom, today]);

  const weekends = useMemo(() => {
    if (zoom === "month") return [];
    const out: number[] = [];
    for (let i = 0; i < days; i++) if (fromKey(addDays(rangeStart, i)).getDay() === 6) out.push(i * dayW);
    return out;
  }, [rangeStart, days, dayW, zoom]);

  const begin = (e: RPointerEvent, id: string, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, mode, startX: e.clientX, dd: 0, moved: false });
  };
  const move = (e: RPointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    setDrag({ ...drag, dd: Math.round(dx / dayW), moved: drag.moved || Math.abs(dx) > 3 });
  };
  const end = (task: Task) => {
    if (!drag) return;
    const { dd, mode, moved } = drag;
    setDrag(null);
    if (!moved) return select(task.id);
    if (!dd) return;
    if (mode === "deadline" && task.deadline_date) {
      void updateTask(task.id, { deadline_date: addDays(task.deadline_date, dd) });
    } else if (mode === "move" && task.start_date) {
      void updateTask(task.id, {
        start_date: addDays(task.start_date, dd),
        end_date: task.end_date ? addDays(task.end_date, dd) : null,
      });
    } else if (mode === "resize" && task.start_date) {
      const next = addDays(task.end_date ?? task.start_date, dd);
      void updateTask(task.id, { end_date: next > task.start_date ? next : null });
    }
  };

  // Escape cancels a drag in progress.
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrag(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag]);

  const unscheduled = all.filter((t) => !t.start_date && !t.deadline_date);
  const width = days * dayW;

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <div className="segmented">
          {(["day", "week", "month"] as Zoom[]).map((z) => (
            <button type="button" key={z} className={zoom === z ? "is-active" : ""} onClick={() => setZoom(z)}>
              {z[0].toUpperCase() + z.slice(1)}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => scrollToToday(true)}>
          Today
        </button>
        <span className="tl-legend">
          <i className="legend-bar" /> planned
          <i className="legend-deadline" /> deadline
        </span>
      </div>
      <div
        className="tl-scroll"
        ref={scroller}
        onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(DRAG_TYPE);
          const el = scroller.current;
          if (!id || !el) return;
          e.preventDefault();
          const x = e.clientX - el.getBoundingClientRect().left + el.scrollLeft - LABEL_W;
          if (x >= 0) void updateTask(id, { start_date: addDays(rangeStart, Math.floor(x / dayW)) });
        }}
      >
        <div className="tl-canvas" style={{ width: width + LABEL_W }}>
          <div className="tl-head">
            <div className="tl-corner" style={{ width: LABEL_W }} />
            <div className="tl-head-track" style={{ width }}>
              {header.months.map((m) => (
                <span key={m.x} className="tl-month" style={{ left: m.x, width: m.w }}>
                  <b>{m.label}</b>
                </span>
              ))}
              {header.ticks.map((t) => (
                <span
                  key={t.key}
                  className={`tl-tick mono ${t.weekend && zoom === "day" ? "is-weekend" : ""} ${t.today ? "is-today" : ""}`}
                  style={{ left: t.x, width: zoom === "day" ? dayW : undefined }}
                >
                  {t.sub && <i>{t.sub}</i>}
                  {t.label}
                </span>
              ))}
            </div>
          </div>
          <div className="tl-body">
            <div className="tl-grid" style={{ left: LABEL_W, width }}>
              {weekends.map((x) => (
                <i key={x} className="tl-weekend" style={{ left: x, width: dayW * 2 }} />
              ))}
              {zoom !== "day" && header.ticks.map((t) => <i key={t.key} className="tl-line" style={{ left: t.x }} />)}
              <i className="tl-today" style={{ left: todayX + dayW / 2 }} />
            </div>
            {groups.map((g) => {
              const { items, lanes } = layout(g.tasks, rangeStart, dayW);
              const closed = collapsed[g.key];
              // Rows without anything dated only matter as section lanes.
              if (!items.length && !sectioned) return null;
              return (
                <div key={g.key} className="tl-row" style={{ height: closed ? 34 : lanes * LANE_H + ROW_PAD * 2 }}>
                  <div className="tl-row-label" style={{ width: LABEL_W }}>
                    <button
                      type="button"
                      className={`twist ${closed ? "" : "is-open"}`}
                      onClick={() => setCollapsed({ ...collapsed, [g.key]: !closed })}
                      aria-label="Collapse row"
                    >
                      <Icon name="chevron" size={12} />
                    </button>
                    <span className="group-label">{g.label || "Tasks"}</span>
                    <span className="count mono">{items.length}</span>
                  </div>
                  <div className="tl-track" style={{ width }}>
                    {!closed &&
                      items.map((it) => {
                        const active = drag?.id === it.task.id ? drag : null;
                        const dMove = active?.mode === "move" ? active.dd : 0;
                        const dSize = active?.mode === "resize" ? active.dd : 0;
                        const dDead = active?.mode === "deadline" ? active.dd : 0;
                        const s = it.s === null ? null : it.s + dMove;
                        const e = it.e === null || s === null ? null : Math.max(s, it.e + dMove + dSize);
                        const d = it.d === null ? null : it.d + dDead;
                        const color = lists.find((l) => l.id === it.task.list_id)?.color ?? "var(--muted)";
                        const top = ROW_PAD + it.lane * LANE_H;
                        const barW = s === null || e === null ? 0 : (e - s + 1) * dayW - 2;
                        const titleW = it.task.title.length * 6.6 + 16;
                        const inside = barW >= titleW;
                        const lastDay = Math.max(e ?? -Infinity, d ?? -Infinity);
                        const titleX = inside && s !== null ? s * dayW + 8 : (lastDay + 1) * dayW + 4;
                        const overdue = it.task.status === 0 && it.task.deadline_date !== null && it.task.deadline_date < today;
                        return (
                          <div key={it.task.id} className={`tl-item ${selectedId === it.task.id ? "is-selected" : ""} ${it.task.status ? "is-done" : ""} ${active ? "is-dragging" : ""}`} style={{ top }}>
                            {s !== null && e !== null && d !== null && d > e && (
                              <i className="tl-link" style={{ left: (e + 1) * dayW, width: (d - e - 1) * dayW + dayW / 2 }} />
                            )}
                            {s !== null && e !== null && (
                              <div
                                className="tl-bar"
                                style={{ left: s * dayW + 1, width: barW, ["--c" as string]: color }}
                                onPointerDown={(ev) => begin(ev, it.task.id, "move")}
                                onPointerMove={move}
                                onPointerUp={() => end(it.task)}
                                title={it.task.title}
                              >
                                <span
                                  className="tl-resize"
                                  onPointerDown={(ev) => begin(ev, it.task.id, "resize")}
                                  onPointerMove={move}
                                  onPointerUp={() => end(it.task)}
                                />
                              </div>
                            )}
                            {d !== null && (
                              <span
                                className={`tl-deadline ${overdue ? "is-over" : ""}`}
                                style={{ left: d * dayW + dayW / 2 }}
                                title={`Deadline ${it.task.deadline_date}`}
                                onPointerDown={(ev) => begin(ev, it.task.id, "deadline")}
                                onPointerMove={move}
                                onPointerUp={() => end(it.task)}
                              />
                            )}
                            <span
                              className={`tl-title ${inside ? "is-inside" : ""}`}
                              style={{ left: titleX }}
                              onClick={() => select(it.task.id)}
                            >
                              {it.task.title}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              );
            })}
            <div className="tl-row tl-fill">
              <div className="tl-row-label" style={{ width: LABEL_W }} />
            </div>
          </div>
        </div>
      </div>
      {unscheduled.length > 0 && (
        <div className="tl-unscheduled">
          <span className="micro">Unscheduled · {unscheduled.length} · drag onto the timeline</span>
          <div className="tl-chips">
            {unscheduled.map((t) => (
              <span key={t.id} className={`tl-chip ${selectedId === t.id ? "is-selected" : ""}`} onClick={() => select(t.id)} {...dragProps(t.id)}>
                {t.title}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
