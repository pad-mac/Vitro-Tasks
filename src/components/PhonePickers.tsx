// Touch pickers for the phone's add sheet (date with start and end, deadline,
// priority), and the pull gesture for sheets.
import { useEffect, useRef, useState, type RefObject } from "react";
import { addDays, todayKey } from "../lib/dates";
import { haptic } from "../lib/platform";
import { PRIORITY_LABELS } from "../lib/views";
import { describeRepeat } from "../lib/repeat";
import { RepeatPanel, dateForRule } from "./RepeatPicker";
import { Flag, Icon, MiniCalendar } from "./ui";

// ---------- Sheet gesture ----------

/**
 * Dragging a sheet by its top or its content: up to full screen, down to half
 * or closed. Native listeners, so a drag can stop the content from scrolling
 * along (React's touch handlers are passive).
 */
export function useSheetGesture(
  ref: RefObject<HTMLElement | null>,
  opts: { enabled: boolean; full: boolean; onFull: () => void; onHalf: () => void; onClose: () => void },
) {
  const [drag, setDrag] = useState(0);
  const o = useRef(opts);
  o.current = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el || !opts.enabled) return;
    let g: { x: number; y: number; lastY: number; lastT: number; v: number; active: boolean; scroller: HTMLElement | null } | null = null;
    const start = (e: TouchEvent) => {
      const t = e.target as HTMLElement;
      g = null;
      if (e.touches.length !== 1) return;
      // The quick add's line can be pulled too (a tap still puts the caret there).
      if (t.closest("textarea, [contenteditable='true'], .p-lists, .floating, .pop-panel")) return;
      if (t.closest("input") && !t.closest(".m-add-row")) return;
      const top = !!t.closest(".p-sheet-top");
      const scroller = t.closest<HTMLElement>(".p-scroll");
      // Full screen: only the top, or a pull down from the top of the content.
      if (o.current.full && !top && scroller && scroller.scrollTop > 0) return;
      g = { x: e.touches[0].clientX, y: e.touches[0].clientY, lastY: e.touches[0].clientY, lastT: Date.now(), v: 0, active: false, scroller };
    };
    const move = (e: TouchEvent) => {
      if (!g) return;
      const t = e.touches[0];
      const dy = t.clientY - g.y;
      if (!g.active) {
        if (Math.abs(dy) < 8) return;
        if (Math.abs(t.clientX - g.x) > Math.abs(dy)) return void (g = null);
        // Full screen: pushing up scrolls the content.
        if (o.current.full && dy < 0) return void (g = null);
        g.active = true;
      }
      e.preventDefault();
      const now = Date.now();
      g.v = (t.clientY - g.lastY) / Math.max(1, now - g.lastT);
      g.lastY = t.clientY;
      g.lastT = now;
      setDrag(o.current.full ? Math.max(0, dy) : dy < 0 ? dy * 0.5 : dy);
    };
    const end = () => {
      const cur = g;
      g = null;
      if (!cur?.active) return;
      const dy = cur.lastY - cur.y;
      setDrag(0);
      if (!o.current.full && (dy < -40 || cur.v < -0.45)) {
        o.current.onFull();
        haptic("light");
      } else if (o.current.full && (dy > 90 || cur.v > 0.6)) o.current.onHalf();
      else if (!o.current.full && (dy > 80 || cur.v > 0.6)) o.current.onClose();
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [ref, opts.enabled]);
  return drag;
}

// ---------- Pickers ----------

type DayPick = [label: string, day: string];

/** Quick picks, a month and a time (the system's time wheel). */
export function DayPicker({
  date,
  time,
  onChange,
  min,
  range,
  picks,
  clearLabel = "Remove date",
  repeat,
  onRepeat,
}: {
  date: string | null;
  time: string | null;
  onChange: (date: string | null, time: string | null) => void;
  min?: string | null;
  range?: [string, string] | null;
  picks?: DayPick[];
  clearLabel?: string;
  /** With `onRepeat`: a Repeat row under the time (the date it gets when the rule needs one comes along). */
  repeat?: string | null;
  onRepeat?: (repeat: string | null, date: string | null) => void;
}) {
  const today = todayKey();
  const [repeatOpen, setRepeatOpen] = useState(false);
  const quick: DayPick[] = picks ?? [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["Next week", addDays(today, 7)],
  ];
  return (
    <>
      <div className="p-quick">
        {quick.map(([label, d]) => (
          <button type="button" key={label} className={`p-chip ${d === date ? "is-on" : ""}`} disabled={!!min && d < min} onClick={() => onChange(d, time)}>
            {label}
          </button>
        ))}
      </div>
      <MiniCalendar key={(date ?? min ?? today).slice(0, 7)} value={date} onPick={(d) => onChange(d, time)} min={min} range={range} />
      <label className="p-time">
        <Icon name="clock" size={17} />
        <span>Time</span>
        <input type="time" value={time ?? ""} onChange={(e) => onChange(date ?? min ?? today, e.target.value || null)} />
        {time && (
          <button type="button" className="p-time-clear" aria-label="No time" onClick={(e) => { e.preventDefault(); onChange(date, null); }}>
            <Icon name="x" size={13} />
          </button>
        )}
      </label>
      {onRepeat && (
        <>
          <button type="button" className={`p-repeat ${repeatOpen ? "is-open" : ""}`} onClick={() => setRepeatOpen((o) => !o)}>
            <Icon name="repeat" size={17} />
            <span>Repeat</span>
            <em>{repeat ? describeRepeat(repeat, date) : "Never"}</em>
            <Icon name="chevron" size={14} />
          </button>
          {repeatOpen && (
            <RepeatPanel side="below" value={repeat ?? null} base={date ?? today} onChange={(r) => onRepeat(r, dateForRule(r, date))} onClose={() => setRepeatOpen(false)} />
          )}
        </>
      )}
      {date && (
        <button type="button" className="p-clear" onClick={() => onChange(null, null)}>
          {clearLabel}
        </button>
      )}
    </>
  );
}

export interface PropValues {
  start_date?: string | null;
  start_time?: string | null;
  end_date?: string | null;
  end_time?: string | null;
  deadline_date?: string | null;
  deadline_time?: string | null;
  priority?: number;
  list_id?: string | null;
  section_id?: string | null;
  repeat?: string | null;
}

/** Start and end of a task: a Start / End switch over one picker. */
export function SpanPicker({ v, onChange }: { v: PropValues; onChange: (patch: PropValues) => void }) {
  const [edge, setEdge] = useState<"start" | "end">("start");
  const start = v.start_date ?? null;
  const end = v.end_date ?? null;
  const atEnd = edge === "end" && !!start;
  const setStart = (d: string | null, t: string | null) =>
    onChange({
      start_date: d,
      start_time: d ? t : null,
      ...(d && end && end >= d ? {} : { end_date: null, end_time: null }),
      // No date, no series.
      ...(d ? {} : { repeat: null }),
    });
  const setEnd = (d: string | null, t: string | null) => {
    if (!start) return;
    const ok = d !== null && d >= start;
    onChange({ end_date: ok && d > start ? d : null, end_time: ok ? t : null });
  };
  return (
    <>
      {start && (
        <div className="p-seg">
          <button type="button" className={!atEnd ? "is-on" : ""} onClick={() => setEdge("start")}>
            Start
          </button>
          <button type="button" className={atEnd ? "is-on" : ""} onClick={() => setEdge("end")}>
            End
          </button>
        </div>
      )}
      {atEnd ? (
        <DayPicker
          date={end ?? (v.end_time ? start : null)}
          time={v.end_time ?? null}
          min={start}
          range={end ? [start!, end] : null}
          picks={[
            ["+1 day", addDays(start!, 1)],
            ["+2 days", addDays(start!, 2)],
            ["+1 week", addDays(start!, 7)],
          ]}
          onChange={setEnd}
          clearLabel="Remove end"
        />
      ) : (
        <DayPicker
          date={start}
          time={v.start_time ?? null}
          range={start && end ? [start, end] : null}
          onChange={setStart}
          repeat={v.repeat ?? null}
          onRepeat={(r, d) => onChange({ repeat: r, ...(d !== start ? { start_date: d, ...(d && end && end >= d ? {} : { end_date: null, end_time: null }) } : {}) })}
        />
      )}
    </>
  );
}

export function PriorityChoice({ value, onPick }: { value: number; onPick: (p: number) => void }) {
  return (
    <div className="p-prio">
      {[3, 2, 1, 0].map((p) => (
        <button type="button" key={p} className={`p-prio-btn ${p === value ? "is-on" : ""}`} onClick={() => onPick(p)}>
          <Flag priority={p} size={20} />
          <span>{PRIORITY_LABELS[p]}</span>
        </button>
      ))}
    </div>
  );
}
