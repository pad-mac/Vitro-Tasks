// Phone layout pieces: the bottom bar, the add sheet, and touch gestures
// (long press for the menu, long press and drag to reorder).
import { useEffect, useRef, useState, type RefObject } from "react";
import { haptic, isMobile } from "../lib/platform";
import { hasNative, onNative, postNative } from "../lib/native";
import { dismissNativeMenu, showNativeTaskMenu } from "../lib/nativeMenu";
import { parseQuick } from "../lib/quickparse";
import { defaultsForView } from "../lib/views";
import { ParsedChips } from "../QuickAdd";
import { formatDateTime, todayKey } from "../lib/dates";
import type { Task } from "../shared/schema";
import { useStore } from "../store";
import { SuggestList, useListSuggest } from "./ListSuggest";
import { useCreateTask, type TouchDragDetail } from "./tasks";
import { TaskDetail } from "./TaskDetail";
import { Icon, usePresence } from "./ui";

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

let openAddImpl: ((base: Partial<Task> | null) => void) | null = null;

/** Opens the add sheet with defaults (call it from a touch or click handler, so the keyboard comes up). */
export function openAddSheet(base: Partial<Task> | null = null) {
  openAddImpl?.(base);
}

/** The add sheet. It stays mounted (off screen) so the tap on + can focus it right away. */
export function MobileAdd({
  open,
  onClose,
  inputRef,
  onOpen,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onOpen: (base: Partial<Task> | null) => void;
  preset: Partial<Task> | null;
}) {
  const view = useStore((s) => s.view);
  const create = useCreateTask();
  const [value, setValue] = useState("");
  const suggest = useListSuggest(value, setValue, inputRef as RefObject<HTMLInputElement>);
  const title = parseQuick(value).title;
  useEffect(() => {
    openAddImpl = onOpen;
    return () => {
      openAddImpl = null;
    };
  }, [onOpen]);
  const base = preset ?? (view.kind === "calendar" ? { start_date: todayKey() } : defaultsForView(view));
  const submit = () => {
    if (!title) return;
    void create(value, base);
    setValue("");
    onClose();
  };
  return (
    <>
      <div className={`m-scrim ${open ? "is-open" : ""}`} onClick={onClose} />
      <div className={`m-sheet m-add-sheet ${open ? "is-open" : ""}`} aria-hidden={!open}>
        <div className="m-add-row">
          <input
            ref={inputRef}
            value={value}
            placeholder="What needs doing?"
            enterKeyHint="done"
            autoCapitalize="sentences"
            tabIndex={open ? 0 : -1}
            {...suggest.inputProps}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (suggest.onKeyDown(e)) return;
              if (e.key === "Enter") submit();
              if (e.key === "Escape") onClose();
            }}
            onBlur={() => {
              // Closing the keyboard closes an empty sheet.
              if (!value.trim()) setTimeout(onClose, 50);
            }}
          />
          <button type="button" className="m-send" disabled={!title} aria-label="Add" onPointerDown={(e) => e.preventDefault()} onClick={submit}>
            <Icon name="arrowup" size={18} />
          </button>
        </div>
        {suggest.open ? (
          <SuggestList s={suggest} className="m-suggest" />
        ) : (
          <div className="m-add-foot">
            {preset?.start_date && !parseQuick(value).start_date && (
              <span className="qa-chip">
                <Icon name="calendar" size={12} /> {formatDateTime(preset.start_date, null)}
                {preset.end_date && preset.end_date > preset.start_date ? ` – ${formatDateTime(preset.end_date, null)}` : ""}
              </span>
            )}
            {value.trim() ? <ParsedChips value={value} /> : <span className="qa-hint">tomorrow 14:00 · ^fri deadline · !high · #list</span>}
          </div>
        )}
      </div>
    </>
  );
}

const LIFT_MS = 380;
const MENU_MS = 560;
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
 * - hold an item: it lifts; keep holding and its menu opens (the native one on iOS);
 * - hold a task and move: drag it to another place (the group under the finger shows where it lands);
 * - hold a calendar day: add a task on it; hold and move across days: add one spanning them.
 */
export function useTouchGestures() {
  useEffect(() => {
    if (!isMobile) return;
    let liftTimer = 0;
    let menuTimer = 0;
    let el: HTMLElement | null = null;
    let start = { x: 0, y: 0 };
    let armed = false;
    let drag: ReturnType<typeof startDrag> | null = null;
    let range: DayRange | null = null;
    // The item whose native menu is open (it stays lifted until the menu closes).
    let menuEl: HTMLElement | null = null;
    // The item whose menu (native or the app's own) this press already opened.
    let pressMenu: HTMLElement | null = null;
    // The native menu could not open while the finger was down: the app's own opens on release.
    let webMenuOnRelease: HTMLElement | null = null;
    let fingerDown = false;
    let swallowClickUntil = 0;

    const reset = () => {
      clearTimeout(liftTimer);
      clearTimeout(menuTimer);
      if (el && el !== menuEl) el.classList.remove("is-lifted");
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
    const openMenu = (item: HTMLElement) => {
      const id = item.dataset.id!;
      pressMenu = item;
      const closed = () => {
        item.classList.remove("is-lifted");
        if (menuEl === item) menuEl = null;
      };
      const shown = showNativeTaskMenu(id, item.getBoundingClientRect(), closed, () => {
        closed();
        if (fingerDown) webMenuOnRelease = item;
        else openWebMenu(item);
      });
      if (shown) {
        menuEl = item;
        swallowClickUntil = Date.now() + 800;
      }
    };
    const onStart = (e: TouchEvent) => {
      reset();
      pressMenu = null;
      webMenuOnRelease = null;
      fingerDown = true;
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
      if (hasNative() && item.matches(TASK_ITEM)) {
        menuTimer = window.setTimeout(() => {
          if (el === item && armed) openMenu(item);
        }, MENU_MS);
      }
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
        if (moved) reset();
        return;
      }
      if (!moved) return;
      e.preventDefault();
      clearTimeout(menuTimer);
      const id = el.dataset.id;
      if (id && el.matches(DRAGGABLE)) {
        // Moving a held task drags it, also out of its open menu.
        if (menuEl === el) dismissNativeMenu();
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
      } else if (el !== menuEl) reset();
    };
    const onEnd = () => {
      fingerDown = false;
      if (webMenuOnRelease) {
        openWebMenu(webMenuOnRelease);
        webMenuOnRelease = null;
        swallowClickUntil = Date.now() + 500;
      } else if (drag) {
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
      } else if (el && el === pressMenu) {
        // Letting go of a task whose menu is open leaves the menu open.
        swallowClickUntil = Date.now() + 500;
      } else if (armed && el) {
        if (el.matches(".cal-cell") && el.dataset.day) openAddSheet({ start_date: el.dataset.day });
        else openWebMenu(el);
        swallowClickUntil = Date.now() + 500;
      }
      reset();
    };
    const onCancel = () => {
      fingerDown = false;
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
export function MobileTaskSheet({ task }: { task: Task | null }) {
  const select = useStore((s) => s.select);
  const [shown, closing] = usePresence(task, 240);
  const [full, setFull] = useState(false);
  const [drag, setDrag] = useState(0);
  const gesture = useRef<{ y: number; x: number; lastY: number; lastT: number; v: number; active: boolean } | null>(null);
  const bodyScroll = useRef<HTMLElement | null>(null);
  const id = task?.id ?? null;
  useEffect(() => {
    if (id) setFull(false);
  }, [id]);
  if (!shown) return null;

  const onTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable='true'], .floating, .pop-panel")) return;
    const inHead = !!target.closest(".m-grabber, .detail-head");
    const body = target.closest<HTMLElement>(".detail-body");
    bodyScroll.current = body;
    // Half open: any pull moves the sheet. Full screen: only the top bar, or a pull down from the top of the text.
    if (full && !inHead && !(body && body.scrollTop <= 0)) return;
    const t = e.touches[0];
    gesture.current = { x: t.clientX, y: t.clientY, lastY: t.clientY, lastT: Date.now(), v: 0, active: false };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (!g) return;
    const t = e.touches[0];
    const dy = t.clientY - g.y;
    if (!g.active) {
      if (Math.abs(dy) < 8) return;
      if (Math.abs(t.clientX - g.x) > Math.abs(dy)) {
        gesture.current = null;
        return;
      }
      // Full screen with the text scrolled down: let the text scroll.
      if (full && dy < 0) {
        gesture.current = null;
        return;
      }
      g.active = true;
    }
    const now = Date.now();
    g.v = (t.clientY - g.lastY) / Math.max(1, now - g.lastT);
    g.lastY = t.clientY;
    g.lastT = now;
    // Pulling past full height meets resistance.
    setDrag(full ? Math.max(0, dy) : dy < 0 ? dy * 0.6 : dy);
  };
  const onTouchEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.active) return;
    const dy = g.lastY - g.y;
    setDrag(0);
    if (!full && (dy < -50 || g.v < -0.5)) {
      setFull(true);
      haptic("light");
    } else if (full && (dy > 90 || g.v > 0.6)) setFull(false);
    else if (!full && (dy > 90 || g.v > 0.6)) select(null);
  };

  return (
    <>
      <div className={`m-scrim m-task-scrim ${closing ? "" : "is-open"}`} onClick={() => select(null)} />
      <div
        className={`m-task-sheet ${full ? "is-full" : ""} ${closing ? "is-closing" : ""} ${drag ? "is-dragging" : ""}`}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div className="m-grabber" onClick={() => setFull(!full)}>
          <i />
        </div>
        <TaskDetail key={shown.id} task={shown} variant="pane" />
      </div>
    </>
  );
}
