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

// 16px grid, 1.4 stroke, round caps and joins, corner radius 1.8 on boxes.
// Every icon is built from straight lines, circles and rounded rectangles so
// the set stays geometric and even.
const PATHS: Record<string, ReactNode> = {
  list: <path d="M3 4.5h10M3 8h10M3 11.5h10" />,
  board: (
    <>
      <rect x="2.5" y="2.5" width="3" height="11" rx="1.2" />
      <rect x="6.5" y="2.5" width="3" height="8" rx="1.2" />
      <rect x="10.5" y="2.5" width="3" height="5.5" rx="1.2" />
    </>
  ),
  timeline: <path d="M2.5 4.5h6M6 8h7.5M4 11.5h5" />,
  calendar: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.8" />
      <path d="M2.5 6.8h11M5.5 2.2v2.6M10.5 2.2v2.6" />
    </>
  ),
  tasks: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.8" />
      <path d="M5.3 8.1l1.9 1.9 3.6-3.9" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  chevron: <path d="M6 4l4 4-4 4" />,
  back: <path d="M10 3.5L5.5 8l4.5 4.5" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 5v3l2 1.3" />
    </>
  ),
  // Target: the hard deadline. Flags belong to priorities.
  deadline: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <circle cx="8" cy="8" r="2.6" />
      <circle cx="8" cy="8" r=".6" fill="currentColor" />
    </>
  ),
  trash: <path d="M3 4.5h10M6.3 4.5V3.3h3.4v1.2M4.4 4.5l.6 8.1a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.6-8.1" />,
  settings: <path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6M10 3.4v3.2M6 9.4v3.2" />,
  sync: <path d="M13 6.5A5.2 5.2 0 0 0 3.6 5M3 9.5A5.2 5.2 0 0 0 12.4 11M3.2 2.6V5h2.4M12.8 13.4V11h-2.4" />,
  inbox: <path d="M2.5 9l1.5-5a.9.9 0 0 1 .9-.6h6.2a.9.9 0 0 1 .9.6l1.5 5v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1zM2.5 9h3l.8 1.5h3.4L10.5 9h3" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="2.7" />
      <path d="M8 1.9v1.3M8 12.8v1.3M1.9 8h1.3M12.8 8h1.3M3.7 3.7l.9.9M11.4 11.4l.9.9M12.3 3.7l-.9.9M4.6 11.4l-.9.9" />
    </>
  ),
  week: (
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.8" />
      <path d="M6.2 3.5v9M9.8 3.5v9" />
    </>
  ),
  layers: <path d="M8 2.5L2.5 5.5 8 8.5l5.5-3zM2.5 8.5L8 11.5l5.5-3M2.5 11L8 14l5.5-3" />,
  done: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M5.6 8.2l1.7 1.7 3.2-3.5" />
    </>
  ),
  dots: (
    <>
      <circle cx="3.5" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  sort: <path d="M4.5 3v10M2.5 11l2 2 2-2M9 4h4.5M9 8h3.2M9 12h2" />,
  pin: <path d="M6 2.5h4l-.5 3.8 2 2.2H4.5l2-2.2zM8 8.5v5" />,
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" />
      <path d="M10.5 3.6v-.1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.1" />
    </>
  ),
  ban: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M4.1 11.9l7.8-7.8" />
    </>
  ),
  move: (
    <>
      <path d="M2.5 5.2a1.3 1.3 0 0 1 1.3-1.3h2.6l1.3 1.4h4.5a1.3 1.3 0 0 1 1.3 1.3v5.1a1.3 1.3 0 0 1-1.3 1.3H3.8a1.3 1.3 0 0 1-1.3-1.3z" />
      <path d="M6.3 9.1h3.4M8.5 7.8l1.3 1.3-1.3 1.3" />
    </>
  ),
  subtask: (
    <>
      <path d="M3.5 3v6.2a1.3 1.3 0 0 0 1.3 1.3H7M3.5 5.5H7" />
      <rect x="8.5" y="4" width="5" height="3" rx="1" />
      <rect x="8.5" y="9" width="5" height="3" rx="1" />
    </>
  ),
  edit: <path d="M3 13l.6-2.8 7.2-7.2 2.2 2.2-7.2 7.2zM9.6 4.2l2.2 2.2" />,
  undo: <path d="M4.5 6.5h6a3 3 0 0 1 0 6H7M6.5 4.5l-2 2 2 2" />,
  expand: <path d="M9.5 3h3.5v3.5M6.5 13H3V9.5M13 3L9 7M3 13l4-4" />,
  arrowup: <path d="M8 13V3.5M4.2 7.3L8 3.5l3.8 3.8" />,
  download: <path d="M8 2.5v7.5M5 7.2l3 3 3-3M3 13.2h10" />,
  upload: <path d="M8 10.5V3M5 5.8l3-3 3 3M3 13.2h10" />,
  winmin: <path d="M4 8h8" />,
  winmax: <rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1" />,
  lines: <path d="M3 4.5h10M3 8h10M3 11.5h6.5" />,
  select: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M5.6 8.1l1.7 1.7 3.1-3.4" />
    </>
  ),
  notes: (
    <>
      <rect x="3" y="2.5" width="10" height="11" rx="1.8" />
      <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
    </>
  ),
  window: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.8" />
      <path d="M2.5 6h11" />
    </>
  ),
};

// 20px grid with a 1.25 stroke: for icons shown larger (menus, toolbar
// toggles). Same corner radius (2.2 here, 1.8 at 16 px) as the 16 px set.
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
      <circle cx="7" cy="11" r=".75" fill="currentColor" stroke="none" />
      <circle cx="10" cy="11" r=".75" fill="currentColor" stroke="none" />
      <circle cx="13" cy="11" r=".75" fill="currentColor" stroke="none" />
      <circle cx="7" cy="13.8" r=".75" fill="currentColor" stroke="none" />
      <circle cx="10" cy="13.8" r=".75" fill="currentColor" stroke="none" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2.2" />
      <path d="M8 4v12" />
    </>
  ),
  // Editing in the side pane: a window with a panel on its right.
  editpane: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2.2" />
      <path d="M12 4v12" />
    </>
  ),
  // Editing in a popup: a window with a card floating inside it.
  editpopup: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2.2" />
      <rect x="7" y="7.5" width="7" height="5" rx="1.2" />
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
let probe: HTMLElement | null = null;
/** The screen's safe-area insets (status bar, home indicator) in pixels. */
export function safeInsets(): { top: number; bottom: number } {
  if (!probe) {
    probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)";
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
}

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
    // Never under the status bar or the home indicator.
    const safe = safeInsets();
    const mt = Math.max(m, safe.top + 6);
    const mb = Math.max(m, safe.bottom);
    const below = t.bottom + gap;
    const above = t.top - gap - h;
    const fitsBelow = below + h <= innerHeight - mb;
    const fitsAbove = above >= mt;
    let top = prefer === "above" ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above;
    top = Math.max(mt, Math.min(innerHeight - h - mb, top));
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

export function MiniCalendar({
  value,
  onPick,
  min,
  range,
}: {
  value: string | null;
  onPick: (key: string) => void;
  /** Days before this cannot be picked (an end date before its start). */
  min?: string | null;
  /** Days of the task's span, tinted. */
  range?: [string, string] | null;
}) {
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
            className={`mini-cal-day ${d.slice(0, 7) !== month.slice(0, 7) ? "is-out" : ""} ${d === today ? "is-today" : ""} ${d === value ? "is-selected pearl" : ""} ${range && d !== value && d >= range[0] && d <= range[1] ? "in-range" : ""}`}
            disabled={!!min && d < min}
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
function TimeColumns({ time, onPick, side }: { time: string | null; onPick: (t: string) => void; side: "right" | "left" | "below" }) {
  const [h, m] = time ? time.split(":").map(Number) : [null, null];
  const hours = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Start around the chosen hour, or the working morning.
    const el = hours.current;
    const row = (el?.firstElementChild as HTMLElement | null)?.offsetHeight ?? 28;
    if (el) el.scrollTop = Math.max(0, ((h ?? 9) - 2) * (row + 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={`time-cols is-${side}`}>
      <div className="time-col" ref={hours}>
        {Array.from({ length: 24 }, (_, i) => (
          <button type="button" key={i} className={`time-cell ${i === h ? "is-selected pearl" : ""}`} onClick={() => onPick(`${pad(i)}:${pad(m ?? 0)}`)}>
            {pad(i)}
          </button>
        ))}
      </div>
      <div className="time-col time-col-min">
        {MINUTES.map((x) => (
          <button type="button" key={x} className={`time-cell ${x === m ? "is-selected pearl" : ""}`} onClick={() => onPick(`${pad(h ?? 9)}:${pad(x)}`)}>
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
  min,
  range,
  picks,
}: {
  date: string | null;
  time: string | null;
  onChange: (date: string | null, time: string | null) => void;
  /** Called after a day was picked or the value cleared. */
  onDone: () => void;
  min?: string | null;
  range?: [string, string] | null;
  /** Quick picks above the calendar (default: today, tomorrow, next week). */
  picks?: [string, string][];
}) {
  const today = todayKey();
  const [timeOpen, setTimeOpen] = useState<"right" | "left" | "below" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const pick = (d: string) => {
    onChange(d, time);
    onDone();
  };
  // The time columns float beside the panel, on whichever side has room.
  const toggleTime = () => {
    if (timeOpen) return setTimeOpen(null);
    const r = box.current?.getBoundingClientRect();
    const need = 130;
    setTimeOpen(!r || r.right + need <= innerWidth ? (r ? "right" : "below") : r.left - need >= 0 ? "left" : "below");
  };
  const quick = picks ?? [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["Next week", addDays(today, 7)],
  ];
  return (
    <div className="date-pop" ref={box}>
      <div className="quick-picks">
        {quick.map(([label, d]) => (
          <button type="button" key={label} className="chip-btn" disabled={!!min && d < min} onClick={() => pick(d)}>
            {label}
          </button>
        ))}
      </div>
      <MiniCalendar value={date} onPick={pick} min={min} range={range} />
      <div className="date-pop-foot">
        <button type="button" className={`time-trigger ${time ? "" : "is-empty"} ${timeOpen ? "is-open" : ""}`} onClick={toggleTime}>
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
      {timeOpen && <TimeColumns side={timeOpen} time={time} onPick={(t) => onChange(date ?? min ?? today, t)} />}
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
