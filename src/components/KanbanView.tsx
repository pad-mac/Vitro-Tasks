import { useMemo, useState } from "react";
import { isMobile } from "../lib/platform";
import { defaultsForView, subgroupTasks, subtasksOf, type Group, type Subgroup, type ViewRef } from "../lib/views";
import type { SortBy, Task } from "../shared/schema";
import { anchorOf, useStore } from "../store";
import { TaskMeta, dragProps, useCreateTask, useFold, useLeaving, useReorderTarget, useTaskMenu } from "./tasks";
import { Check, Icon, InlineInput, MenuItem, Popover, Rich } from "./ui";
import { GroupSelect, SelectCircle, selectTap } from "./Select";

/** A subtask inside a card: check and title; a tap opens it. */
function CardSub({ task, parent }: { task: Task; parent: Task }) {
  const select = useStore((s) => s.select);
  const toggle = useStore((s) => s.toggleTask);
  const selecting = useStore((s) => s.selecting);
  const open = useStore((s) => s.selectedId === task.id);
  const picked = !!selecting?.includes(task.id);
  const leaving = useLeaving(task, parent);
  const showDetails = useStore((s) => s.showDetails);
  return (
    <div
      className={`card-sub ${task.status ? "is-done" : ""} ${leaving ? "is-leaving" : ""} ${picked ? "is-picked" : ""} ${open && !selecting ? "is-selected" : ""}`}
      data-sub={task.id}
      onClick={(e) => {
        e.stopPropagation();
        if (!selectTap(task.id)) select(task.id, anchorOf(e.currentTarget));
      }}
    >
      {selecting ? (
        <SelectCircle on={picked} />
      ) : (
        <Check done={task.status !== 0} wontDo={task.status === 2} priority={task.priority} onToggle={() => void toggle(task.id)} />
      )}
      <span className="task-title">{task.title ? <Rich text={task.title} /> : <span className="faint">Untitled</span>}</span>
      {!showDetails && task.notes?.trim() && (
        <span className="meta-notes card-sub-notes" title="Has a description">
          <Icon name="lines" size={12} />
        </span>
      )}
    </div>
  );
}

function Card({ task, showList }: { task: Task; showList: boolean }) {
  const isSelected = useStore((s) => s.selectedId === task.id);
  const select = useStore((s) => s.select);
  const toggle = useStore((s) => s.toggleTask);
  const showDetails = useStore((s) => s.showDetails);
  const showCompleted = useStore((s) => s.showCompleted);
  const tasks = useStore((s) => s.tasks);
  const lingering = useStore((s) => s.lingering);
  const [folded, toggleFold] = useFold(task.id);
  const selecting = useStore((s) => s.selecting);
  const onMenu = useTaskMenu(task.id);
  const subs = subtasksOf(tasks, task.id).filter((c) => showCompleted || c.status === 0 || (task.status !== 0 && !lingering[task.id]) || lingering[c.id]);
  const picked = !!selecting?.includes(task.id);
  const leaving = useLeaving(task);
  return (
    <article
      data-id={task.id}
      className={`card ${isSelected && !selecting ? "is-selected" : ""} ${task.status ? "is-done" : ""} ${leaving ? "is-leaving" : ""} ${picked ? "is-picked" : ""}`}
      onClick={(e) => selectTap(task.id) || select(task.id, anchorOf(e.currentTarget))}
      onContextMenu={selecting ? (e) => e.preventDefault() : onMenu}
      {...(selecting ? {} : dragProps(task.id))}
    >
      <div className="card-top">
        {selecting ? (
          <SelectCircle on={picked} />
        ) : (
          <Check done={task.status !== 0} wontDo={task.status === 2} priority={task.priority} onToggle={() => void toggle(task.id)} />
        )}
        <span className="task-title">{task.title ? <Rich text={task.title} /> : <span className="faint">Untitled</span>}</span>
        {subs.length > 0 && (
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
      {showDetails && task.notes && <p className="card-notes"><Rich text={task.notes.split("\n")[0]} /></p>}
      <div className="card-foot">
        <TaskMeta task={task} showList={showList} dotList />
      </div>
      {!folded && subs.length > 0 && (
        <div className="card-subs">
          {subs.map((c) => (
            <CardSub key={c.id} task={c} parent={task} />
          ))}
        </div>
      )}
    </article>
  );
}

function Lane({ sub, showListFor }: { sub: Subgroup; showListFor: (t: Task) => boolean }) {
  const [closed, setClosed] = useState(false);
  return (
    <div className="lane">
      {sub.label && (
        <button type="button" className={`lane-head ${sub.tone ? `tone-${sub.tone}` : ""}`} onClick={() => setClosed(!closed)}>
          <span className={`twist ${closed ? "" : "is-open"}`}><Icon name="chevron" size={12} /></span>
          {sub.tone === "pinned" && <Icon name="pin" size={13} />}
          <span className="lane-label">{sub.label}</span>
          <span className="count">{sub.tasks.length}</span>
        </button>
      )}
      {!closed && sub.tasks.map((t) => <Card key={t.id} task={t} showList={showListFor(t)} />)}
    </div>
  );
}

function Column({ group, view, sort, sectioned }: { group: Group; view: ViewRef; sort: SortBy; sectioned: boolean }) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const updateSection = useStore((s) => s.updateSection);
  const deleteSection = useStore((s) => s.deleteSection);
  const dropTask = useStore((s) => s.dropTask);
  const create = useCreateTask();
  const drop = useReorderTarget(group.key, ".card[data-id]", (id, index) => void dropTask(view, sort, group, id, index));
  const subs = useMemo(() => subgroupTasks(group.tasks, sort), [group.tasks, sort]);
  const isSection = sectioned && group.key !== "nosection";
  return (
    <section className={`column ${drop.over ? "is-drop" : ""}`} {...drop.props}>
      <header className={`column-head ${group.tone === "overdue" ? "tone-overdue" : ""}`}>
        <GroupSelect tasks={group.tasks} />
        {renaming ? (
          <InlineInput
            initial={group.label}
            onCommit={(v) => {
              void updateSection(group.key, { name: v });
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="group-label">{group.label || "Tasks"}</span>
        )}
        <span className="count">{group.tasks.length}</span>
        <span className="push" />
        <button type="button" className="icon-btn" title="Add task to this column" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} />
        </button>
        {isSection && (
          <Popover align="right" title="Section options" trigger={<span className="icon-btn"><Icon name="dots" /></span>}>
            {(close) => (
              <div className="menu">
                <MenuItem onClick={() => { setRenaming(true); close(); }}><Icon name="edit" size={15} /> Rename</MenuItem>
                <MenuItem danger onClick={() => { void deleteSection(group.key); close(); }}><Icon name="trash" size={15} /> Delete</MenuItem>
              </div>
            )}
          </Popover>
        )}
      </header>
      <div className="column-body" onScroll={(e) => e.currentTarget.classList.toggle("is-scrolled", e.currentTarget.scrollTop > 0)}>
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
        {subs.map((s) => (
          <Lane key={s.key} sub={s} showListFor={(t) => view.kind !== "list" || t.list_id !== view.id} />
        ))}
        {!group.tasks.length && !adding && <div className="column-empty">No tasks</div>}
      </div>
      {drop.line}
    </section>
  );
}

export function KanbanView({ view, groups, sectioned, sort }: { view: ViewRef; groups: Group[]; sectioned: boolean; sort: SortBy }) {
  const addSection = useStore((s) => s.addSection);
  const [adding, setAdding] = useState(false);
  const board = (
    <div className="kanban">
      {groups.map((g) => (
        <Column key={g.key} group={g} view={view} sort={sort} sectioned={sectioned} />
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
  // Phone: the edge strip sits beside the board (not in it), so a swipe from the edge never pans the board.
  return isMobile ? (
    <div className="kanban-wrap">
      {board}
      <EdgeCatch />
    </div>
  ) : (
    board
  );
}

/**
 * Phone: a thin strip over the board's left edge. A swipe in from the edge
 * starts on it instead of on the board, so the board does not scroll sideways
 * (nor along while the lists open); the edge swipe opens them. A tap on it
 * goes on to what lies under it.
 */
function EdgeCatch() {
  return (
    <div
      className="edge-catch"
      aria-hidden="true"
      onClick={(e) => {
        const strip = e.currentTarget;
        const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el !== strip && !strip.contains(el));
        under?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
      }}
    />
  );
}
