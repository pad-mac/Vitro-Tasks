// Phone layout pieces: the bottom bar, the add sheet, and touch gestures
// (long press for the menu, long press and drag to reorder).
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { haptic, isMobile } from "../lib/platform";
import { hasNative, onNative, postNative } from "../lib/native";
import { isLifted, liftedSince, reportTouch } from "../lib/nativeMenu";
import { parseQuick } from "../lib/quickparse";
import { defaultsForView } from "../lib/views";
import { ParsedChips } from "../QuickAdd";
import { formatDateTime, todayKey } from "../lib/dates";
import type { Task } from "../shared/schema";
import { useStore } from "../store";
import { SuggestList, useListSuggest } from "./ListSuggest";
import { useCreateTask, type TouchDragDetail } from "./tasks";
import { DayPicker, ListChoice, PriorityChoice, SpanPicker, useSheetGesture, type PropValues } from "./PhonePickers";
import { TaskDetail } from "./TaskDetail";
import { Flag, Icon, usePresence } from "./ui";

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

type Tool = "date" | "deadline" | "priority" | "list";

/**
 * The add sheet: a line to type into, with buttons for date, deadline,
 * priority and list below it (their pickers take the keyboard's place; a tap
 * on the line brings the keyboard back). Typed shortcuts still work. Pull it
 * up for a full-screen editor with notes. It stays mounted (off screen) so the
 * tap on + can focus it right away.
 */
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
  const lists = useStore((s) => s.lists);
  const create = useCreateTask();
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [picked, setPicked] = useState<PropValues>({});
  const [tool, setTool] = useState<Tool | null>(null);
  const [full, setFull] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // A picker button is being pressed: the line losing focus must not close the sheet.
  const keep = useRef(false);
  const suggest = useListSuggest(value, setValue, inputRef as RefObject<HTMLInputElement>);
  const parsed = parseQuick(value);
  const title = parsed.title;
  const typed = !!(parsed.start_date || parsed.deadline_date || parsed.priority || parsed.listQuery);
  useEffect(() => {
    openAddImpl = onOpen;
    return () => {
      openAddImpl = null;
    };
  }, [onOpen]);
  // Each opening starts clean.
  useEffect(() => {
    if (open) return;
    setTool(null);
    setFull(false);
    setPicked({});
    setNotes("");
  }, [open]);
  const base: Partial<Task> = { ...(preset ?? (view.kind === "calendar" ? { start_date: todayKey() } : defaultsForView(view))), ...picked };
  const close = () => {
    inputRef.current?.blur();
    onClose();
  };
  const submit = () => {
    if (!title) return;
    void create(value, { ...base, ...(notes.trim() ? { notes: notes.trim() } : {}) });
    setValue("");
    close();
  };
  const drag = useSheetGesture(ref, { enabled: open, full, onFull: () => setFull(true), onHalf: () => setFull(false), onClose: close });
  const pick = (patch: PropValues) => setPicked((p) => ({ ...p, ...patch }));
  const holdOpen = () => {
    keep.current = true;
    setTimeout(() => (keep.current = false), 350);
  };
  const toolButton = (t: Tool, icon: ReactNode, label: string, set: boolean) => (
    <button
      type="button"
      className={`m-tool ${tool === t ? "is-open" : ""} ${set ? "is-set" : ""}`}
      aria-label={label}
      onPointerDown={holdOpen}
      onClick={() => {
        if (tool === t) {
          setTool(null);
          inputRef.current?.focus();
        } else {
          setTool(t);
          inputRef.current?.blur();
        }
      }}
    >
      {icon}
    </button>
  );
  const backToTyping = () => {
    setTool(null);
    inputRef.current?.focus();
  };
  const today = todayKey();
  const list = lists.find((l) => l.id === base.list_id);
  const when = base.start_date
    ? `${formatDateTime(base.start_date, base.start_time ?? null, today)}${base.end_date ? ` – ${formatDateTime(base.end_date, base.end_time ?? null, today)}` : ""}`
    : "";
  return (
    <>
      <div className={`m-scrim ${open ? "is-open" : ""}`} onClick={close} />
      <div
        ref={ref}
        className={`m-sheet m-add-sheet ${open ? "is-open" : ""} ${full ? "is-full" : ""} ${drag ? "is-pulling" : ""}`}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
        aria-hidden={!open}
      >
        <div className="p-sheet-top">
          {full ? (
            <>
              <button type="button" className="p-top-btn" onClick={close}>
                Cancel
              </button>
              <b className="p-top-title">New Task</b>
              <button type="button" className="p-top-btn is-strong" disabled={!title} onClick={submit}>
                Add
              </button>
            </>
          ) : (
            <div className="m-grabber" onClick={() => setFull(true)}>
              <i />
            </div>
          )}
        </div>
        <div className="p-scroll">
          <div className="m-add-row">
            <input
              ref={inputRef}
              value={value}
              placeholder="What needs doing?"
              enterKeyHint="done"
              autoCapitalize="sentences"
              tabIndex={open ? 0 : -1}
              {...suggest.inputProps}
              onFocus={() => setTool(null)}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (suggest.onKeyDown(e)) return;
                if (e.key === "Enter") submit();
                if (e.key === "Escape") close();
              }}
              onBlur={() => {
                // Closing the keyboard closes an empty sheet (not when a picker takes its place).
                setTimeout(() => {
                  const input = inputRef.current;
                  if (keep.current || !input || document.activeElement === input) return;
                  if (!input.value.trim() && !full && !ref.current?.contains(document.activeElement)) onClose();
                }, 60);
              }}
            />
            {!full && (
              <button type="button" className="m-send" disabled={!title} aria-label="Add" onPointerDown={(e) => e.preventDefault()} onClick={submit}>
                <Icon name="arrowup" size={18} />
              </button>
            )}
          </div>
          {suggest.open ? (
            <SuggestList s={suggest} className="m-suggest" />
          ) : (
            (typed || (!full && !value.trim())) && (
              <div className="m-add-foot">{typed ? <ParsedChips value={value} typedListOnly /> : <span className="qa-hint">tomorrow 14:00 · ^fri deadline · !high · #list</span>}</div>
            )
          )}
          {full && <textarea className="m-add-notes" rows={4} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} onFocus={() => setTool(null)} />}
          <div className="m-tools">
            {toolButton("date", <Icon name="calendar" size={20} />, "Date", !!base.start_date)}
            {toolButton("deadline", <Icon name="deadline" size={20} />, "Deadline", !!base.deadline_date)}
            {toolButton("priority", <Flag priority={base.priority ?? 0} size={20} />, "Priority", !!base.priority)}
            {toolButton("list", list ? <i className="dot m-tool-dot" style={{ background: list.color }} /> : <Icon name="inbox" size={20} />, "List", !!picked.list_id)}
            <span className="m-tools-value">{tool === "list" ? list?.name ?? "Inbox" : when}</span>
            {!full && (
              <button type="button" className="m-tool" aria-label="Full screen" onPointerDown={holdOpen} onClick={() => setFull(true)}>
                <Icon name="expand" size={18} />
              </button>
            )}
          </div>
          {tool && (
            <div className="m-add-picker">
              {tool === "date" && <SpanPicker v={base} onChange={pick} />}
              {tool === "deadline" && (
                <DayPicker
                  date={base.deadline_date ?? null}
                  time={base.deadline_time ?? null}
                  clearLabel="Remove deadline"
                  onChange={(d, t) => pick({ deadline_date: d, deadline_time: d ? t : null })}
                />
              )}
              {tool === "priority" && (
                <PriorityChoice
                  value={base.priority ?? 0}
                  onPick={(p) => {
                    pick({ priority: p });
                    backToTyping();
                  }}
                />
              )}
              {tool === "list" && (
                <ListChoice
                  value={base.list_id ?? null}
                  onPick={(id) => {
                    pick({ list_id: id, section_id: null });
                    backToTyping();
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const LIFT_MS = 380;
// Native hold did not answer (no lift seen) by then: the page's own menu and drag take over.
const FALLBACK_MS = 900;
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
 * Touch gestures for the phone.
 * - Tasks in the iOS app: the system handles holding them (lift, menu, drag;
 *   see lib/nativeMenu.ts); the page only reports which task is under the
 *   finger, and drives the drag it reports.
 * - Elsewhere (and in a browser): hold an item and it lifts; move while
 *   holding to drag a task, let go to open its menu.
 * - Hold a calendar day: add a task on it; hold and move across days: add one spanning them.
 */
export function useTouchGestures() {
  useEffect(() => {
    if (!isMobile) return;
    let liftTimer = 0;
    let el: HTMLElement | null = null;
    let start = { x: 0, y: 0 };
    let startedAt = 0;
    let armed = false;
    let drag: DragDriver | null = null;
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
    const onStart = (e: TouchEvent) => {
      reset();
      if (e.touches.length !== 1 || isLifted()) return;
      const target = e.target as HTMLElement;
      const item = target.closest("input, textarea, [contenteditable='true'], .check") ? null : target.closest<HTMLElement>(LONG_PRESS);
      const native = hasNative() && !!item?.matches(TASK_ITEM);
      // Tell the native side what is under the finger (or that nothing is).
      reportTouch(native ? item : null, native && item!.matches(DRAGGABLE));
      if (!item) return;
      el = item;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      startedAt = Date.now();
      liftTimer = window.setTimeout(
        () => {
          // The native hold took over: nothing to do here.
          if (native && liftedSince(startedAt)) return void (el = null);
          armed = true;
          el?.classList.add("is-lifted");
          haptic("medium");
        },
        native ? FALLBACK_MS : LIFT_MS,
      );
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
        if (el.matches(".cal-cell") && el.dataset.day) openAddSheet({ start_date: el.dataset.day });
        else openWebMenu(el);
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
      if (Date.now() < swallowClickUntil || isLifted()) {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "click") swallowClickUntil = 0;
      }
    };
    // A drag the native side started (out of a held task, or its open menu).
    let native: DragDriver | null = null;
    const offs = [
      onNative("dragStart", (p) => {
        native?.cancel();
        native = dragDriver(String(p.id ?? ""), null);
      }),
      onNative("dragMove", (p) => native?.move(Number(p.x), Number(p.y))),
      onNative("dragDrop", (p) => {
        native?.move(Number(p.x), Number(p.y));
        native?.drop();
        native = null;
        swallowClickUntil = Date.now() + 500;
      }),
      onNative("dragEnd", () => {
        native?.cancel();
        native = null;
      }),
    ];
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onCancel);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousedown", onClick, true);
    return () => {
      offs.forEach((off) => off());
      document.removeEventListener("mousedown", onClick, true);
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
}

interface DragDriver {
  move(x: number, y: number): void;
  drop(): void;
  cancel(): void;
}

/**
 * Drives a drag of task `id` from finger positions (a touch, or what the
 * native side reports): the group under the finger shows where it would land,
 * and near the edges the list (or the board, sideways) scrolls along.
 * `ghost` is the copy that follows a touch drag (the native drag draws its own).
 */
function dragDriver(id: string, ghost: { el: HTMLElement; from: { x: number; y: number } } | null): DragDriver {
  const sources = [...document.querySelectorAll<HTMLElement>(`:is(.task-row, .card)[data-id="${CSS.escape(id)}"]`)];
  sources.forEach((s) => s.classList.add("is-dragging"));
  document.documentElement.classList.add("is-touch-dragging");
  let last: { x: number; y: number } | null = null;
  let group: Element | null = null;
  let raf = 0;
  let done = false;

  const send = (name: "vitro:touchover" | "vitro:touchdrop", target: Element) =>
    last && target.dispatchEvent(new CustomEvent<TouchDragDetail>(name, { detail: { id, y: last.y } }));
  const hover = () => {
    if (!last) return;
    const under = document.elementFromPoint(last.x, last.y)?.closest("[data-drop-group]") ?? null;
    // Gaps between groups keep the last group, so its line does not blink.
    if (under) group = under;
    if (group) send("vitro:touchover", group);
  };
  const barTop = document.querySelector(".m-tabs")?.getBoundingClientRect().top ?? innerHeight;
  const speed = (depth: number) => Math.round(Math.min(14, Math.max(2, (depth / 52) * 14)));
  const tick = () => {
    if (last) {
      const at = document.elementFromPoint(last.x, last.y);
      const scroller = at?.closest<HTMLElement>(".list-view, .column-body, .m-day-list");
      const sc = scroller?.getBoundingClientRect();
      if (scroller && sc) {
        const bottom = Math.min(sc.bottom, barTop - 8);
        if (last.y < sc.top + 52) scroller.scrollTop -= speed(sc.top + 52 - last.y);
        else if (last.y > bottom - 52) scroller.scrollTop += speed(last.y - bottom + 52);
      }
      const board = at?.closest<HTMLElement>(".kanban");
      const bc = board?.getBoundingClientRect();
      if (board && bc) {
        if (last.x < bc.left + 36) board.scrollLeft -= 8;
        else if (last.x > bc.right - 36) board.scrollLeft += 8;
      }
      hover();
    }
    raf = requestAnimationFrame(tick);
  };
  const place = () => {
    if (ghost && last) ghost.el.style.transform = `translate(${last.x - ghost.from.x}px, ${last.y - ghost.from.y}px) scale(1.02)`;
  };
  const end = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    ghost?.el.remove();
    sources.forEach((s) => s.classList.remove("is-dragging"));
    // Rows React redrew meanwhile.
    document.querySelectorAll(":is(.task-row, .card).is-dragging").forEach((s) => s.classList.remove("is-dragging"));
    document.documentElement.classList.remove("is-touch-dragging");
    useStore.getState().setDropHint(null);
  };
  raf = requestAnimationFrame(tick);
  return {
    move(x: number, y: number) {
      last = { x, y };
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

/** Touch drag (page side): a copy of the item follows the finger. */
function startDrag(el: HTMLElement, id: string, from: { x: number; y: number }, x: number, y: number) {
  const r = el.getBoundingClientRect();
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.classList.add("drag-ghost");
  ghost.classList.remove("is-selected", "is-lifted");
  ghost.removeAttribute("data-id");
  Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  // Inside the app, so the copy keeps the narrow layout of the row.
  (el.closest(".app") ?? document.body).appendChild(ghost);
  const driver = dragDriver(id, { el: ghost, from });
  driver.move(x, y);
  return driver;
}

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
        className={`m-task-sheet ${full ? "is-full" : ""} ${closing ? "is-closing" : ""} ${drag ? "is-pulling" : ""}`}
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
