import { useState } from "react";
import { defaultsForView, subtasksOf, type Group, type ViewRef } from "../lib/views";
import type { Task } from "../shared/schema";
import { useStore } from "../store";
import { TaskMeta, dragProps, useCreateTask, useDropTarget } from "./tasks";
import { Check, Icon, InlineInput } from "./ui";

function Card({ task, showList }: { task: Task; showList: boolean }) {
  const tasks = useStore((s) => s.tasks);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const toggle = useStore((s) => s.toggleTask);
  const subs = subtasksOf(tasks, task.id);
  const doneSubs = subs.filter((s) => s.status === 1).length;
  return (
    <article
      className={`card ${selectedId === task.id ? "is-selected" : ""} ${task.status ? "is-done" : ""}`}
      onClick={() => select(task.id)}
      {...dragProps(task.id)}
    >
      <div className="card-top">
        <Check done={task.status === 1} priority={task.priority} onToggle={() => void toggle(task.id)} />
        <span className="task-title">{task.title || <span className="faint">Untitled</span>}</span>
      </div>
      {task.notes && <p className="card-notes">{task.notes}</p>}
      {(task.start_date || task.deadline_date || showList || subs.length > 0) && (
        <div className="card-foot">
          <TaskMeta task={task} showList={showList} />
          {subs.length > 0 && (
            <span className="meta-subs mono">
              {doneSubs}/{subs.length}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

function Column({ group, view }: { group: Group; view: ViewRef }) {
  const [adding, setAdding] = useState(false);
  const updateTask = useStore((s) => s.updateTask);
  const create = useCreateTask();
  const canDrop = Object.keys(group.patch).length > 0 || group.key === "all";
  const drop = useDropTarget((id) => {
    if (canDrop) void updateTask(id, group.patch);
  });
  return (
    <section className={`column ${drop.over && canDrop ? "is-drop" : ""}`} {...drop.props}>
      <header className={`column-head ${group.tone === "overdue" ? "tone-overdue" : ""}`}>
        <span className="group-label">{group.label || "Tasks"}</span>
        <span className="count mono">{group.tasks.length}</span>
        <button type="button" className="icon-btn push" title="Add task to this column" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />
        </button>
      </header>
      <div className="column-body">
        {adding && (
          <div className="card card-new">
            <InlineInput
              placeholder="Task title"
              onCommit={(v) => {
                void create(v, { ...defaultsForView(view), ...group.patch });
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}
        {group.tasks.map((t) => (
          <Card key={t.id} task={t} showList={view.kind !== "list" || t.list_id !== view.id} />
        ))}
        {!group.tasks.length && !adding && <div className="column-empty">Drop a task here</div>}
      </div>
    </section>
  );
}

export function KanbanView({ view, groups, sectioned }: { view: ViewRef; groups: Group[]; sectioned: boolean }) {
  const addSection = useStore((s) => s.addSection);
  const [adding, setAdding] = useState(false);
  
  return (
    <div className="kanban">
      {groups.map((g) => (
        <Column key={g.key} group={g} view={view} />
      ))}
      {sectioned && (
        <section className="column column-add">
          {adding ? (
            <InlineInput
              placeholder="Section name"
              onCommit={(v) => {
                void addSection((view as { id: string }).id, v);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button type="button" className="ghost-btn" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} /> Add section
            </button>
          )}
        </section>
      )}
    </div>
  );
}
