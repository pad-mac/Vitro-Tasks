// Phone layout pieces: the bottom bar, the add sheet, and touch gestures
// (long press for the menu, long press and drag to reorder).
import { useEffect, useRef, useState, type RefObject } from "react";
import { isMobile } from "../lib/platform";
import { parseQuick } from "../lib/quickparse";
import { defaultsForView } from "../lib/views";
import { ParsedChips } from "../QuickAdd";
import { todayKey } from "../lib/dates";
import { useStore } from "../store";
import { SuggestList, useListSuggest } from "./ListSuggest";
import { useCreateTask, type TouchDragDetail } from "./tasks";
import { Icon } from "./ui";

export function MobileBar({ onSettings, onAdd }: { onSettings: () => void; onAdd: () => void }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const lastTaskView = useStore((s) => s.lastTaskView);
  const sync = useStore((s) => s.sync);
  const inCalendar = view.kind === "calendar";
  return (
    <nav className="m-bar">
      <div className="m-tabs">
        <button type="button" className={!inCalendar ? "is-active" : ""} onClick={() => setView(lastTaskView)}>
          <Icon name="tasks" size={21} />
          <span>Tasks</span>
        </button>
        <button type="button" className={inCalendar ? "is-active" : ""} onClick={() => setView({ kind: "calendar" })}>
          <Icon name="calendar" size={21} />
          <span>Calendar</span>
        </button>
        <button type="button" className={`m-settings sync-${sync.status}`} onClick={onSettings}>
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

/** The add sheet. It stays mounted (off screen) so the tap on + can focus it right away. */
export function MobileAdd({ open, onClose, inputRef }: { open: boolean; onClose: () => void; inputRef: RefObject<HTMLInputElement | null> }) {
  const view = useStore((s) => s.view);
  const create = useCreateTask();
  const [value, setValue] = useState("");
  const suggest = useListSuggest(value, setValue, inputRef as RefObject<HTMLInputElement>);
  const title = parseQuick(value).title;
  const base = view.kind === "calendar" ? { start_date: todayKey() } : defaultsForView(view);
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
          <div className="m-add-foot">{value.trim() ? <ParsedChips value={value} /> : <span className="qa-hint">tomorrow 14:00 · ^fri deadline · !high · #list</span>}</div>
        )}
      </div>
    </>
  );
}

const PRESS_MS = 420;
const SLOP = 8;
const LONG_PRESS = ".task-row, .card, .cal-chip, .nav-row, .tl-item, .tl-title";
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
        el = null;
      } else reset();
    };
    const onEnd = () => {
      if (drag) {
        drag.drop();
        drag = null;
        swallowClickUntil = Date.now() + 500;
      } else if (armed && el) {
        el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y }));
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
