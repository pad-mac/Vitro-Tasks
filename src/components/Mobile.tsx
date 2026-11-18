// Phone layout pieces: the bottom bar, the add sheet, and touch gestures
// (long press for the menu, long press and drag to reorder).
import { useEffect, useRef } from "react";
import { haptic, isMobile } from "../lib/platform";
import { hasNative, onNative, postNative } from "../lib/native";
import { showNativeTaskMenu } from "../lib/nativeMenu";
import { useStore } from "../store";
import { openAddSheet } from "./PhoneSheets";
import { type TouchDragDetail } from "./tasks";
import { Icon } from "./ui";

export { MobileAdd, MobileTaskSheet, openAddSheet } from "./PhoneSheets";

/**
 * The bottom bar. In the iOS app the native glass bar draws it (and handles
 * the tabs); the page keeps an invisible + under the native one, because the
 * text field has to be focused inside the tap for the keyboard to open.
 */
export function MobileBar({
  settingsOpen,
  hidden,
  onSettings,
  onCloseSettings,
  onAdd,
}: {
  settingsOpen: boolean;
  hidden: boolean;
  onSettings: () => void;
  onCloseSettings: () => void;
  onAdd: () => void;
}) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const lastTaskView = useStore((s) => s.lastTaskView);
  const syncError = useStore((s) => s.sync.status === "error");
  const inCalendar = view.kind === "calendar";
  const active = settingsOpen ? "settings" : inCalendar ? "calendar" : "tasks";
  const tabs = {
    tasks: () => {
      onCloseSettings();
      setView(lastTaskView);
    },
    calendar: () => {
      onCloseSettings();
      setView({ kind: "calendar" });
    },
    settings: onSettings,
  };
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  useEffect(() => onNative("tab", (p) => tabsRef.current[p.id as keyof typeof tabs]?.()), []);
  useEffect(() => postNative({ type: "bar", visible: !hidden, active, badge: syncError }), [hidden, active, syncError]);
  const press = (down: boolean) => () => postNative({ type: "press", down });
  return (
    <nav className={`m-bar ${hidden ? "is-hidden" : ""}`} aria-hidden={hidden}>
      <div className="m-tabs">
        <button type="button" className={active === "tasks" ? "is-active" : ""} onClick={tabs.tasks}>
          <Icon name="tasks" size={21} />
          <span>Tasks</span>
        </button>
        <button type="button" className={active === "calendar" ? "is-active" : ""} onClick={tabs.calendar}>
          <Icon name="calendar" size={21} />
          <span>Calendar</span>
        </button>
        <button type="button" className={active === "settings" ? "is-active" : ""} onClick={tabs.settings}>
          <Icon name="settings" size={21} />
          <span>Settings</span>
          {syncError && <i className="m-badge" />}
        </button>
      </div>
      {/* Focus has to happen inside the tap itself, or iOS keeps the keyboard closed. */}
      <button
        type="button"
        className="m-add pearl"
        aria-label="Add task"
        onClick={onAdd}
        onTouchStart={press(true)}
        onTouchEnd={press(false)}
        onTouchCancel={press(false)}
      >
        <Icon name="plus" size={24} />
      </button>
    </nav>
  );
}

const LIFT_MS = 350;
const SLOP = 8;
const LONG_PRESS = ".task-row, .card, .cal-chip, .nav-row, .tl-item, .tl-title, .m-week .cal-cell";
const DRAGGABLE = '.task-row[data-depth="0"], .card';
// Items that get the task menu (native on iOS).
const TASK_ITEM = ".task-row[data-id], .card[data-id], .cal-chip[data-id], .tl-item[data-id]";

/** The app's own menu for a held item, next to it rather than on top of it. */
function openWebMenu(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const id = el.dataset.id;
  if (id && el.matches(TASK_ITEM)) {
    useStore.getState().openMenu({ kind: "task", id, x: r.left + 12, y: r.top - 4, h: r.height + 8 });
    return;
  }
  // Lists and other items: their own handler opens the menu at this point (below the item).
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 12, clientY: r.bottom + 4 }));
}

export interface DayRange {
  a: string;
  b: string;
}

/**
 * Touch gestures for the phone:
 * - hold an item: it lifts. Move while still holding: it drags (as long as
 *   you like, there is no menu in the way). Let go without moving: its menu
 *   opens (the native one on iOS, where the task can also be dragged out of it);
 * - hold a calendar day: add a task on it; hold and move across days: add one spanning them.
 */
export function useTouchGestures() {
  useEffect(() => {
    if (!isMobile) return;
    let liftTimer = 0;
    let el: HTMLElement | null = null;
    let start = { x: 0, y: 0 };
    let armed = false;
    let drag: ReturnType<typeof startDrag> | null = null;
    let range: DayRange | null = null;
    let swallowClickUntil = 0;

    const reset = () => {
      clearTimeout(liftTimer);
      el?.classList.remove("is-lifted");
      el = null;
      armed = false;
    };
    const showRange = () => window.dispatchEvent(new CustomEvent<DayRange | null>("vitro:dayrange", { detail: range && { ...range } }));
    const moveRange = (x: number, y: number) => {
      const day = document.elementFromPoint(x, y)?.closest<HTMLElement>(".m-week .cal-cell[data-day]")?.dataset.day;
      if (range && day && day !== range.b) {
        range.b = day;
        haptic("selection");
        showRange();
      }
    };
    /** Native menu for a task; the task itself hides while its picture is lifted. */
    const openMenu = (item: HTMLElement) => {
      const id = item.dataset.id!;
      // The picture for the menu: the task as a plain card, without the lift.
      item.classList.remove("is-lifted");
      item.classList.add("is-menu-shot");
      const show = () => item.classList.remove("is-menu-source", "is-menu-shot");
      const shown = showNativeTaskMenu(id, item.getBoundingClientRect(), item.matches(DRAGGABLE), {
        shown: () => item.classList.add("is-menu-source"),
        closed: show,
        failed: () => {
          show();
          openWebMenu(item);
        },
      });
      if (!shown) {
        show();
        openWebMenu(item);
      }
    };
    const onStart = (e: TouchEvent) => {
      reset();
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable='true'], .check")) return;
      const item = target.closest<HTMLElement>(LONG_PRESS);
      if (!item) return;
      el = item;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      liftTimer = window.setTimeout(() => {
        armed = true;
        el?.classList.add("is-lifted");
        haptic("medium");
      }, LIFT_MS);
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (drag) {
        e.preventDefault();
        drag.move(t.clientX, t.clientY);
        return;
      }
      if (range) {
        e.preventDefault();
        moveRange(t.clientX, t.clientY);
        return;
      }
      if (!el) return;
      const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y) > SLOP;
      if (!armed) {
        // Moving before the item lifted is scrolling.
        if (moved) reset();
        return;
      }
      if (!moved) return;
      e.preventDefault();
      const id = el.dataset.id;
      if (id && el.matches(DRAGGABLE)) {
        el.classList.remove("is-lifted");
        drag = startDrag(el, id, start, t.clientX, t.clientY);
        haptic("selection");
        el = null;
      } else if (el.matches(".cal-cell") && el.dataset.day) {
        range = { a: el.dataset.day, b: el.dataset.day };
        el.classList.remove("is-lifted");
        el = null;
        showRange();
        moveRange(t.clientX, t.clientY);
      } else reset();
    };
    const onEnd = () => {
      if (drag) {
        drag.drop();
        drag = null;
        haptic("light");
        swallowClickUntil = Date.now() + 500;
      } else if (range) {
        const [from, to] = range.a <= range.b ? [range.a, range.b] : [range.b, range.a];
        range = null;
        showRange();
        openAddSheet({ start_date: from, end_date: to > from ? to : null });
        swallowClickUntil = Date.now() + 500;
      } else if (armed && el) {
        const item = el;
        if (item.matches(".cal-cell") && item.dataset.day) openAddSheet({ start_date: item.dataset.day });
        else if (hasNative() && item.matches(TASK_ITEM)) openMenu(item);
        else openWebMenu(item);
        swallowClickUntil = Date.now() + 500;
      }
      reset();
    };
    const onCancel = () => {
      drag?.cancel();
      drag = null;
      if (range) {
        range = null;
        showRange();
      }
      reset();
    };
    // A long press must not also count as a tap (opening the task, or closing the menu it just opened).
    const onClick = (e: MouseEvent) => {
      if (Date.now() < swallowClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "click") swallowClickUntil = 0;
      }
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onCancel);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousedown", onClick, true);
    return () => {
      document.removeEventListener("mousedown", onClick, true);
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
}

/** A copy of the item follows the finger; groups under it show where it would land. */
function startDrag(el: HTMLElement, id: string, from: { x: number; y: number }, x: number, y: number) {
  const r = el.getBoundingClientRect();
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.classList.add("drag-ghost");
  ghost.classList.remove("is-selected", "is-lifted");
  Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  // Inside the app, so the copy keeps the narrow layout of the row.
  (el.closest(".app") ?? document.body).appendChild(ghost);
  el.classList.add("is-dragging");
  document.documentElement.classList.add("is-touch-dragging");
  const scroller = el.closest<HTMLElement>(".list-view, .column-body");
  const board = el.closest<HTMLElement>(".kanban");
  let last = { x, y };
  let group: Element | null = null;
  let raf = 0;

  const send = (name: "vitro:touchover" | "vitro:touchdrop", target: Element) =>
    target.dispatchEvent(new CustomEvent<TouchDragDetail>(name, { detail: { id, y: last.y } }));
  const hover = () => {
    const under = document.elementFromPoint(last.x, last.y)?.closest("[data-drop-group]") ?? null;
    // Gaps between groups keep the last group, so its line does not blink.
    if (under) group = under;
    if (group) send("vitro:touchover", group);
  };
  // Near the edges the list (or the board, sideways) scrolls along, faster closer to the edge.
  const barTop = document.querySelector(".m-tabs")?.getBoundingClientRect().top ?? innerHeight;
  const speed = (depth: number) => Math.round(Math.min(14, Math.max(2, (depth / 52) * 14)));
  const tick = () => {
    const sc = scroller?.getBoundingClientRect();
    if (scroller && sc) {
      const bottom = Math.min(sc.bottom, barTop - 8);
      if (last.y < sc.top + 52) scroller.scrollTop -= speed(sc.top + 52 - last.y);
      else if (last.y > bottom - 52) scroller.scrollTop += speed(last.y - bottom + 52);
    }
    const bc = board?.getBoundingClientRect();
    if (board && bc) {
      if (last.x < bc.left + 36) board.scrollLeft -= 8;
      else if (last.x > bc.right - 36) board.scrollLeft += 8;
    }
    hover();
    raf = requestAnimationFrame(tick);
  };
  const place = () => {
    ghost.style.transform = `translate(${last.x - from.x}px, ${last.y - from.y}px) scale(1.02)`;
  };
  const end = () => {
    cancelAnimationFrame(raf);
    ghost.remove();
    el.classList.remove("is-dragging");
    document.documentElement.classList.remove("is-touch-dragging");
    useStore.getState().setDropHint(null);
  };
  place();
  raf = requestAnimationFrame(tick);
  return {
    move(nx: number, ny: number) {
      last = { x: nx, y: ny };
      place();
    },
    drop() {
      hover();
      if (group) send("vitro:touchdrop", group);
      end();
    },
    cancel: end,
  };
}

/** Swipes on the calendar: left/right (and up/down in month views) page through it. */
export function useSwipe(onPage: (dir: number) => void, vertical: boolean) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      if (!isMobile || e.touches.length !== 1) return;
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || Date.now() - s.t > 700) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) onPage(dx < 0 ? 1 : -1);
      else if (vertical && Math.abs(dy) > 50 && Math.abs(dy) > 1.5 * Math.abs(dx)) onPage(dy < 0 ? 1 : -1);
    },
  };
}

/** Swiping in from the left edge of the screen opens the lists; swiping left closes them. */
export function useEdgeSwipe() {
  useEffect(() => {
    if (!isMobile) return;
    let start: { x: number; y: number; open: boolean } | null = null;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      const st = useStore.getState();
      if (e.touches.length !== 1 || st.view.kind === "calendar" || st.selectedId) return;
      if (st.drawerOpen || t.clientX < 24) start = { x: t.clientX, y: t.clientY, open: st.drawerOpen };
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) {
        start = null;
        return;
      }
      const st = useStore.getState();
      if (!start.open && dx > 44) {
        st.setDrawerOpen(true);
        haptic("light");
        start = null;
      } else if (start.open && dx < -44) {
        st.setDrawerOpen(false);
        start = null;
      }
    };
    const onEnd = () => (start = null);
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, []);
}

/**
 * A task opens in a sheet over the lower part of the screen; pull it up for
 * full-screen editing, pull it down (or tap above it) to close it.
 */
