import { useEffect, useState } from "react";
import { useStore, type TrashItem } from "../store";
import { formatDate, toKey } from "../lib/dates";
import { plainText } from "../lib/rich";
import { Icon } from "./ui";

/**
 * The trash: deleted tasks, last deleted first. Restore puts one back where it was; deleting forever
 * takes a second tap (it can't be undone). Read from the database, not the store's task list: deleted
 * tasks are not loaded with the rest. Read again whenever the tasks change (a delete here or on another device).
 */
export function TrashView() {
  const trash = useStore((s) => s.trash);
  const tasks = useStore((s) => s.tasks);
  const loadTrash = useStore((s) => s.loadTrash);
  useEffect(() => void loadTrash(), [tasks, loadTrash]);
  return (
    <div className="list-view trash-view">
      {trash && !trash.length && (
        <div className="empty">
          <p>The trash is empty.</p>
        </div>
      )}
      {trash?.map((x) => <TrashRow key={x.task.id} item={x} />)}
    </div>
  );
}

/** Head button: deletes everything in the trash forever, after a second tap. */
export function EmptyTrashButton() {
  const trash = useStore((s) => s.trash);
  const purge = useStore((s) => s.purgeTasks);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const t = setTimeout(() => setSure(false), 3000);
    return () => clearTimeout(t);
  }, [sure]);
  if (!trash?.length) return null;
  return (
    <button
      type="button"
      className={`btn ${sure ? "is-danger" : ""}`}
      onClick={() => (sure ? void purge(trash.map((x) => x.task.id)) : setSure(true))}
    >
      {sure ? "Delete all forever" : "Empty trash"}
    </button>
  );
}

function TrashRow({ item }: { item: TrashItem }) {
  const lists = useStore((s) => s.lists);
  const restore = useStore((s) => s.restoreTask);
  const purge = useStore((s) => s.purgeTasks);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const t = setTimeout(() => setSure(false), 3000);
    return () => clearTimeout(t);
  }, [sure]);
  const { task, kids, at } = item;
  const list = task.list_id ? lists.find((l) => l.id === task.list_id) : null;
  const where = task.list_id ? (list?.name ?? "Deleted list") : "Inbox";
  const meta = [where, `deleted ${formatDate(toKey(new Date(at))).replace(/^(Today|Yesterday)$/, (d) => d.toLowerCase())}`];
  if (kids.length) meta.push(kids.length === 1 ? "1 subtask" : `${kids.length} subtasks`);
  return (
    <div className="trash-row">
      <div className="trash-text">
        <span className="trash-title">{plainText(task.title) || "Untitled"}</span>
        <span className="trash-meta">{meta.join(" · ")}</span>
      </div>
      <button type="button" className="btn trash-restore" title="Restore" aria-label="Restore" onClick={() => void restore(task.id)}>
        <Icon name="undo" size={14} />
        <span>Restore</span>
      </button>
      <button
        type="button"
        className={`btn ${sure ? "is-danger" : "btn-square"}`}
        aria-label="Delete forever"
        title="Delete forever"
        onClick={() => (sure ? void purge([task.id]) : setSure(true))}
      >
        {sure ? "Delete forever" : <Icon name="trash" size={14} />}
      </button>
    </div>
  );
}
