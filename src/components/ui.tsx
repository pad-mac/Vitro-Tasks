import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Anchor } from "../store";
import {
  MONTHS_LONG,
  WEEKDAYS,
  addDays,
  addMonths,
  deadlineCountdown,
  formatDateTime,
  pad,
  startOfMonth,
  startOfWeek,
  todayKey,
} from "../lib/dates";
import { openExternal } from "../lib/platform";
import { richParts } from "../lib/rich";

// ---------- Icons ----------

// 16px grid, 1.4 stroke.
const PATHS: Record<string, ReactNode> = {
  list: <path d="M3 4.5h10M3 8h10M3 11.5h10" />,
  board: <path d="M3 3h3v10H3zM10 3h3v6h-3z M6.5 3h3v8h-3z" />,
  timeline: <path d="M2.5 4.5h6M6 8h7.5M4 11.5h5" strokeWidth="2" />,
  calendar: <path d="M2.5 4h11v9.5h-11zM2.5 6.8h11M5.5 2.2v3M10.5 2.2v3" />,
  tasks: <path d="M2.5 2.5h11v11h-11zM5 8.2l2.1 2.1L11 6" />,
  plus: <path d="M8 3v10M3 8h10" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  chevron: <path d="M6 4l4 4-4 4" />,
  clock: <path d="M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2zM8 4.8V8l2.2 1.4" />,
  // Hourglass: the hard deadline. Flags belong to priorities.
  deadline: <path d="M4.5 2.3h7M4.5 13.7h7M5.4 2.3v1.9c0 1.5 2.6 2.4 2.6 3.8s-2.6 2.3-2.6 3.8v1.9M10.6 2.3v1.9c0 1.5-2.6 2.4-2.6 3.8s2.6 2.3 2.6 3.8v1.9" />,
  trash: <path d="M3 4.5h10M6.2 4.5V3h3.6v1.5M4.3 4.5l.6 8.5h6.2l.6-8.5" />,
  settings: <path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6M10 3.4v3.2M6 9.4v3.2" />,
  sync: <path d="M13 6.5A5.2 5.2 0 0 0 3.6 5M3 9.5A5.2 5.2 0 0 0 12.4 11M3.2 2.6V5h2.4M12.8 13.4V11h-2.4" />,
  inbox: <path d="M2.5 9l1.6-5.5h7.8L13.5 9v3.5h-11zM2.5 9h3.2l.8 1.5h3l.8-1.5h3.2" />,
  sun: <path d="M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1" />,
  week: <path d="M2.5 3.5h11v9h-11zM5.25 3.5v9M8 3.5v9M10.75 3.5v9" />,
  layers: <path d="M8 2.5L2.5 5.5 8 8.5l5.5-3zM2.5 8.5L8 11.5l5.5-3M2.5 11L8 14l5.5-3" />,
  done: <path d="M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2zM5.5 8.2l1.8 1.8 3.4-3.8" />,
  dots: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth="2.2" />,
  sort: <path d="M4.5 3v10M2.5 11l2 2 2-2M9 4h4.5M9 8h3.2M9 12h2" />,
  pin: <path d="M6 2.5h4l-.6 4 2.1 2.2H4.5l2.1-2.2zM8 8.7v5" />,
  copy: <path d="M5.5 5.5h8v8h-8zM3 10.5h-.5v-8h8V3" />,
  ban: <path d="M2.5 2.5h11v11h-11zM5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" />,
  move: <path d="M2.5 4.5h11v8h-11zM2.5 4.5l1-2h9l1 2M6.5 8.5h4M9 7l1.5 1.5L9 10" />,
  subtask: <path d="M3 3v6.5h4M3 6h4M9 5h4.5v2.5H9zM9 9h4.5v2.5H9z" />,
  edit: <path d="M3 13l.6-2.8 7.2-7.2 2.2 2.2-7.2 7.2zM9.6 4.2l2.2 2.2" />,
  download: <path d="M8 2.5v7.5M5 7.2l3 3 3-3M3 13.2h10" />,
  winmin: <path d="M4 8h8" />,
  winmax: <path d="M4.2 4.2h7.6v7.6H4.2z" />,
  notes: <path d="M3 3.5h10v9H3zM5.2 6.2h5.6M5.2 8.4h5.6M5.2 10.4h3" />,
  window: <path d="M2.5 3.5h11v9h-11zM2.5 6h11M10 8.5h1.8v1.8" />,
  back: <path d="M10 3.5L5.5 8l4.5 4.5" />,
};

// 20px grid with a thin stroke: for icons shown large (menus, toolbar toggles).
const PATHS20: Record<string, ReactNode> = {
  today: (
    <>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2.6v1.5M10 15.9v1.5M2.6 10h1.5M15.9 10h1.5M4.8 4.8l1 1M14.2 14.2l1 1M15.2 4.8l-1 1M5.8 14.2l-1 1" />
    </>
  ),
  tomorrow: <path d="M2.8 15.2h14.4M6 15.2a4 4 0 0 1 8 0M10 3.2v4M8.3 4.9L10 3.2l1.7 1.7M4.4 10.4l1.1.9M15.6 10.4l-1.1.9" />,
  nextweek: (
    <>
      <rect x="3.2" y="4.4" width="13.6" height="12" rx="2.2" />
      <path d="M3.2 7.9h13.6M7 2.9v2.8M13 2.9v2.8M6.6 12.3h2.6M7.9 11v2.6M11.2 10.6h2.6l-1.7 3.8" />
    </>
  ),
  pickdate: (
    <>
      <rect x="3.2" y="4.4" width="13.6" height="12" rx="2.2" />
      <path d="M3.2 7.9h13.6M7 2.9v2.8M13 2.9v2.8" />
      <circle cx="7" cy="11" r=".7" fill="currentColor" stroke="none" />
      <circle cx="10" cy="11" r=".7" fill="currentColor" stroke="none" />
      <circle cx="13" cy="11" r=".7" fill="currentColor" stroke="none" />
      <circle cx="7" cy="13.8" r=".7" fill="currentColor" stroke="none" />
      <circle cx="10" cy="13.8" r=".7" fill="currentColor" stroke="none" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2.2" />
      <path d="M8 4v12" />
    </>
  ),
  editpane: (
    <>
      <rect x="2.8" y="4" width="14.4" height="12" rx="2.2" />
      <path d="M11.6 4v12M13.4 7.4h2M13.4 9.6h2" />
    </>
  ),
  editpopup: (
    <>
      <rect x="2.8" y="4" width="14.4" height="12" rx="2.2" strokeDasharray="2 2.2" />
      <rect x="7" y="7.3" width="7.6" height="5.6" rx="1.4" />
    </>
  ),
};

/** Priority flag: filled in the priority colour, outlined for none. */
export function Flag({ priority, size = 16 }: { priority: number; size?: number }) {
  return (
    <svg className={`icon flag-icon fp${priority}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 14V2.5M4 3h7.5l-1.8 2.6L11.5 8H4" fill={priority ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const big = name in PATHS20;
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox={big ? "0 0 20 20" : "0 0 16 16"}
      fill="none"
      stroke="currentColor"
      strokeWidth={big ? 1.25 : 1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {big ? PATHS20[name] : PATHS[name]}
    </svg>
  );
}

// ---------- Presence (lets things fade out before they unmount) ----------

/**
 * Keeps showing the last non-null value for `ms` after it turns null, and
 * reports that it is closing, so panels can play an exit animation.
 */
export function usePresence<T>(value: T | null, ms = 140): [T | null, boolean] {
  const open = value !== null;
  const last = useRef<T | null>(value);
  const wasOpen = useRef(open);
  const [closing, setClosing] = useState(false);
  if (open) last.current = value;
  // Switch to "closing" in the same render the value disappears, so the
  // panel never unmounts for a frame.
  if (!open && wasOpen.current && !closing && last.current !== null) setClosing(true);
  if (open && closing) setClosing(false);
  wasOpen.current = open;
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => {
      last.current = null;
      setClosing(false);
    }, ms);
    return () => clearTimeout(t);
  }, [closing, ms]);
  if (open) return [value, false];
  return closing ? [last.current, true] : [null, false];
}

// ---------- Popover ----------

/**
 * A button that opens a floating panel. The panel lives at the top of the
 * page (so scrolling containers cannot clip it), opens below the trigger or
 * above it when there is no room, and closes on outside press or Escape.
 */
export function Popover({
  trigger,
  children,
  align = "left",
  className = "",
  title,
  prefer = "below",
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
  title?: string;
  prefer?: "below" | "above";
}) {
  const [open, setOpen] = useState(false);
  const [shown, closing] = usePresence(open ? true : null, 110);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const place = () => {
    const t = ref.current?.getBoundingClientRect();
    const el = panel.current;
    if (!t || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 6;
    const m = 8;
    const below = t.bottom + gap;
    const above = t.top - gap - h;
    const fitsBelow = below + h <= innerHeight - m;
    const fitsAbove = above >= m;
    let top = prefer === "above" ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above;
    top = Math.max(m, Math.min(innerHeight - h - m, top));
    let left = align === "right" ? t.right - w : t.left;
    left = Math.max(m, Math.min(innerWidth - w - m, left));
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  };
  useLayoutEffect(() => {
    if (shown && !closing) place();
  });
  // Content that grows inside the panel (the time columns) moves it back on screen.
  useEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shown]);
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onScroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) place();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", () => setOpen(false), { once: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <div className={`pop ${className}`} ref={ref}>
      <button type="button" className={`pop-trigger ${open ? "is-open" : ""}`} title={title} onClick={() => setOpen(!open)}>
        {trigger}
      </button>
      {shown &&
        createPortal(
          <div
            className={`pop-panel layer ${closing ? "is-closing" : ""}`}
            ref={panel}
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? undefined : "hidden" }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  active,
  danger,
  check = true,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  /** Show a tick for the active item. */
  check?: boolean;
}) {
  return (
    <button type="button" className={`menu-item ${active ? "is-active" : ""} ${danger ? "is-danger" : ""}`} onClick={onClick}>
      <span className="menu-label">{children}</span>
      {active && check && <Icon name="check" size={14} />}
    </button>
  );
}

/** Menu row with an on/off switch that does not close the menu. */
export function ToggleItem({ children, on, onToggle }: { children: ReactNode; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="menu-item" role="switch" aria-checked={on} onClick={onToggle}>
      <span className="menu-label">{children}</span>
      <i className={`switch ${on ? "is-on" : ""}`} />
    </button>
  );
}

// ---------- Checkbox ----------

export function Check({
  done,
  priority,
  onToggle,
  wontDo,
}: {
  done: boolean;
  priority: number;
  onToggle: () => void;
  wontDo?: boolean;
}) {
  return (
    <button
      type="button"
      className={`check p${priority} ${done ? "is-done" : ""}`}
      aria-label={done ? "Mark as open" : "Mark as done"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {done && <Icon name={wontDo ? "x" : "check"} size={11} />}
    </button>
  );
}

// ---------- Links in text ----------

/** Text with clickable URLs and [markdown](links). Clicking a link never selects the task. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {richParts(text).map((p, i) =>
        p.href ? (
          <a
            key={i}
            className="link"
            href={p.href}
            title={p.href}
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void openExternal(p.href!);
            }}
          >
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

// ---------- Date and time picking ----------

export function MiniCalendar({ value, onPick }: { value: string | null; onPick: (key: string) => void }) {
  const today = todayKey();
  const [month, setMonth] = useState(startOfMonth(value ?? today));
  const first = startOfWeek(month);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const [y, m] = month.split("-").map(Number);
  return (
    <div className="mini-cal">
      <div className="mini-cal-head">
        <span className="mini-cal-title">
          {MONTHS_LONG[m - 1]} {y}
        </span>
        <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          <span className="flip"><Icon name="chevron" size={14} /></span>
        </button>
        <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          <Icon name="chevron" size={14} />
        </button>
      </div>
      <div className="mini-cal-grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="mini-cal-dow">{w.slice(0, 2)}</span>
        ))}
        {days.map((d) => (
          <button
            type="button"
            key={d}
            className={`mini-cal-day ${d.slice(0, 7) !== month.slice(0, 7) ? "is-out" : ""} ${d === today ? "is-today" : ""} ${d === value ? "is-selected sheen" : ""}`}
            onClick={() => onPick(d)}
          >
            {+d.slice(8)}
          </button>
        ))}
      </div>
    </div>
  );
}

const MINUTES = [0, 15, 30, 45];

/** Hour and quarter-hour columns, styled like the rest of the app. */
function TimeColumns({ time, onPick }: { time: string | null; onPick: (t: string) => void }) {
  const [h, m] = time ? time.split(":").map(Number) : [null, null];
  const hours = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Start around the chosen hour, or the working morning.
    const el = hours.current;
    if (el) el.scrollTop = Math.max(0, ((h ?? 9) - 2) * 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="time-cols">
      <div className="time-col" ref={hours}>
        {Array.from({ length: 24 }, (_, i) => (
          <button type="button" key={i} className={`time-cell ${i === h ? "is-selected sheen" : ""}`} onClick={() => onPick(`${pad(i)}:${pad(m ?? 0)}`)}>
            {pad(i)}
          </button>
        ))}
      </div>
      <div className="time-col time-col-min">
        {MINUTES.map((x) => (
          <button type="button" key={x} className={`time-cell ${x === m ? "is-selected sheen" : ""}`} onClick={() => onPick(`${pad(h ?? 9)}:${pad(x)}`)}>
            :{pad(x)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Quick picks, month grid and an optional time. Used by the date fields and
 * the right-click menu.
 */
export function DatePickerPanel({
  date,
  time,
  onChange,
  onDone,
}: {
  date: string | null;
  time: string | null;
  onChange: (date: string | null, time: string | null) => void;
  /** Called after a day was picked or the value cleared. */
  onDone: () => void;
}) {
  const today = todayKey();
  const [timeOpen, setTimeOpen] = useState(false);
  const pick = (d: string) => {
    onChange(d, time);
    onDone();
  };
  return (
    <div className="date-pop">
      <div className="quick-picks">
        <button type="button" className="chip-btn" onClick={() => pick(today)}>Today</button>
        <button type="button" className="chip-btn" onClick={() => pick(addDays(today, 1))}>Tomorrow</button>
        <button type="button" className="chip-btn" onClick={() => pick(addDays(today, 7))}>Next week</button>
      </div>
      <MiniCalendar value={date} onPick={pick} />
      <div className="date-pop-foot">
        <button type="button" className={`time-trigger ${time ? "" : "is-empty"} ${timeOpen ? "is-open" : ""}`} onClick={() => setTimeOpen(!timeOpen)}>
          <Icon name="clock" size={14} />
          {time ?? "Add time"}
        </button>
        {time && (
          <button type="button" className="text-btn" title="Remove the time" onClick={() => onChange(date, null)}>
            No time
          </button>
        )}
        <span className="push" />
        <button type="button" className="text-btn" disabled={!date} onClick={() => { onChange(null, null); onDone(); }}>
          Clear
        </button>
      </div>
      {timeOpen && <TimeColumns time={time} onPick={(t) => onChange(date ?? today, t)} />}
    </div>
  );
}

export function DateField({
  date,
  time,
  onChange,
  placeholder,
  tone,
  icon = "calendar",
  align,
  ghost,
  className = "",
}: {
  date: string | null;
  time: string | null;
  onChange: (date: string | null, time: string | null) => void;
  placeholder: string;
  tone?: "signal" | "overdue";
  icon?: string;
  align?: "left" | "right";
  /** Borderless text style, used in the editor header. */
  ghost?: boolean;
  className?: string;
}) {
  const today = todayKey();
  return (
    <Popover
      align={align}
      className={`date-field ${className}`}
      trigger={
        <span className={`date-trigger ${date ? "" : "is-empty"} ${tone ? `tone-${tone}` : ""} ${ghost ? "is-ghost" : ""}`}>
          {icon && <Icon name={icon} size={14} />}
          <span>{date ? formatDateTime(date, time, today) : placeholder}</span>
        </span>
      }
    >
      {(close) => <DatePickerPanel date={date} time={time} onChange={onChange} onDone={close} />}
    </Popover>
  );
}

/**
 * The hard deadline in an editor header: just the hourglass while unset; the
 * date and the days left in the signal colour once set.
 */
export function DeadlineField({
  date,
  time,
  open = true,
  onChange,
}: {
  date: string | null;
  time: string | null;
  /** The task is still open (shows the countdown). */
  open?: boolean;
  onChange: (date: string | null, time: string | null) => void;
}) {
  const today = todayKey();
  const over = open && date !== null && date < today;
  return (
    <Popover
      align="right"
      className="deadline-field"
      title={date ? `Deadline ${formatDateTime(date, time, today)}` : "Add deadline"}
      trigger={
        date ? (
          <span className={`dl-trigger ${over ? "is-over" : ""}`}>
            <Icon name="deadline" size={14} />
            <span>{formatDateTime(date, time, today)}</span>
            {open && <em>{deadlineCountdown(date, today)}</em>}
          </span>
        ) : (
          <span className="icon-btn dl-empty">
            <Icon name="deadline" size={16} />
          </span>
        )
      }
    >
      {(close) => (
        <>
          <span className="cm-label dl-label">Deadline</span>
          <DatePickerPanel date={date} time={time} onChange={onChange} onDone={close} />
        </>
      )}
    </Popover>
  );
}

/** Small inline text input that commits on Enter and cancels on Escape or blur. */
export function InlineInput({
  initial = "",
  placeholder,
  onCommit,
  onCancel,
  className = "",
}: {
  initial?: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const v = value.trim();
    if (commit && v) onCommit(v);
    else onCancel();
  };
  return (
    <input
      autoFocus
      className={`inline-input ${className}`}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") {
          e.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}

// ---------- Floating panel ----------

/**
 * A panel attached to a rectangle on screen (a card, a calendar entry, a
 * right-click position). Opens beside the anchor, flips to the other side when
 * there is no room, and closes on an outside press or Escape. While `closing`
 * it fades out and ignores input.
 */
export function FloatingPanel({
  anchor,
  onClose,
  children,
  className = "",
  placement = "side",
  closing = false,
}: {
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  placement?: "side" | "below";
  closing?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const place = () => {
    const el = ref.current;
    if (!el || closing) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 8;
    let left: number;
    let top: number;
    if (placement === "below") {
      left = anchor.x;
      top = anchor.y + anchor.h;
      if (top + h > innerHeight - gap) top = Math.max(gap, anchor.y - h);
    } else {
      left = anchor.x + anchor.w + gap;
      if (left + w > innerWidth - gap) left = anchor.x - w - gap;
      if (left < gap) left = Math.max(gap, Math.min(innerWidth - w - gap, anchor.x));
      top = anchor.y - 12;
    }
    left = Math.max(gap, Math.min(innerWidth - w - gap, left));
    top = Math.max(gap, Math.min(innerHeight - h - gap, top));
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  };
  useLayoutEffect(place);
  useEffect(() => {
    const el = ref.current;
    if (!el || closing) return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing, anchor.x, anchor.y]);
  useEffect(() => {
    if (closing) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // Presses inside another floating layer (a menu opened from here) don't close this one.
      if (!ref.current?.contains(t) && !t.closest(".floating, .layer")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, closing]);
  return (
    <div
      ref={ref}
      className={`floating ${className} ${closing ? "is-closing" : ""}`}
      // Transparent, not hidden, for the first frame so fields inside can take focus.
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, opacity: pos ? undefined : 0 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}
