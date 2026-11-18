// Holding a task on the phone: the task lifts and its menu opens next to it.
// The gestures (when to lift, sliding over the menu, when a hold becomes a
// drag) are in useTouchGestures (Mobile.tsx); this file owns the lifted copy,
// the menu and its placement.
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { addDays, deadlineCountdown, formatDateTime, todayKey } from "../lib/dates";
import { haptic } from "../lib/platform";
import { PRIORITY_LABELS } from "../lib/views";
import { useStore } from "../store";
import { Flag, Icon } from "./ui";

const GAP = 10;
const EDGE = 12;
const SETTLE_MS = 200;

interface Hold {
  id: string;
  rect: DOMRect;
  lift: HTMLElement;
  shift: number;
  /** The menu is on screen (it waits while making room would take the task from under the finger). */
  shown: boolean;
  closing: boolean;
  seq: number;
}

let hold: Hold | null = null;
let hot: string | null = null;
let seq = 0;
let version = 0;
const subs = new Set<() => void>();
const changed = () => {
  version++;
  subs.forEach((f) => f());
};

/**
 * Hides every copy of a task (rows, cards, calendar chips) while a stand-in
 * is on screen. A style rule rather than a class, so it holds when React
 * redraws the row meanwhile.
 */
export function hideTask(id: string | null) {
  let style = document.getElementById("vitro-held") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "vitro-held";
    document.head.appendChild(style);
  }
  style.textContent = id ? `[data-id="${CSS.escape(id)}"]:is(.task-row, .card, .cal-chip, .tl-item) { visibility: hidden !important; }` : "";
}

/** Where a task is drawn now (null if it is not on screen any more). */
export function taskRect(id: string): DOMRect | null {
  const el = document.querySelector<HTMLElement>(`:is(.task-row, .card, .cal-chip, .tl-item)[data-id="${CSS.escape(id)}"]`);
  const r = el?.getBoundingClientRect();
  return r && r.height > 0 && r.bottom > 0 && r.top < innerHeight ? r : null;
}

/** A copy of a task's row or card that floats above the page (the lift, then the drag). */
export function floatingCopy(source: HTMLElement): HTMLElement {
  const r = source.getBoundingClientRect();
  const copy = source.cloneNode(true) as HTMLElement;
  copy.classList.remove("is-selected", "is-lifted", "is-dragging");
  copy.removeAttribute("data-id");
  copy.classList.add("floating-copy");
  Object.assign(copy.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  // Inside the app, so the copy keeps the narrow layout of the row.
  (source.closest(".app") ?? document.body).appendChild(copy);
  return copy;
}

function finish(h: Hold) {
  if (hold !== h) return;
  h.lift.remove();
  hideTask(null);
  hold = null;
  hot = null;
  changed();
}

/** Puts the copy back where the task is now (or fades it), then ends the hold. */
function settle(h: Hold) {
  const now = taskRect(h.id);
  const lift = h.lift;
  lift.classList.remove("is-up");
  if (now) lift.style.transform = `translate(${now.left - h.rect.left}px, ${now.top - h.rect.top}px)`;
  else lift.style.opacity = "0";
  setTimeout(() => finish(h), SETTLE_MS);
}

export const holdMenu = {
  isOpen: () => !!hold && !hold.closing,
  /** Lifted, menu not out yet (it needs room the task has to make). */
  isWaiting: () => !!hold && !hold.closing && !hold.shown,
  /** Brings the waiting menu out; the task moves aside for it. */
  reveal() {
    if (!hold || hold.closing || hold.shown) return;
    hold.shown = true;
    hold.lift.style.setProperty("--shift", `${hold.shift}px`);
    haptic("light");
    changed();
  },
  heldId: () => (hold && !hold.closing ? hold.id : null),
  /** Lifts the task and opens its menu. */
  open(source: HTMLElement) {
    const id = source.dataset.id;
    if (!id) return;
    if (hold) finish(hold);
    const rect = source.getBoundingClientRect();
    const lift = floatingCopy(source);
    lift.classList.add("hold-lift");
    hideTask(id);
    hold = { id, rect, lift, shift: 0, shown: false, closing: false, seq: ++seq };
    hot = null;
    haptic("medium");
    changed();
    requestAnimationFrame(() => lift.classList.add("is-up"));
  },
  /** The menu entry under a point, if any. */
  itemAt(x: number, y: number): string | null {
    return document.elementFromPoint(x, y)?.closest<HTMLElement>(".hold-menu [data-hm]")?.dataset.hm ?? null;
  },
  /** The point is on the menu (or within `pad` px of it). */
  inMenu(x: number, y: number, pad = 0): boolean {
    const m = document.querySelector(".hold-layer:not(.is-waiting) .hold-menu")?.getBoundingClientRect();
    return !!m && x >= m.left - pad && x <= m.right + pad && y >= m.top - pad && y <= m.bottom + pad;
  },
  setHot(key: string | null) {
    if (key === hot) return;
    hot = key;
    if (key) haptic("selection");
    changed();
  },
  hot: () => hot,
  /**
   * True if a move from `from` by (dx, dy), carried on in a straight line,
   * would reach the menu. A pull past its side does not, so that drags.
   */
  toward(from: { x: number; y: number }, dx: number, dy: number): boolean {
    const m = document.querySelector(".hold-layer:not(.is-waiting) .hold-menu")?.getBoundingClientRect();
    if (!m) return false;
    const pad = 2;
    let t0 = 0;
    let t1 = Infinity;
    for (const [p, d, lo, hi] of [
      [from.x, dx, m.left - pad, m.right + pad],
      [from.y, dy, m.top - pad, m.bottom + pad],
    ]) {
      if (Math.abs(d) < 1e-6) {
        if (p < lo || p > hi) return false;
        continue;
      }
      const a = (lo - p) / d;
      const b = (hi - p) / d;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    return t0 <= t1;
  },
  close() {
    if (!hold || hold.closing) return;
    hold.closing = true;
    hot = null;
    changed();
    settle(hold);
  },
  act(key: string) {
    if (!hold || hold.closing) return;
    const id = hold.id;
    run(id, key, hold.rect);
    haptic("light");
    holdMenu.close();
  },
  /** The held task starts a drag: the menu goes, the copy becomes what the finger moves. */
  toDrag(): { id: string; el: HTMLElement; shift: number } | null {
    if (!hold || hold.closing) return null;
    const h = hold;
    h.lift.classList.remove("hold-lift", "is-up");
    const out = { id: h.id, el: h.lift, shift: h.shift };
    hold = null;
    hot = null;
    // The drag hides the task from here on.
    hideTask(null);
    changed();
    return out;
  },
};

function run(id: string, key: string, rect: DOMRect) {
  const st = useStore.getState();
  const task = st.tasks.find((t) => t.id === id);
  if (!task) return;
  const today = todayKey();
  // Pickers that need more room open as the app's menu next to the task, once this one is gone.
  const later = (fn: () => void) => setTimeout(fn, SETTLE_MS + 20);
  const page = (name: "date" | "deadline" | "move") => () => {
    const r = taskRect(id) ?? rect;
    st.openMenu({ kind: "task", id, x: r.left + 12, y: r.top - 4, h: r.height + 8, page: name });
  };
  const day = { today, tomorrow: addDays(today, 1), nextweek: addDays(today, 7) }[key.slice(5)];
  if (key.startsWith("date:") && day) void st.updateTask(id, { start_date: day, end_date: null, end_time: null });
  else if (key === "date:pick") later(page("date"));
  else if (key.startsWith("prio:")) void st.updateTask(id, { priority: Number(key.slice(5)) });
  else if (key === "pin") void st.updateTask(id, { pinned: task.pinned ? 0 : 1 });
  else if (key === "subtask") later(() => {
    const r = taskRect(id) ?? rect;
    st.addSubtaskTo(id, { x: r.left, y: r.top, w: r.width, h: r.height });
  });
  else if (key === "move") later(page("move"));
  else if (key === "deadline") later(page("deadline"));
  else if (key === "wontdo") void st.setWontDo(id);
  else if (key === "reopen") void st.toggleTask(id);
  else if (key === "duplicate") void st.duplicateTask(id);
  else if (key === "delete") void st.deleteTask(id);
}

function useHold() {
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => version,
  );
  return hold;
}

/** Screen space the menu may use: below the status bar, above the tab bar. */
function bounds() {
  const app = document.querySelector(".app");
  const top = (app ? parseFloat(getComputedStyle(app).paddingTop) || 0 : 0) + EDGE;
  const tabs = document.querySelector(".m-bar:not(.is-hidden) .m-tabs")?.getBoundingClientRect().top;
  const bottom = Math.min(innerHeight, tabs ?? innerHeight) - EDGE;
  return { top, bottom };
}

export function HoldMenu() {
  const h = useHold();
  const ref = useRef<HTMLDivElement>(null);
  const task = useStore((s) => (h ? s.tasks.find((t) => t.id === h.id) : undefined));
  const view = useStore((s) => s.view);
  useEffect(() => holdMenu.close(), [view]);
  // Placement: below the task if it fits, else above; if neither, the task moves up just enough.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!h || !el || h.closing) return;
    const r = h.rect;
    const { top, bottom } = bounds();
    const width = Math.min(244, innerWidth - 2 * EDGE);
    el.style.width = `${width}px`;
    el.style.left = `${Math.round((innerWidth - width) / 2)}px`;
    el.style.maxHeight = "";
    const mh = el.offsetHeight;
    let shift = 0;
    let menuTop: number;
    let below = true;
    if (r.bottom + GAP + mh <= bottom) menuTop = r.bottom + GAP;
    else if (r.top - GAP - mh >= top) {
      menuTop = r.top - GAP - mh;
      below = false;
    } else {
      shift = Math.max(top - r.top, bottom - mh - GAP - r.bottom);
      menuTop = r.bottom + shift + GAP;
      if (menuTop + mh > bottom) el.style.maxHeight = `${bottom - menuTop}px`;
    }
    h.shift = shift;
    el.style.top = `${Math.round(menuTop)}px`;
    el.style.transformOrigin = below ? "50% 0" : "50% 100%";
    // It fits beside the task: out right away. Otherwise it waits (see isWaiting).
    if (!shift && !h.shown) {
      h.shown = true;
      changed();
    }
  }, [h?.seq]);
  if (!h || !task) return null;
  const today = todayKey();
  const dates: [string, string, string, string | null][] = [
    ["date:today", "today", "Today", today],
    ["date:tomorrow", "tomorrow", "Tomorrow", addDays(today, 1)],
    ["date:nextweek", "nextweek", "Next Week", addDays(today, 7)],
    ["date:pick", "pickdate", "Pick Date", null],
  ];
  const cls = (key: string, extra = "") => `${extra} ${hot === key ? "is-hot" : ""}`;
  const item = (key: string, icon: React.ReactNode, label: string, extra?: React.ReactNode, danger = false) => (
    <button type="button" data-hm={key} className={cls(key, `hm-item ${danger ? "is-danger" : ""}`)} onClick={() => holdMenu.act(key)}>
      {icon}
      <span className="hm-label">{label}</span>
      {extra}
    </button>
  );
  const active = (d: string | null) => !!d && task.start_date === d && !task.end_date;
  return (
    <div className={`hold-layer ${h.closing ? "is-closing" : ""} ${h.shown ? "" : "is-waiting"}`}>
      <div className="hold-scrim" />
      <div ref={ref} className="hold-menu" role="menu">
        <div className="hm-row">
          {dates.map(([key, icon, label, d]) => (
            <button type="button" key={key} data-hm={key} aria-label={label} className={cls(key, `hm-cell ${active(d) ? "is-active" : ""}`)} onClick={() => holdMenu.act(key)}>
              <Icon name={icon} size={22} />
            </button>
          ))}
        </div>
        <div className="hm-row">
          {[3, 2, 1, 0].map((p) => (
            <button
              type="button"
              key={p}
              data-hm={`prio:${p}`}
              aria-label={PRIORITY_LABELS[p]}
              className={cls(`prio:${p}`, `hm-cell ${task.priority === p ? "is-active" : ""}`)}
              onClick={() => holdMenu.act(`prio:${p}`)}
            >
              <Flag priority={p} size={21} />
            </button>
          ))}
        </div>
        <div className="hm-sep" />
        {item("pin", <Icon name="pin" size={17} />, task.pinned ? "Unpin" : "Pin")}
        {!task.parent_id && item("subtask", <Icon name="subtask" size={17} />, "Add Subtask")}
        {!task.parent_id && item("move", <Icon name="move" size={17} />, "Move to", <Icon name="chevron" size={12} />)}
        {item(
          "deadline",
          <Icon name="deadline" size={17} />,
          task.deadline_date ? "Deadline" : "Add Deadline",
          task.deadline_date ? (
            <span className="hm-value">
              {formatDateTime(task.deadline_date, task.deadline_time, today)}
              {task.status === 0 && ` · ${deadlineCountdown(task.deadline_date, today)}`}
            </span>
          ) : null,
        )}
        <div className="hm-sep" />
        {task.status === 0 ? item("wontdo", <Icon name="ban" size={17} />, "Won't Do") : item("reopen", <Icon name="tasks" size={17} />, "Reopen")}
        {item("duplicate", <Icon name="copy" size={17} />, "Duplicate")}
        <div className="hm-sep" />
        {item("delete", <Icon name="trash" size={17} />, "Delete", null, true)}
      </div>
    </div>
  );
}
