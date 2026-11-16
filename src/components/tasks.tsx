// Building blocks shared by the list, board, timeline and calendar views.
import { useState, type DragEvent } from "react";
import { deadlineCountdown, formatDateTime, todayKey } from "../lib/dates";
import { matchList, parseQuick } from "../lib/quickparse";
import { subtasksOf } from "../lib/views";
import type { Task } from "../shared/schema";
import { useStore } from "../store";
import { Check, Icon } from "./ui";

export const DRAG_TYPE = "application/x-vitro-task";

export function dragProps(taskId: string, payload = "") {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, taskId);
      e.dataTransfer.setData("text/plain", payload);
      e.dataTransfer.effectAllowed = "move";
    },
  };
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
  return (
    <div className="add-bar">
      <Icon name="plus" size={14} />
      <input
        value={value}
        placeholder={`${placeholder}   ·   tomorrow 14:00   ^fri   !high   #list`}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            void create(value, base);
            setValue("");
          }
          if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

/** Planned date, deadline and list badges for a task. */
export function TaskMeta({ task, showList }: { task: Task; showList?: boolean }) {
  const lists = useStore((s) => s.lists);
  const today = todayKey();
  const list = showList && task.list_id ? lists.find((l) => l.id === task.list_id) : null;
  const open = task.status === 0;
  return (
    <span className="task-meta">
      {list && (
        <span className="meta-list">
          <i className="dot" style={{ background: list.color }} />
          {list.name}
        </span>
      )}
      {showList && !task.list_id && <span className="meta-list">Inbox</span>}
      {task.start_date && (
        <span className={`meta-date mono ${open && task.start_date < today ? "is-overdue" : ""}`}>
          {formatDateTime(task.start_date, task.start_time, today)}
        </span>
      )}
      {task.deadline_date && (
        <span
          className={`meta-deadline mono ${open && task.deadline_date < today ? "is-over" : ""}`}
          title={`Deadline ${formatDateTime(task.deadline_date, task.deadline_time, today)}`}
        >
          <Icon name="flag" size={12} />
          {formatDateTime(task.deadline_date, task.deadline_time, today)}
          {open && <em>{deadlineCountdown(task.deadline_date, today)}</em>}
        </span>
      )}
    </span>
  );
}

export function TaskRow({ task, showList, depth = 0 }: { task: Task; showList?: boolean; depth?: number }) {
  const tasks = useStore((s) => s.tasks);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const toggle = useStore((s) => s.toggleTask);
  const showCompleted = useStore((s) => s.showCompleted);
  const children = subtasksOf(tasks, task.id).filter((c) => showCompleted || c.status === 0 || task.status === 1);
  return (
    <>
      <div
        className={`task-row ${selectedId === task.id ? "is-selected" : ""} ${task.status ? "is-done" : ""}`}
        style={{ paddingLeft: 10 + depth * 24 }}
        onClick={() => select(task.id)}
        {...dragProps(task.id)}
      >
        <Check done={task.status === 1} priority={task.priority} onToggle={() => void toggle(task.id)} />
        <span className="task-title">
          {task.pinned ? <Icon name="pin" size={12} /> : null}
          {task.title || <span className="faint">Untitled</span>}
        </span>
        <TaskMeta task={task} showList={showList} />
      </div>
      {children.map((c) => (
        <TaskRow key={c.id} task={c} depth={depth + 1} />
      ))}
    </>
  );
}
