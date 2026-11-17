// Phone layout pieces: the bottom bar, the add sheet, and touch gestures
// (long press for the menu, long press and drag to reorder).
import { useEffect, useRef, useState, type RefObject } from "react";
import { haptic, isMobile } from "../lib/platform";
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

export function MobileBar({ settingsOpen, onSettings, onCloseSettings, onAdd }: { settingsOpen: boolean; onSettings: () => void; onCloseSettings: () => void; onAdd: () => void }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const lastTaskView = useStore((s) => s.lastTaskView);
  const sync = useStore((s) => s.sync);
  const inCalendar = view.kind === "calendar";
  return (
    <nav className="m-bar">
      <div className="m-tabs">
        <button
          type="button"
          className={!inCalendar && !settingsOpen ? "is-active" : ""}
          onClick={() => {
            onCloseSettings();
            setView(lastTaskView);
          }}
        >
          <Icon name="tasks" size={21} />
          <span>Tasks</span>
        </button>
        <button
          type="button"
          className={inCalendar && !settingsOpen ? "is-active" : ""}
          onClick={() => {
            onCloseSettings();
            setView({ kind: "calendar" });
          }}
        >
          <Icon name="calendar" size={21} />
          <span>Calendar</span>
        </button>
        <button type="button" className={`m-settings sync-${sync.status} ${settingsOpen ? "is-active" : ""}`} onClick={onSettings}>
          <Icon name="settings" size={21} />
          <span>Settings</span>
          <i className="sync-dot" />
        </button>
      </div>
      {/* Focus has to happen inside the tap itself, or iOS keeps the keyboard closed. */}
      <button type="button" className="m-add pearl" aria-label="Add task" onClick={onAdd}>
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
              </span>
            )}
            {value.trim() ? <ParsedChips value={value} /> : <span className="qa-hint">tomorrow 14:00 · ^fri deadline · !high · #list</span>}
          </div>
        )}
      </div>
    </>
  );
}

const PRESS_MS = 420;
const SLOP = 8;
const LONG_PRESS = ".task-row, .card, .cal-chip, .nav-row, .tl-item, .tl-title, .m-week .cal-cell";
const DRAGGABLE = '.task-row[data-depth="0"], .card';

/**
 * Touch gestures for the phone: hold an item to open its menu; hold and move
 * a task to drag it to another place (the list or board group under the finger
 * shows where it lands).
 */
export function useTouchGestures() {
  useEffect(() => {
    if (!isMobile) return;
    let timer = 0;
    let el: HTMLElement | null = null;
    let start = { x: 0, y: 0 };
    let armed = false;
    let drag: ReturnType<typeof startDrag> | null = null;
    let swallowClickUntil = 0;

    const reset = () => {
      clearTimeout(timer);
      el?.classList.remove("is-lifted");
      el = null;
      armed = false;
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
      timer = window.setTimeout(() => {
        armed = true;
        el?.classList.add("is-lifted");
        haptic("medium");
      }, PRESS_MS);
    };
    const onMove = (e: TouchEvent) => {
      if (drag) {
        e.preventDefault();
        drag.move(e.touches[0].clientX, e.touches[0].clientY);
        return;
      }
      if (!el) return;
      const t = e.touches[0];
      const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y) > SLOP;
      if (!armed) {
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
      } else reset();
    };
    const onEnd = () => {
      if (drag) {
        drag.drop();
        drag = null;
        haptic("light");
        swallowClickUntil = Date.now() + 500;
      } else if (armed && el) {
        // Holding a calendar day adds a task on it; holding anything else opens its menu.
        if (el.matches(".cal-cell") && el.dataset.day) openAddSheet({ start_date: el.dataset.day });
        else el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y }));
        swallowClickUntil = Date.now() + 500;
      }
      reset();
    };
    const onCancel = () => {
      drag?.cancel();
      drag = null;
      reset();
    };
    // A long press must not also count as a tap that opens the task.
    const onClick = (e: MouseEvent) => {
      if (Date.now() < swallowClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        swallowClickUntil = 0;
      }
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onCancel);
    document.addEventListener("click", onClick, true);
    return () => {
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
  ghost.classList.remove("is-selected", "drop-before");
  Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  document.body.appendChild(ghost);
  el.classList.add("is-dragging");
  const scroller = el.closest<HTMLElement>(".list-view, .column-body");
  const board = el.closest<HTMLElement>(".kanban");
  let last = { x, y };
  let group: Element | null = null;
  let raf = 0;

  const send = (name: "vitro:touchover" | "vitro:touchdrop", target: Element) =>
    target.dispatchEvent(new CustomEvent<TouchDragDetail>(name, { detail: { id, y: last.y } }));
  const hover = () => {
    const under = document.elementFromPoint(last.x, last.y)?.closest("[data-drop-group]") ?? null;
    if (under !== group && !under) useStore.getState().setDropHint(null);
    group = under;
    if (group) send("vitro:touchover", group);
  };
  // Near the edges the list (or the board, sideways) scrolls along.
  const tick = () => {
    const sc = scroller?.getBoundingClientRect();
    if (scroller && sc) {
      if (last.y < sc.top + 56) scroller.scrollTop -= 7;
      else if (last.y > sc.bottom - 56) scroller.scrollTop += 7;
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
