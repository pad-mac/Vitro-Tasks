// Building blocks shared by the list, board, timeline and calendar views.
import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { deadlineCountdown, formatDateTime, todayKey } from "../lib/dates";
import { matchList, parseQuick } from "../lib/quickparse";
import { subtasksOf } from "../lib/views";
import { haptic, isMobile } from "../lib/platform";
import type { Task } from "../shared/schema";
import { anchorOf, useStore } from "../store";
import { SuggestList, useListSuggest } from "./ListSuggest";
import { Check, Icon, Rich } from "./ui";
import { SelectCircle, selectTap } from "./Select";

export const DRAG_TYPE = "application/x-vitro-task";

let dragging: string | null = null;

/** The task being dragged right now (drag-over events cannot read the payload). */
export const draggedTask = () => dragging;

export function dragProps(taskId: string, payload = "") {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      // Edge handles resize the entry instead of moving it.
      if ((e.target as HTMLElement).closest?.("[data-nodrag]")) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData(DRAG_TYPE, taskId);
      e.dataTransfer.setData("text/plain", payload);
      e.dataTransfer.effectAllowed = "move";
      dragging = taskId;
      const el = e.currentTarget as HTMLElement;
      requestAnimationFrame(() => el.classList.add("is-dragging"));
    },
    onDragEnd: (e: DragEvent) => {
      dragging = null;
      (e.currentTarget as HTMLElement).classList.remove("is-dragging");
      useStore.getState().setDropHint(null);
    },
  };
}

/**
 * Where a task dropped at `clientY` lands among a group's items, and where
 * the line showing it goes (px from the group's top). The dragged task keeps
 * its place while it is dragged (faded, or hidden on the phone): landing
 * there changes nothing, so no line is drawn over it, and lines elsewhere
 * always sit between two neighbours. `prev` (the index shown so far) adds a
 * little stickiness at boundaries, so a resting finger does not make the line
 * jump back and forth.
 */
export function insertionAt(
  container: Element,
  clientY: number,
  draggedId: string,
  selector: string,
  prev?: number,
): { index: number; before: string | null; y: number | null } {
  const all = [...container.querySelectorAll<HTMLElement>(selector)];
  const source = all.findIndex((el) => el.dataset.id === draggedId);
  const items = source >= 0 ? all.filter((_, i) => i !== source) : all;
  const rects = items.map((el) => el.getBoundingClientRect());
  const mids = rects.map((r) => r.top + r.height / 2);
  let index = mids.findIndex((m) => clientY < m);
  if (index === -1) index = items.length;
  // Hysteresis: the line only moves on once the finger is clearly past the middle (no flicker on the edge).
  const STICK = isMobile ? 12 : 6;
  if (prev !== undefined && prev <= items.length) {
    if (index > prev && clientY < mids[index - 1] + STICK) index--;
    else if (index < prev && clientY > mids[index] - STICK) index++;
  }
  const before = items[index]?.dataset.id ?? null;
  if (source >= 0 && index === source) return { index, before, y: null };
  const top = container.getBoundingClientRect().top;
  let y: number;
  if (!rects.length) {
    const empty = container.querySelector(".group-empty, .column-empty, .group-head, .column-head");
    const r = empty?.getBoundingClientRect();
    y = r ? (empty!.matches(".group-head, .column-head") ? r.bottom + 4 : r.top) - top : 6;
  } else if (index === 0) y = rects[0].top - top - 1;
  else if (index < rects.length) y = (blockBottom(items[index - 1], selector) + rects[index].top) / 2 - top;
  else y = blockBottom(items[items.length - 1], selector) - top + 1;
  return { index, before, y };
}

/**
 * Where a task's block ends: its row and the subtask rows shown under it
 * (siblings in a list), so a line between two tasks is never drawn across
 * the first one's subtasks.
 */
function blockBottom(el: HTMLElement, selector: string): number {
  let bottom = el.getBoundingClientRect().bottom;
  for (let n = el.nextElementSibling; n && !n.matches(selector) && n.matches(".task-row"); n = n.nextElementSibling) {
    const r = n.getBoundingClientRect();
    if (r.height) bottom = r.bottom;
  }
  return bottom;
}

// A small tick each time the line moves to a new place (touch drags), never
// faster than the finger can mean it, so a line that hesitates does not buzz.
const lineTick = { key: "", t: 0 };
function tickLine(key: string, shown: boolean) {
  if (!isMobile || key === lineTick.key) return;
  lineTick.key = key;
  const now = performance.now();
  if (!shown || now - lineTick.t < 120) return;
  lineTick.t = now;
  haptic("selection");
}

/** Touch drags (phone) send these to the group under the finger. */
export interface TouchDragDetail {
  id: string;
  y: number;
}

/**
 * Makes a group (list group or board column) a place to reorder tasks in:
 * shows where the task would land and hands the drop to `onDrop` with the
 * index among the group's other tasks. Works for mouse drags and touch drags.
 */
export function useReorderTarget(groupKey: string, selector: string, onDrop: (taskId: string, index: number) => void, enabled = true) {
  const ref = useRef<HTMLElement>(null);
  const setHint = useStore((s) => s.setDropHint);
  const hint = useStore((s) => (s.dropHint?.group === groupKey ? s.dropHint : null));
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const hintAt = (id: string, y: number) => {
    if (!ref.current) return;
    const cur = useStore.getState().dropHint;
    const { index, before, y: lineY } = insertionAt(ref.current, y, id, selector, cur?.group === groupKey ? cur.index : undefined);
    tickLine(`${groupKey}:${lineY === null ? "home" : index}`, lineY !== null);
    setHint({ group: groupKey, before, index, y: lineY });
  };
  const dropAt = (id: string, y: number) => {
    if (!ref.current) return;
    // Lands where the line was shown.
    const cur = useStore.getState().dropHint;
    const index = cur?.group === groupKey ? cur.index : insertionAt(ref.current, y, id, selector).index;
    lineTick.key = "";
    setHint(null);
    dropRef.current(id, index);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const over = (e: Event) => {
      const d = (e as CustomEvent<TouchDragDetail>).detail;
      hintAt(d.id, d.y);
    };
    const drop = (e: Event) => {
      const d = (e as CustomEvent<TouchDragDetail>).detail;
      dropAt(d.id, d.y);
    };
    el.addEventListener("vitro:touchover", over);
    el.addEventListener("vitro:touchdrop", drop);
    return () => {
      el.removeEventListener("vitro:touchover", over);
      el.removeEventListener("vitro:touchdrop", drop);
    };
  });
  const props = enabled
    ? {
        ref,
        "data-drop-group": groupKey,
        onDragOver: (e: DragEvent) => {
          const id = draggedTask();
          if (!id || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          hintAt(id, e.clientY);
        },
        onDragLeave: (e: DragEvent) => {
          if (!(e.currentTarget as Node).contains(e.relatedTarget as Node) && useStore.getState().dropHint?.group === groupKey) setHint(null);
        },
        onDrop: (e: DragEvent) => {
          const id = e.dataTransfer.getData(DRAG_TYPE);
          if (!id) return;
          e.preventDefault();
          dropAt(id, e.clientY);
        },
      }
    : { ref };
  // One line per group that glides to where the task would land.
  const line = enabled && hint && hint.y !== null ? <div className="drop-line" style={{ transform: `translateY(${hint.y}px)` }} /> : null;
  return { over: enabled && !!hint, line, props };
}

/** Makes an element accept dropped tasks. Returns props plus whether a drag hovers. */
export function useDropTarget(onDropTask: (taskId: string, payload: string) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setOver(true);
        }
      },
      onDragLeave: (e: DragEvent) => {
        if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        const id = e.dataTransfer.getData(DRAG_TYPE);
        setOver(false);
        if (id) {
          e.preventDefault();
          onDropTask(id, e.dataTransfer.getData("text/plain"));
        }
      },
    },
  };
}

/** Creates a task from typed text; quick add tokens (dates, ^deadline, !prio, #list) apply. */
export function useCreateTask() {
  const addTask = useStore((s) => s.addTask);
  const lists = useStore((s) => s.lists);
  return (text: string, base: Partial<Task> = {}) => {
    const p = parseQuick(text);
    if (!p.title) return null;
    const list = matchList(p.listQuery, lists);
    const patch: Partial<Task> & { title: string } = { ...base, title: p.title };
    // A bare time ("15:00") keeps the day the task is being added to.
    if (p.start_date && !(p.dateImplied && base.start_date)) patch.start_date = p.start_date;
    if (p.start_time) patch.start_time = p.start_time;
    if (p.deadline_date) patch.deadline_date = p.deadline_date;
    if (p.deadline_time) patch.deadline_time = p.deadline_time;
    if (p.priority) patch.priority = p.priority;
    if (list) {
      patch.list_id = list.id;
      if (base.list_id !== list.id) patch.section_id = null;
    }
    if (patch.end_date && (!patch.start_date || patch.end_date <= patch.start_date)) patch.end_date = null;
    return addTask(patch);
  };
}

export function AddBar({ base, placeholder = "Add task" }: { base: Partial<Task>; placeholder?: string }) {
  const [value, setValue] = useState("");
  const create = useCreateTask();
  const input = useRef<HTMLInputElement>(null);
  const suggest = useListSuggest(value, setValue, input);
  return (
    <div className="add-bar">
      <Icon name="plus" size={14} />
      <input
        ref={input}
        value={value}
        placeholder={`${placeholder}   ·   tomorrow 14:00   ^fri   !high   #list`}
        {...suggest.inputProps}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (suggest.onKeyDown(e)) return;
          if (e.key === "Enter" && value.trim()) {
            void create(value, base);
            setValue("");
          }
          if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
      />
      <SuggestList s={suggest} className="add-suggest" />
    </div>
  );
}

/** Right-click handler that opens the task menu at the pointer. */
export function useTaskMenu(taskId: string) {
  const openMenu = useStore((s) => s.openMenu);
  return (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu({ kind: "task", id: taskId, x: e.clientX, y: e.clientY });
  };
}

/** Planned date, deadline and list badges for a task. */
export function TaskMeta({ task, showList, dotList }: { task: Task; showList?: boolean; dotList?: boolean }) {
  const lists = useStore((s) => s.lists);
  const tasks = useStore((s) => s.tasks);
  const today = todayKey();
  const list = showList && task.list_id ? lists.find((l) => l.id === task.list_id) : null;
  const open = task.status === 0;
  const subs = subtasksOf(tasks, task.id);
  const listEl = showList && (
    <span className="meta-list">
      {dotList && <i className="dot" style={{ background: list?.color ?? "var(--faint)" }} />}
      {list?.name ?? "Inbox"}
    </span>
  );
  const showDetails = useStore((s) => s.showDetails);
  return (
    <span className="task-meta">
      {!dotList && listEl}
      {!showDetails && task.notes?.trim() && (
        <span className="meta-notes" title="Has a description">
          <Icon name="lines" size={12} />
        </span>
      )}
      {subs.length > 0 && (
        <span className="meta-subs">
          <Icon name="subtask" size={12} />
          {subs.filter((x) => x.status !== 0).length}/{subs.length}
        </span>
      )}
      {task.start_date && (
        <span className={`meta-date ${open && task.start_date < today ? "is-overdue" : ""}`}>
          {formatDateTime(task.start_date, task.start_time, today)}
        </span>
      )}
      {task.deadline_date && (
        <span
          className={`meta-deadline ${open && task.deadline_date < today ? "is-over" : ""}`}
          title={`Deadline ${formatDateTime(task.deadline_date, task.deadline_time, today)}`}
        >
          <Icon name="deadline" size={11} />
          {formatDateTime(task.deadline_date, task.deadline_time, today)}
          {open && <em>{deadlineCountdown(task.deadline_date, today)}</em>}
        </span>
      )}
      {dotList && listEl}
    </span>
  );
}

/**
 * Whether a task's subtasks are folded away, and the switch. In the Completed
 * view everything starts folded (there a stored mark means "opened").
 */
export function useFold(id: string): [boolean, () => void] {
  const completed = useStore((s) => s.view.kind === "smart" && s.view.id === "completed");
  const key = completed ? `open:${id}` : id;
  const mark = useStore((s) => !!s.folded[key]);
  const toggle = useStore((s) => s.toggleFold);
  return [completed ? !mark : mark, () => toggle(key)];
}

/**
 * A task just completed goes (struck through, fading) unless the view keeps
 * done tasks: completed shown, or a subtask under a parent that is done and stays.
 */
export function useLeaving(task: Task, parent?: Task): boolean {
  return useStore((s) => !s.showCompleted && !!s.lingering[task.id] && (!parent || parent.status === 0 || !!s.lingering[parent.id]));
}

export function TaskRow({ task, showList, depth = 0, parent }: { task: Task; showList?: boolean; depth?: number; parent?: Task }) {
  const tasks = useStore((s) => s.tasks);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const toggle = useStore((s) => s.toggleTask);
  const showCompleted = useStore((s) => s.showCompleted);
  const showDetails = useStore((s) => s.showDetails);
  const lingering = useStore((s) => s.lingering);
  const [folded, toggleFold] = useFold(task.id);
  const selecting = useStore((s) => s.selecting);
  const onMenu = useTaskMenu(task.id);
  // A done parent shows all its subtasks; one just completed (still on its way out) only those that were open.
  const children = subtasksOf(tasks, task.id).filter((c) => showCompleted || c.status === 0 || (task.status !== 0 && !lingering[task.id]) || lingering[c.id]);
  const picked = !!selecting?.includes(task.id);
  const leaving = useLeaving(task, parent);
  return (
    <>
      <div
        className={`task-row p${task.priority} ${selectedId === task.id && !selecting ? "is-selected" : ""} ${task.status ? "is-done" : ""} ${leaving ? "is-leaving" : ""} ${picked ? "is-picked" : ""}`}
        style={{ paddingLeft: 10 + depth * 26 }}
        data-id={task.id}
        data-depth={depth}
        onClick={(e) => selectTap(task.id) || select(task.id, anchorOf(e.currentTarget))}
        onContextMenu={selecting ? (e) => e.preventDefault() : onMenu}
        {...(selecting ? {} : dragProps(task.id))}
      >
        {selecting ? (
          <SelectCircle on={picked} />
        ) : (
          <Check done={task.status !== 0} wontDo={task.status === 2} priority={task.priority} onToggle={() => void toggle(task.id)} />
        )}
        <span className="task-main">
          <span className="task-line">
            <span className="task-title">
              {task.pinned ? <Icon name="pin" size={12} /> : null}
              {task.title ? <Rich text={task.title} /> : <span className="faint">Untitled</span>}
            </span>
            <TaskMeta task={task} showList={showList} />
          </span>
          {showDetails && task.notes && <span className="task-notes"><Rich text={task.notes.split("\n")[0]} /></span>}
        </span>
        {children.length > 0 && (
          <button
            type="button"
            className={`fold ${folded ? "" : "is-open"}`}
            aria-label={folded ? "Show subtasks" : "Hide subtasks"}
            onClick={(e) => {
              e.stopPropagation();
              toggleFold();
            }}
          >
            <Icon name="chevron" size={13} />
          </button>
        )}
      </div>
      {!folded &&
        children.map((c) => (
          <TaskRow key={c.id} task={c} depth={depth + 1} parent={task} />
        ))}
    </>
  );
}
