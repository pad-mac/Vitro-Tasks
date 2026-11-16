import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  MONTHS_LONG,
  WEEKDAYS,
  addDays,
  addMonths,
  formatDateTime,
  startOfMonth,
  startOfWeek,
  todayKey,
} from "../lib/dates";

// ---------- Icons (16px grid, 1.5 stroke) ----------

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
  flag: <path d="M4 14V2.5M4 3h7.5l-1.8 2.6L11.5 8H4" />,
  clock: <path d="M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2zM8 4.8V8l2.2 1.4" />,
  trash: <path d="M3 4.5h10M6.2 4.5V3h3.6v1.5M4.3 4.5l.6 8.5h6.2l.6-8.5" />,
  settings: <path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6M10 3.4v3.2M6 9.4v3.2" />,
  sync: <path d="M13 6.5A5.2 5.2 0 0 0 3.6 5M3 9.5A5.2 5.2 0 0 0 12.4 11M3.2 2.6V5h2.4M12.8 13.4V11h-2.4" />,
  inbox: <path d="M2.5 9l1.6-5.5h7.8L13.5 9v3.5h-11zM2.5 9h3.2l.8 1.5h3l.8-1.5h3.2" />,
  sun: <path d="M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1" />,
  week: <path d="M2.5 3.5h11v9h-11zM5.25 3.5v9M8 3.5v9M10.75 3.5v9" />,
  layers: <path d="M8 2.5L2.5 5.5 8 8.5l5.5-3zM2.5 8.5L8 11.5l5.5-3M2.5 11L8 14l5.5-3" />,
  done: <path d="M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2zM5.5 8.2l1.8 1.8 3.4-3.8" />,
  dots: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth="2.2" />,
  group: <path d="M2.5 3.5h11v3.5h-11zM2.5 9.5h11v3h-11z" />,
  sort: <path d="M4.5 3v10M2.5 11l2 2 2-2M9 4h4.5M9 8h3.2M9 12h2" />,
  eye: <path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z" />,
  pin: <path d="M6 2.5h4l-.6 4 2.1 2.2H4.5l2.1-2.2zM8 8.7v5" />,
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

// ---------- Popover ----------

/** A button that opens a floating panel; closes on outside click or Escape. */
export function Popover({
  trigger,
  children,
  align = "left",
  className = "",
  title,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  // Keep the panel inside the window.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    el.style.transform = "";
    const r = el.getBoundingClientRect();
    const dx = r.right > innerWidth - 8 ? innerWidth - 8 - r.right : r.left < 8 ? 8 - r.left : 0;
    const dy = r.bottom > innerHeight - 8 ? innerHeight - 8 - r.bottom : 0;
    if (dx || dy) el.style.transform = `translate(${dx}px, ${dy}px)`;
  }, [open]);
  return (
    <div className={`pop ${className}`} ref={ref}>
      <button type="button" className={`pop-trigger ${open ? "is-open" : ""}`} title={title} onClick={() => setOpen(!open)}>
        {trigger}
      </button>
      {open && (
        <div className={`pop-panel pop-${align}`} ref={panel}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  active,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button type="button" className={`menu-item ${active ? "is-active" : ""} ${danger ? "is-danger" : ""}`} onClick={onClick}>
      <span className="menu-label">{children}</span>
      {active && <Icon name="check" size={14} />}
    </button>
  );
}

/** Labelled dropdown with a fixed set of options. */
export function Select<T extends string>({
  icon,
  label,
  value,
  options,
  onChange,
  align,
}: {
  icon?: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  align?: "left" | "right";
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Popover
      align={align}
      title={label}
      trigger={
        <span className="select-trigger">
          {icon && <Icon name={icon} size={14} />}
          <span className="select-label">{label}</span>
          <span className="select-value">{current?.label ?? "—"}</span>
        </span>
      }
    >
      {(close) => (
        <div className="menu">
          {options.map((o) => (
            <MenuItem
              key={o.value}
              active={o.value === value}
              onClick={() => {
                onChange(o.value);
                close();
              }}
            >
              {o.label}
            </MenuItem>
          ))}
        </div>
      )}
    </Popover>
  );
}

// ---------- Checkbox ----------

export function Check({ done, priority, onToggle }: { done: boolean; priority: number; onToggle: () => void }) {
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
      {done && <Icon name="check" size={12} />}
    </button>
  );
}

// ---------- Date field ----------

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
          {MONTHS_LONG[m - 1]} <span className="mono">{y}</span>
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
            className={`mini-cal-day ${d.slice(0, 7) !== month.slice(0, 7) ? "is-out" : ""} ${d === today ? "is-today" : ""} ${d === value ? "is-selected" : ""}`}
            onClick={() => onPick(d)}
          >
            {+d.slice(8)}
          </button>
        ))}
      </div>
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
}: {
  date: string | null;
  time: string | null;
  onChange: (date: string | null, time: string | null) => void;
  placeholder: string;
  tone?: "signal" | "overdue";
  icon?: string;
  align?: "left" | "right";
}) {
  const today = todayKey();
  return (
    <Popover
      align={align}
      className="date-field"
      trigger={
        <span className={`date-trigger ${date ? "" : "is-empty"} ${tone ? `tone-${tone}` : ""}`}>
          <Icon name={icon} size={14} />
          <span className={date ? "mono" : ""}>{date ? formatDateTime(date, time, today) : placeholder}</span>
        </span>
      }
    >
      {(close) => (
        <div className="date-pop">
          <div className="quick-picks">
            {[
              ["Today", today],
              ["Tomorrow", addDays(today, 1)],
              ["Monday", addDays(startOfWeek(today), 7)],
              ["+1 wk", addDays(date ?? today, 7)],
            ].map(([label, key]) => (
              <button type="button" key={label} className="chip-btn" onClick={() => { onChange(key, time); close(); }}>
                {label}
              </button>
            ))}
          </div>
          <MiniCalendar value={date} onPick={(d) => { onChange(d, time); close(); }} />
          <div className="date-pop-foot">
            <label className="time-input">
              <Icon name="clock" size={14} />
              <input
                type="time"
                value={time ?? ""}
                onChange={(e) => onChange(date ?? today, e.target.value || null)}
              />
            </label>
            <button type="button" className="text-btn" disabled={!date} onClick={() => { onChange(null, null); close(); }}>
              Clear
            </button>
          </div>
        </div>
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
