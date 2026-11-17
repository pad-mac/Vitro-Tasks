// Building blocks shared by the list, board, timeline and calendar views.
import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { deadlineCountdown, formatDateTime, todayKey } from "../lib/dates";
import { matchList, parseQuick } from "../lib/quickparse";
import { subtasksOf } from "../lib/views";
import type { Task } from "../shared/schema";
import { anchorOf, useStore } from "../store";
import { SuggestList, useListSuggest } from "./ListSuggest";
import { Check, Icon, Rich } from "./ui";

export const DRAG_TYPE = "application/x-vitro-task";

let dragging: string | null = null;

/** The task being dragged right now (drag-over events cannot read the payload). */
export const draggedTask = () => dragging;

export function dragProps(taskId: string, payload = "") {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
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

/** Where a task dropped at `clientY` lands among a group's items (the dragged one left out). */
export function insertionAt(container: Element, clientY: number, draggedId: string, selector: string): { index: number; before: string | null } {
  const items = [...container.querySelectorAll<HTMLElement>(selector)].filter((el) => el.dataset.id !== draggedId);
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return { index: i, before: items[i].dataset.id ?? null };
  }
  return { index: items.length, before: null };
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
  const over = useStore((s) => s.dropHint?.group === groupKey);
  const atEnd = useStore((s) => s.dropHint?.group === groupKey && s.dropHint.before === null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const hintAt = (id: string, y: number) => {
    if (!ref.current) return;
    const { before } = insertionAt(ref.current, y, id, selector);
    setHint({ group: groupKey, before });
  };
  const dropAt = (id: string, y: number) => {
    if (!ref.current) return;
    const { index } = insertionAt(ref.current, y, id, selector);
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
  return { over: enabled && over, atEnd: enabled && atEnd, props };
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
  return (
    <span className="task-meta">
      {!dotList && listEl}
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

export function TaskRow({ task, showList, depth = 0 }: { task: Task; showList?: boolean; depth?: number }) {
  const tasks = useStore((s) => s.tasks);
  const dropBefore = useStore((s) => depth === 0 && s.dropHint?.before === task.id);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const toggle = useStore((s) => s.toggleTask);
  const showCompleted = useStore((s) => s.showCompleted);
  const showDetails = useStore((s) => s.showDetails);
  const onMenu = useTaskMenu(task.id);
  const children = subtasksOf(tasks, task.id).filter((c) => showCompleted || c.status === 0 || task.status !== 0);
  return (
    <>
      <div
        className={`task-row p${task.priority} ${selectedId === task.id ? "is-selected" : ""} ${task.status ? "is-done" : ""} ${dropBefore ? "drop-before" : ""}`}
        style={{ paddingLeft: 10 + depth * 26 }}
        data-id={task.id}
        data-depth={depth}
        onClick={(e) => select(task.id, anchorOf(e.currentTarget))}
        onContextMenu={onMenu}
        {...dragProps(task.id)}
      >
        <Check done={task.status !== 0} wontDo={task.status === 2} priority={task.priority} onToggle={() => void toggle(task.id)} />
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
      </div>
      {children.map((c) => (
        <TaskRow key={c.id} task={c} depth={depth + 1} />
      ))}
    </>
  );
}
