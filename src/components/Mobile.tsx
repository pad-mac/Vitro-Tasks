// Phone layout pieces: the bottom bar, the add sheet, and touch gestures
// (long press for the menu, long press and drag to reorder).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { haptic, isMobile } from "../lib/platform";
import { hasNative, onNative, postNative } from "../lib/native";
import { setBackdropRising } from "../lib/backdrop";
import { holdMenu, hideTask, taskRect } from "./HoldMenu";
import { parseQuick } from "../lib/quickparse";
import { isTyping } from "../lib/shortcuts";
import { PRIORITY_LABELS, defaultsForView } from "../lib/views";
import { ParsedChips } from "../QuickAdd";
import { formatDateTime, todayKey } from "../lib/dates";
import type { Task } from "../shared/schema";
import { useStore } from "../store";
import { SuggestList, useListSuggest } from "./ListSuggest";
import { useCreateTask, type TouchDragDetail } from "./tasks";
import { DayPicker, ListChoice, SpanPicker, useSheetGesture, type PropValues } from "./PhonePickers";
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
  onCloseSettings,
  onAdd,
}: {
  settingsOpen: boolean;
  hidden: boolean;
  onCloseSettings: () => void;
  onAdd: () => void;
}) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const lastTaskView = useStore((s) => s.lastTaskView);
  const inCalendar = view.kind === "calendar";
  const active = inCalendar ? "calendar" : "tasks";
  const tabs = {
    tasks: () => {
      holdMenu.close();
      onCloseSettings();
      setView(lastTaskView);
    },
    calendar: () => {
      holdMenu.close();
      onCloseSettings();
      setView({ kind: "calendar" });
    },
  };
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  useEffect(
    () =>
      onNative("tab", (p) => {
        holdMenu.close();
        tabsRef.current[p.id as keyof typeof tabs]?.();
      }),
    [],
  );
  // Settings (opened from the sidebar) show only a round back button, bottom left: no tabs, no +.
  useEffect(() => postNative({ type: "bar", visible: !hidden, active, back: settingsOpen }), [hidden, active, settingsOpen]);
  const press = (down: boolean) => () => postNative({ type: "press", down });
  const pressProps = { onTouchStart: press(true), onTouchEnd: press(false), onTouchCancel: press(false) };
  return (
    <nav className={`m-bar ${hidden ? "is-hidden" : ""} ${settingsOpen ? "is-back" : ""}`} aria-hidden={hidden}>
      {settingsOpen ? (
        <button type="button" className="m-back" aria-label="Back" onClick={onCloseSettings} {...pressProps}>
          <Icon name="chevron" size={22} />
        </button>
      ) : (
        <>
          <div className="m-tabs">
            <button type="button" className={active === "tasks" ? "is-active" : ""} onClick={tabs.tasks}>
              <Icon name="tasks" size={21} />
              <span>Tasks</span>
            </button>
            <button type="button" className={active === "calendar" ? "is-active" : ""} onClick={tabs.calendar}>
              <Icon name="calendar" size={21} />
              <span>Calendar</span>
            </button>
          </div>
          {/* Focus has to happen inside the tap itself, or iOS keeps the keyboard closed. */}
          <button type="button" className="m-add pearl" aria-label="Add task" onClick={onAdd} {...pressProps}>
            <Icon name="plus" size={24} />
          </button>
        </>
      )}
    </nav>
  );
}

let openAddImpl: ((base: Partial<Task> | null) => void) | null = null;

/** Opens the add sheet with defaults (call it from a touch or click handler, so the keyboard comes up). */
export function openAddSheet(base: Partial<Task> | null = null) {
  openAddImpl?.(base);
}

type Tool = "date" | "deadline" | "priority" | "list";

// The task sheet opens its next task at full screen (the quick add, pulled up, hands over to it).
let sheetFullNext: string | null = null;
// A task the quick add made for the editor: dropped again if it is left empty.
let draftTask: string | null = null;

/** Opens a task in the editor at full screen, its title ready for typing. */
export function openEditorFull(id: string, draft = false) {
  sheetFullNext = id;
  if (draft) draftTask = id;
  useStore.getState().select(id);
}

/** Keeps the keyboard up: the press must not take focus from the line being typed in. */
const keepFocus = {
  onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
  onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
};

/**
 * The add sheet: a line to type into, with buttons for date, deadline,
 * priority and list below it. Priority and list open as a small menu above
 * the buttons, with the keyboard still up; date and deadline take the
 * keyboard's place (a tap on the line brings it back). Typed shortcuts still
 * work. Pulled up (or with the expand button) the task moves on to the full
 * editor. It stays mounted (off screen) so the tap on + can focus it right away.
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
  const [picked, setPicked] = useState<PropValues>({});
  const [tool, setTool] = useState<Tool | null>(null);
  // The small menu for priority or list, placed above its button.
  const [float, setFloat] = useState<{ kind: "priority" | "list"; left: number; bottom: number } | null>(null);
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
    setFloat(null);
    setPicked({});
  }, [open]);
  // In the iOS app the keyboard shortens the web view a moment after the sheet starts to rise: what had
  // risen then went below the new bottom edge and the sheet seemed to start again from lower. It waits
  // for the keyboard (or a moment) and rises once, from where the keyboard will end. Meanwhile the colour
  // behind the keyboard stays the page's (`is-rising`), so the gap the keyboard slides into does not switch colour.
  const [risen, setRisen] = useState(false);
  const [rising, setRising] = useState(false);
  useLayoutEffect(() => {
    if (!open) {
      setRisen(false);
      setRising(false);
      setBackdropRising(false);
      return;
    }
    if (!hasNative() || document.documentElement.classList.contains("kb-up")) {
      setRisen(true);
      return;
    }
    const h0 = innerHeight;
    let done = 0;
    setBackdropRising(true);
    const go = (keyboard: boolean) => {
      stop();
      flushSync(() => {
        setRisen(true);
        setRising(keyboard);
      });
      if (!keyboard) return setBackdropRising(false);
      done = window.setTimeout(() => {
        setRising(false);
        setBackdropRising(false);
      }, 320);
    };
    const onResize = () => innerHeight < h0 - 120 && go(true);
    // No keyboard coming (a hardware keyboard): it opens anyway. The first keyboard after launch can be slow.
    const wait = window.setTimeout(() => go(false), 300);
    window.addEventListener("resize", onResize);
    const stop = () => {
      clearTimeout(wait);
      window.removeEventListener("resize", onResize);
    };
    return () => {
      stop();
      clearTimeout(done);
    };
  }, [open]);
  const base: Partial<Task> = { ...(preset ?? (view.kind === "calendar" ? { start_date: todayKey() } : defaultsForView(view))), ...picked };
  const close = () => {
    inputRef.current?.blur();
    onClose();
  };
  const submit = () => {
    if (!title) return;
    void create(value, base);
    setValue("");
    close();
  };
  // On to the full editor with what is typed so far (the keyboard stays: its title takes over the focus).
  const expand = async () => {
    keep.current = true;
    const made = title ? await create(value, base) : await useStore.getState().addTask({ ...base, title: "" } as Partial<Task> & { title: string });
    if (!made) return;
    openEditorFull(made.id, true);
    setValue("");
    setPicked({});
    setTool(null);
    setFloat(null);
    onClose();
    // The editor's title takes the focus (and the keyboard) if iOS lets it; otherwise this line must not keep it while hidden.
    setTimeout(() => {
      keep.current = false;
      if (document.activeElement === inputRef.current) inputRef.current?.blur();
    }, 250);
  };
  const drag = useSheetGesture(ref, { enabled: open, full: false, onFull: () => void expand(), onHalf: () => {}, onClose: close });
  const pick = (patch: PropValues) => setPicked((p) => ({ ...p, ...patch }));
  const holdOpen = () => {
    keep.current = true;
    setTimeout(() => (keep.current = false), 350);
  };
  const toolButton = (t: Tool, icon: ReactNode, label: string, set: boolean, extra = "") => (
    <button
      type="button"
      className={`m-tool ${extra} ${tool === t || float?.kind === t ? "is-open" : ""} ${set ? "is-set" : ""}`}
      aria-label={label}
      onPointerDown={(e) => {
        holdOpen();
        // Priority and list keep the keyboard; their menu opens over the sheet.
        if (t === "priority" || t === "list") e.preventDefault();
      }}
      onMouseDown={(e) => (t === "priority" || t === "list") && e.preventDefault()}
      onClick={(e) => {
        if (t === "priority" || t === "list") {
          if (float?.kind === t) return setFloat(null);
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setTool(null);
          setFloat({ kind: t, left: r.left, bottom: innerHeight - r.top + 8 });
          inputRef.current?.focus();
          return;
        }
        setFloat(null);
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
        className={`m-sheet m-add-sheet ${open && risen ? "is-open" : ""} ${rising ? "is-rising" : ""} ${drag ? "is-pulling" : ""}`}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
        aria-hidden={!open}
      >
        <div className="p-sheet-top">
          <div className="m-grabber" {...keepFocus} onClick={() => void expand()}>
            <i />
          </div>
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
                  if (!input.value.trim() && !ref.current?.contains(document.activeElement)) onClose();
                }, 60);
              }}
            />
            <button type="button" className="m-send" disabled={!title} aria-label="Add" {...keepFocus} onClick={submit}>
              <Icon name="arrowup" size={18} />
            </button>
          </div>
          {suggest.open ? (
            <SuggestList s={suggest} className="m-suggest" />
          ) : (
            typed && (
              <div className="m-add-foot">
                <ParsedChips value={value} typedListOnly />
              </div>
            )
          )}
          <div className="m-tools">
            {toolButton("date", <Icon name="calendar" size={20} />, "Date", !!base.start_date)}
            {toolButton("deadline", <Icon name="deadline" size={20} />, "Deadline", !!base.deadline_date)}
            {toolButton("priority", <Flag priority={base.priority ?? 0} size={20} />, "Priority", !!base.priority)}
            {toolButton(
              "list",
              <>
                {list ? <i className="dot m-tool-dot" style={{ background: list.color }} /> : <Icon name="inbox" size={18} />}
                <span className="m-tool-name">{list?.name ?? "Inbox"}</span>
              </>,
              "List",
              !!picked.list_id,
              "is-wide",
            )}
            <span className="m-tools-value">{when}</span>
            <button type="button" className="m-tool" aria-label="Full screen" {...keepFocus} onClick={() => void expand()}>
              <Icon name="expand" size={18} />
            </button>
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
            </div>
          )}
        </div>
      </div>
      {float && open && (
        <>
          <div className="m-float-catch" {...keepFocus} onClick={() => setFloat(null)} />
          <div
            className="m-float"
            style={{ left: Math.max(12, Math.min(float.left - 8, innerWidth - 12 - 248)), bottom: float.bottom, maxHeight: Math.max(160, innerHeight - float.bottom - 56) }}
            {...keepFocus}
          >
            {float.kind === "priority" ? (
              [3, 2, 1, 0].map((p) => (
                <button
                  type="button"
                  key={p}
                  className={`m-float-row ${(base.priority ?? 0) === p ? "is-on" : ""}`}
                  onClick={() => {
                    pick({ priority: p });
                    setFloat(null);
                    backToTyping();
                  }}
                >
                  <Flag priority={p} size={18} />
                  <span>{p ? `${PRIORITY_LABELS[p]} Priority` : "No Priority"}</span>
                  {(base.priority ?? 0) === p && <Icon name="check" size={16} />}
                </button>
              ))
            ) : (
              <ListChoice
                value={base.list_id ?? null}
                onPick={(id) => {
                  pick({ list_id: id, section_id: null });
                  setFloat(null);
                  backToTyping();
                }}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}

const LIFT_MS = 380;
// A held task whose menu needs room it has to make: the menu waits this long for the finger to rest.
const REVEAL_MS = 220;
// How far off the menu the finger may stray (while sliding over it) before the task is dragged instead.
const OFF_MENU = 4;
const SLOP = 8;
// Subtasks are held (menu, reorder) in the full-screen editor.
const SHEET_SUB = ".m-task-sheet.is-full .subtask[data-id]";
const LONG_PRESS = `.task-row, .card, .cal-chip, .nav-row, .tl-item, .tl-title, .m-week .cal-cell, ${SHEET_SUB}`;
const DRAGGABLE = `.task-row[data-depth="0"], .card, ${SHEET_SUB}`;
// Items that get the task menu.
const TASK_ITEM = `.task-row[data-id], .card[data-id], .cal-chip[data-id], .tl-item[data-id], ${SHEET_SUB}`;

/** The app's own menu for a held list (or other item): below it. */
function openWebMenu(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 12, clientY: r.bottom + 4 }));
}

export interface DayRange {
  a: string;
  b: string;
}

/**
 * Touch gestures for the phone.
 * - Hold a task: it lifts and its menu opens (HoldMenu). With the finger
 *   still down, sliding onto the menu picks an entry on release; moving any
 *   other way drags the task instead. After letting go the menu stays; tap an
 *   entry, or press the lifted task and move it to drag it.
 * - Hold a list (or another item): it lifts, its menu opens on release.
 * - Hold a calendar day: add a task on it; hold and move across days: add one spanning them.
 */
export function useTouchGestures() {
  useEffect(() => {
    if (!isMobile) return;
    let liftTimer = 0;
    let revealTimer = 0;
    let el: HTMLElement | null = null;
    let start = { x: 0, y: 0 };
    let armed = false;
    // A task is held with the finger still down: "wait" until the finger says
    // what it wants, "select" once it slid onto the menu.
    let held: { draggable: boolean; mode: "wait" | "select"; at: { x: number; y: number } } | null = null;
    // The finger pressed the lifted task while its menu was open.
    let liftPress: { x: number; y: number } | null = null;
    let drag: DragDriver | null = null;
    let range: DayRange | null = null;
    let swallowClickUntil = 0;

    const reset = () => {
      clearTimeout(liftTimer);
      clearTimeout(revealTimer);
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
    /** The held task becomes a drag. `keep`: the copy stays where it is under the finger. */
    const dragHeld = (from: { x: number; y: number }, x: number, y: number, keep: boolean) => {
      const d = holdMenu.toDrag();
      if (!d) return;
      drag = dragCopy(d.el, d.id, from, keep ? d.shift : 0, x, y);
    };
    const onStart = (e: TouchEvent) => {
      reset();
      held = null;
      liftPress = null;
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement;
      const p = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      if (holdMenu.isOpen()) {
        if (target.closest(".hold-lift")) liftPress = p;
        else if (!target.closest(".hold-menu")) {
          // A touch anywhere else closes the menu (and is not a tap on what lies under it).
          holdMenu.close();
          swallowClickUntil = Date.now() + 600;
        }
        return;
      }
      const item = target.closest("input, textarea, [contenteditable='true'], .check, .fold, .sel-group") ? null : target.closest<HTMLElement>(LONG_PRESS);
      if (!item) return;
      // Select mode: a hold is a tap. A subtask is not held while the keyboard is up (the editor would shift under the menu).
      if (useStore.getState().selecting && item.matches(TASK_ITEM)) return;
      if (item.matches(SHEET_SUB) && isTyping(document.activeElement)) return;
      el = item;
      start = p;
      liftTimer = window.setTimeout(() => {
        if (!el) return;
        if (el.matches(TASK_ITEM)) {
          held = { draggable: el.matches(DRAGGABLE), mode: "wait", at: start };
          holdMenu.open(el);
          el = null;
          // A menu that needs the task moved aside comes out once the finger rests (moving first drags).
          revealTimer = window.setTimeout(() => holdMenu.reveal(), REVEAL_MS);
          return;
        }
        armed = true;
        el.classList.add("is-lifted");
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
      if (liftPress) {
        e.preventDefault();
        if (Math.hypot(t.clientX - liftPress.x, t.clientY - liftPress.y) > SLOP) {
          dragHeld(liftPress, t.clientX, t.clientY, true);
          liftPress = null;
        }
        return;
      }
      if (held) {
        e.preventDefault();
        if (held.mode === "select") {
          const key = holdMenu.itemAt(t.clientX, t.clientY);
          // Slid off the menu again (back over the task, or past its side): now it drags.
          if (!key && held.draggable && !holdMenu.inMenu(t.clientX, t.clientY, OFF_MENU)) {
            dragHeld(held.at, t.clientX, t.clientY, false);
            held = null;
            return;
          }
          return holdMenu.setHot(key);
        }
        const dx = t.clientX - held.at.x;
        const dy = t.clientY - held.at.y;
        // Not moved yet: nothing under the resting finger counts (the menu may have opened under it).
        if (Math.hypot(dx, dy) <= SLOP) return;
        if (holdMenu.isWaiting()) {
          clearTimeout(revealTimer);
          if (held.draggable) dragHeld(held.at, t.clientX, t.clientY, false);
          else holdMenu.reveal();
          if (held.draggable) held = null;
          return;
        }
        const key = holdMenu.itemAt(t.clientX, t.clientY);
        // Anywhere off the menu (also the gap between it and the task), a move that does not head into it drags.
        if (key || !held.draggable || holdMenu.inMenu(t.clientX, t.clientY) || holdMenu.toward(held.at, dx, dy)) {
          if (key) {
            held.mode = "select";
            holdMenu.setHot(key);
          }
          return;
        }
        dragHeld(held.at, t.clientX, t.clientY, false);
        held = null;
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
      if (el.matches(".cal-cell") && el.dataset.day) {
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
      } else if (liftPress) {
        // A tap on the lifted task opens it.
        const id = holdMenu.heldId();
        holdMenu.close();
        if (id) useStore.getState().select(id);
        swallowClickUntil = Date.now() + 500;
      } else if (held) {
        holdMenu.reveal();
        const key = held.mode === "select" ? holdMenu.hot() : null;
        // Let go on an entry: pick it. Anywhere else the menu stays open.
        if (key) holdMenu.act(key);
        else holdMenu.setHot(null);
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
      held = null;
      liftPress = null;
      reset();
    };
    const onCancel = () => {
      drag?.cancel();
      drag = null;
      if (range) {
        range = null;
        showRange();
      }
      if (held) holdMenu.setHot(null);
      held = null;
      liftPress = null;
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

interface DragDriver {
  move(x: number, y: number): void;
  drop(): void;
  cancel(): void;
}

/**
 * Drives a touch drag of task `id`: `copy` follows the finger (offset by
 * `shift` px from where it was taken), the group under the finger shows where
 * it would land, and near the edges the list (or the board, sideways) scrolls
 * along. On the drop the copy glides into the task's new place.
 */
function dragCopy(copy: HTMLElement, id: string, from: { x: number; y: number }, shift: number, x: number, y: number): DragDriver {
  const sources = [...document.querySelectorAll<HTMLElement>(`:is(.task-row, .card, .subtask)[data-id="${CSS.escape(id)}"]`)];
  sources.forEach((s) => s.classList.add("is-dragging"));
  document.documentElement.classList.add("is-touch-dragging");
  copy.classList.add("drag-ghost", "is-catching");
  setTimeout(() => copy.classList.remove("is-catching"), 140);
  const origin = { left: parseFloat(copy.style.left), top: parseFloat(copy.style.top) };
  let last: { x: number; y: number } | null = null;
  let group: Element | null = null;
  let raf = 0;
  let done = false;

  const send = (name: "vitro:touchover" | "vitro:touchdrop", target: Element) =>
    last && target.dispatchEvent(new CustomEvent<TouchDragDetail>(name, { detail: { id, y: last.y } }));
  const hover = () => {
    if (!last) return;
    const under = document.elementFromPoint(last.x, last.y)?.closest("[data-drop-group]") ?? null;
    // Gaps between groups keep the last group, so its line does not blink; another
    // group takes over only once the finger is clearly inside it (no flicker on the border).
    if (under && under !== group) {
      const r = under.getBoundingClientRect();
      const depth = Math.min(last.y - r.top, r.bottom - last.y, last.x - r.left, r.right - last.x);
      if (!group?.isConnected || depth > 14) group = under;
    }
    if (group) send("vitro:touchover", group);
  };
  const barTop = document.querySelector(".m-bar:not(.is-hidden) .m-tabs")?.getBoundingClientRect().top ?? innerHeight;
  const speed = (depth: number) => Math.round(Math.min(14, Math.max(2, (depth / 52) * 14)));
  const tick = () => {
    if (last) {
      const at = document.elementFromPoint(last.x, last.y);
      const scroller = at?.closest<HTMLElement>(".list-view, .column-body, .m-day-list, .detail-body");
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
    if (last) copy.style.transform = `translate(${last.x - from.x}px, ${last.y - from.y + shift}px) scale(1.02)`;
  };
  const clear = () => {
    sources.forEach((s) => s.classList.remove("is-dragging"));
    // Rows React redrew meanwhile.
    document.querySelectorAll(":is(.task-row, .card, .subtask).is-dragging").forEach((s) => s.classList.remove("is-dragging"));
    document.documentElement.classList.remove("is-touch-dragging");
    useStore.getState().setDropHint(null);
  };
  const end = (glide: boolean) => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    clear();
    if (!glide) return void copy.remove();
    // The task stays hidden until the copy has landed where it is now.
    hideTask(id);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      copy.remove();
      if (!holdMenu.heldId()) hideTask(null);
    };
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const r = taskRect(id);
        copy.classList.add("is-landing");
        if (r) copy.style.transform = `translate(${r.left - origin.left}px, ${r.top - origin.top}px)`;
        else copy.style.opacity = "0";
        setTimeout(finish, 190);
      }),
    );
    setTimeout(finish, 600);
  };
  raf = requestAnimationFrame(tick);
  last = { x, y };
  place();
  return {
    move(x: number, y: number) {
      last = { x, y };
      place();
    },
    drop() {
      hover();
      if (group) send("vitro:touchdrop", group);
      end(true);
    },
    cancel: () => end(false),
  };
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
    // Also in the calendar. A finger that rests first (holding a day to drag a range) is no swipe.
    let start: { x: number; y: number; t: number; moved: boolean; open: boolean } | null = null;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      const st = useStore.getState();
      if (e.touches.length !== 1 || st.selectedId || holdMenu.isOpen()) return;
      if (st.drawerOpen || t.clientX < 24) start = { x: t.clientX, y: t.clientY, t: Date.now(), moved: false, open: st.drawerOpen };
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!start.moved) {
        // Moving only after resting is a hold (a day range, a task): not the sidebar.
        if (Date.now() - start.t > 260) {
          start = null;
          return;
        }
        if (Math.hypot(dx, dy) < 6) return;
        start.moved = true;
      }
      if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) {
        start = null;
        return;
      }
      const st = useStore.getState();
      // On a page over the lists (settings) the swipe goes back, as everywhere on iOS; it never opens the lists under it.
      if (!start.open && dx > 44 && document.querySelector(".modal-overlay, .modal")) {
        window.dispatchEvent(new CustomEvent("vitro:back"));
        haptic("light");
        start = null;
      } else if (!start.open && dx > 44) {
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
 * full-screen editing, pull it down (or tap above it) to close it. A long
 * pull down from full screen closes it too. The sheet only ever moves by
 * transform: switching between the two heights keeps it where the finger
 * left it and glides from there.
 */
export function MobileTaskSheet({ task }: { task: Task | null }) {
  const select = useStore((s) => s.select);
  const [shown, closing] = usePresence(task, 220);
  const [full, setFull] = useState(false);
  const [typing, setTyping] = useState(false);
  // Half open, writing makes the sheet taller and stopping makes it shorter again: it glides, no jump.
  const lastHeight = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const was = lastHeight.current;
    lastHeight.current = h;
    if (!full && was && Math.abs(was - h) > 20) el.animate([{ height: `${was}px` }, { height: `${h}px` }], { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  }, [typing]);
  // The height as last laid out (the keyboard changes it too), read before the next change shows.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => (lastHeight.current = el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Half open and not writing, the editor is a preview from its top (the title is in the scrolling body).
  useEffect(() => {
    const body = ref.current?.querySelector<HTMLElement>(".detail-body");
    if (body && !full && !typing) body.scrollTop = 0;
  }, [full, typing]);
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    y: number;
    x: number;
    lastY: number;
    lastT: number;
    v: number;
    active: boolean;
    keyboard?: boolean;
    scroller?: HTMLElement | null;
  } | null>(null);
  const id = task?.id ?? null;
  // A new task opens half (or full, when the quick add handed it over: its title then takes the keyboard).
  const prevId = useRef<string | null>(null);
  useLayoutEffect(() => {
    const prev = prevId.current;
    prevId.current = id;
    if (id) {
      const wantFull = sheetFullNext === id;
      sheetFullNext = null;
      // From one task to another inside the open sheet (a subtask opened, back to its parent): full stays full.
      setFull((f) => wantFull || (!!prev && f));
      if (wantFull)
        requestAnimationFrame(() => {
          const t = ref.current?.querySelector<HTMLTextAreaElement>("textarea.detail-title");
          t?.focus();
          t?.setSelectionRange(t.value.length, t.value.length);
        });
    }
    // Left the task the quick add made for the editor: drop it if nothing was written (after its text is saved).
    if (prev && prev !== id && prev === draftTask) {
      draftTask = null;
      setTimeout(() => {
        const st = useStore.getState();
        const t = st.tasks.find((x) => x.id === prev);
        if (t && !t.title.trim() && !t.notes?.trim() && !st.tasks.some((c) => c.parent_id === prev)) void st.deleteTask(prev);
      }, 800);
    }
  }, [id]);
  // While the sheet follows the finger, nothing under it scrolls (React's touch handlers cannot prevent that).
  const mounted = !!shown;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hold = (e: TouchEvent) => {
      if (gesture.current?.active) e.preventDefault();
    };
    el.addEventListener("touchmove", hold, { passive: false });
    return () => el.removeEventListener("touchmove", hold);
  }, [mounted]);
  if (!shown) return null;

  /** Settles the sheet at `next` (a height, or closed), starting from where it is drawn now. */
  const glide = (next: boolean | "close") => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("is-pulling");
    if (next === "close") {
      el.style.transition = "transform 190ms cubic-bezier(0.2, 0.7, 0.3, 1)";
      el.style.transform = "translateY(100%)";
      select(null);
      return;
    }
    const from = el.getBoundingClientRect().top;
    flushSync(() => setFull(next));
    el.style.transition = "none";
    el.style.transform = "";
    const natural = el.getBoundingClientRect().top;
    el.style.transform = `translateY(${from - natural}px)`;
    void el.offsetHeight;
    el.style.transition = "";
    el.style.transform = "";
  };
  const onTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    gesture.current = null;
    if (target.closest(".floating, .pop-panel") || holdMenu.isOpen()) return;
    // A field being written in keeps its touches (caret, selection); a field not in use can be pulled like the rest.
    const field = target.closest<HTMLElement>("input, textarea, [contenteditable='true'], .rich-view");
    const active = document.activeElement;
    if (field && active && (field === active || field.contains(active))) return;
    const inHead = !!target.closest(".m-grabber, .detail-head, .detail-bar");
    const t = e.touches[0];
    // Writing: a swipe down on the rows above the keyboard puts the keyboard away first.
    if (typing && inHead) {
      gesture.current = { x: t.clientX, y: t.clientY, lastY: t.clientY, lastT: Date.now(), v: 0, active: false, keyboard: true };
      return;
    }
    // A part that scrolls (a long description, many subtasks) keeps its moves, except a pull down from its top.
    // (Half open, a part only scrolls while being written in; otherwise it is a cut preview the sheet is pulled by.)
    const sec = target.closest<HTMLElement>(".detail-body");
    const scroller = sec && sec.scrollHeight > sec.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(sec).overflowY) ? sec : null;
    gesture.current = { x: t.clientX, y: t.clientY, lastY: t.clientY, lastT: Date.now(), v: 0, active: false, scroller };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    const el = ref.current;
    if (!g || !el) return;
    // A held or dragged subtask has the finger now.
    if (holdMenu.isOpen() || document.documentElement.classList.contains("is-touch-dragging")) {
      if (g.active) glide(full);
      gesture.current = null;
      return;
    }
    const t = e.touches[0];
    const dy = t.clientY - g.y;
    if (g.keyboard) {
      if (dy > 18 && dy > Math.abs(t.clientX - g.x)) {
        (document.activeElement as HTMLElement | null)?.blur();
        gesture.current = null;
      }
      return;
    }
    if (!g.active) {
      if (Math.abs(dy) < 8) return;
      if (Math.abs(t.clientX - g.x) > Math.abs(dy)) {
        gesture.current = null;
        return;
      }
      // Full screen: up is nothing to the sheet; a scrolled part scrolls.
      if ((full && dy < 0) || (g.scroller && (dy < 0 || g.scroller.scrollTop > 0))) {
        gesture.current = null;
        return;
      }
      g.active = true;
      el.classList.add("is-pulling");
    }
    const now = Date.now();
    g.v = (t.clientY - g.lastY) / Math.max(1, now - g.lastT);
    g.lastY = t.clientY;
    g.lastT = now;
    // Pulling past full height meets resistance.
    el.style.transform = `translateY(${full ? Math.max(0, dy) : dy < 0 ? dy * 0.6 : dy}px)`;
  };
  const onTouchEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.active) return;
    const dy = g.lastY - g.y;
    if (!full) {
      if (dy < -50 || g.v < -0.5) {
        haptic("light");
        glide(true);
      } else if (dy > 80 || g.v > 0.6) glide("close");
      else glide(false);
    } else if (dy > innerHeight * 0.5 || (dy > 140 && g.v > 1.1)) glide("close");
    else if (dy > 90 || g.v > 0.6) glide(false);
    else glide(true);
  };
  const editing = (el: EventTarget | null) => !!(el as HTMLElement | null)?.closest?.("input, textarea, [contenteditable='true']");

  return (
    <>
      <div className={`m-scrim m-task-scrim ${closing ? "" : "is-open"}`} onClick={() => select(null)} />
      <div
        ref={ref}
        className={`m-task-sheet ${full ? "is-full" : ""} ${typing ? "is-typing" : ""} ${closing ? "is-closing" : ""}`}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onFocusCapture={(e) => editing(e.target) && setTyping(true)}
        onBlurCapture={() => setTimeout(() => setTyping(editing(document.activeElement) && !!ref.current?.contains(document.activeElement)), 50)}
      >
        <div className="m-grabber" onClick={() => glide(!full)}>
          <i />
        </div>
        <TaskDetail key={shown.id} task={shown} variant="sheet" full={full} />
      </div>
    </>
  );
}
