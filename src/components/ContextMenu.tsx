// The app's own right-click menus for tasks and lists.
import { useState } from "react";
import { addDays, startOfWeek, todayKey } from "../lib/dates";
import { PRIORITY_LABELS, orderedLists } from "../lib/views";
import { LIST_COLORS, useStore } from "../store";
import { Flag, FloatingPanel, Icon, MenuItem } from "./ui";

function IconRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cm-group">
      <span className="cm-label">{label}</span>
      <div className="cm-icons">{children}</div>
    </div>
  );
}

function TaskMenu({ id, close }: { id: string; close: () => void }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === id));
  const lists = useStore((s) => s.lists);
  const update = useStore((s) => s.updateTask);
  const del = useStore((s) => s.deleteTask);
  const duplicate = useStore((s) => s.duplicateTask);
  const wontDo = useStore((s) => s.setWontDo);
  const toggle = useStore((s) => s.toggleTask);
  const addSubtaskTo = useStore((s) => s.addSubtaskTo);
  const [moving, setMoving] = useState(false);
  if (!task) return null;
  const today = todayKey();
  const run = (fn: () => unknown) => () => {
    void fn();
    close();
  };
  const dates: [string, string, string | null][] = [
    ["sun", "Today", today],
    ["sunrise", "Tomorrow", addDays(today, 1)],
    ["plus7", "Next week", addDays(startOfWeek(today), 7)],
    ["calx", "Clear", null],
  ];
  if (moving) {
    return (
      <div className="menu menu-scroll">
        <MenuItem onClick={() => setMoving(false)}>
          <span className="flip"><Icon name="chevron" size={12} /></span> Move to
        </MenuItem>
        <div className="cm-sep" />
        <MenuItem active={!task.list_id} onClick={run(() => update(id, { list_id: null }))}>
          <Icon name="inbox" size={14} /> Inbox
        </MenuItem>
        {orderedLists(lists).map((l) => (
          <MenuItem key={l.id} active={l.id === task.list_id} onClick={run(() => update(id, { list_id: l.id }))}>
            <span style={{ paddingLeft: l.depth * 14 }} className="menu-label">
              <i className="dot" style={{ background: l.color }} /> {l.name}
            </span>
          </MenuItem>
        ))}
      </div>
    );
  }
  return (
    <div className="menu cm">
      <IconRow label="Date">
        {dates.map(([icon, title, d]) => (
          <button
            type="button"
            key={title}
            title={title}
            className={`cm-icon ${d !== null && task.start_date === d ? "is-active" : ""}`}
            onClick={run(() =>
              update(id, d ? { start_date: d, end_date: null, end_time: null } : { start_date: null, start_time: null, end_date: null, end_time: null }),
            )}
          >
            <Icon name={icon} size={18} />
          </button>
        ))}
      </IconRow>
      <IconRow label="Deadline">
        {dates.map(([icon, title, d]) => (
          <button
            type="button"
            key={title}
            title={`Deadline: ${title}`}
            className={`cm-icon is-signal ${d !== null && task.deadline_date === d ? "is-active" : ""}`}
            onClick={run(() => update(id, { deadline_date: d, deadline_time: d ? task.deadline_time : null }))}
          >
            <Icon name={icon} size={18} />
          </button>
        ))}
      </IconRow>
      <IconRow label="Priority">
        {[3, 2, 1, 0].map((p) => (
          <button
            type="button"
            key={p}
            title={PRIORITY_LABELS[p]}
            className={`cm-icon ${task.priority === p ? "is-active" : ""}`}
            onClick={run(() => update(id, { priority: p }))}
          >
            <Flag priority={p} size={18} />
          </button>
        ))}
      </IconRow>
      <div className="cm-sep" />
      {!task.parent_id && (
        <MenuItem onClick={run(() => addSubtaskTo(id))}>
          <Icon name="subtask" size={15} /> Add Subtask
        </MenuItem>
      )}
      <MenuItem onClick={run(() => update(id, { pinned: task.pinned ? 0 : 1 }))}>
        <Icon name="pin" size={15} /> {task.pinned ? "Unpin" : "Pin"}
      </MenuItem>
      {task.status === 0 ? (
        <MenuItem onClick={run(() => wontDo(id))}>
          <Icon name="ban" size={15} /> Won't Do
        </MenuItem>
      ) : (
        <MenuItem onClick={run(() => toggle(id))}>
          <Icon name="tasks" size={15} /> Reopen
        </MenuItem>
      )}
      {!task.parent_id && (
        <button type="button" className="menu-item" onClick={() => setMoving(true)}>
          <span className="menu-label">
            <Icon name="move" size={15} /> Move to
          </span>
          <Icon name="chevron" size={12} />
        </button>
      )}
      <div className="cm-sep" />
      <MenuItem onClick={run(() => duplicate(id))}>
        <Icon name="copy" size={15} /> Duplicate
      </MenuItem>
      <MenuItem danger onClick={run(() => del(id))}>
        <Icon name="trash" size={15} /> Delete
      </MenuItem>
    </div>
  );
}

function ListMenu({ id, close }: { id: string; close: () => void }) {
  const list = useStore((s) => s.lists.find((l) => l.id === id));
  const openCount = useStore((s) => s.tasks.filter((t) => t.list_id === id && t.status === 0).length);
  const updateList = useStore((s) => s.updateList);
  const deleteList = useStore((s) => s.deleteList);
  const addList = useStore((s) => s.addList);
  const setRenaming = useStore((s) => s.setRenamingList);
  const [confirm, setConfirm] = useState(false);
  if (!list) return null;
  return (
    <div className="menu cm">
      <MenuItem onClick={() => { setRenaming(id); close(); }}>
        <Icon name="edit" size={15} /> Rename
      </MenuItem>
      <MenuItem
        onClick={() => {
          void updateList(id, { collapsed: 0 });
          void addList("New sublist", id).then((l) => setRenaming(l.id));
          close();
        }}
      >
        <Icon name="plus" size={15} /> Add Sublist
      </MenuItem>
      {list.parent_id && (
        <MenuItem onClick={() => { void updateList(id, { parent_id: null }); close(); }}>
          <Icon name="move" size={15} /> Move to top level
        </MenuItem>
      )}
      <div className="swatches">
        {LIST_COLORS.map((c) => (
          <button
            type="button"
            key={c}
            className={`swatch ${c === list.color ? "is-active" : ""}`}
            style={{ background: c }}
            aria-label={`Color ${c}`}
            onClick={() => void updateList(id, { color: c })}
          />
        ))}
      </div>
      <div className="cm-sep" />
      {confirm ? (
        <MenuItem danger onClick={() => { void deleteList(id); close(); }}>
          <Icon name="trash" size={15} /> Really delete{openCount ? ` with ${openCount} open task${openCount === 1 ? "" : "s"}` : ""}?
        </MenuItem>
      ) : (
        <MenuItem danger onClick={() => setConfirm(true)}>
          <Icon name="trash" size={15} /> Delete
        </MenuItem>
      )}
    </div>
  );
}

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const openMenu = useStore((s) => s.openMenu);
  if (!menu) return null;
  const close = () => openMenu(null);
  return (
    <FloatingPanel
      key={`${menu.kind}:${menu.id}:${menu.x}:${menu.y}`}
      anchor={{ x: menu.x, y: menu.y, w: 0, h: 0 }}
      placement="below"
      onClose={close}
      className="context-menu"
    >
      {menu.kind === "task" ? <TaskMenu id={menu.id} close={close} /> : <ListMenu id={menu.id} close={close} />}
    </FloatingPanel>
  );
}
