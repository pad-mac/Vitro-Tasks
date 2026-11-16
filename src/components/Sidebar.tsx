import { useMemo, useState } from "react";
import { SMART_VIEWS, childLists, countOpen, type SmartId, type ViewRef } from "../lib/views";
import type { List } from "../shared/schema";
import { LIST_COLORS, useStore } from "../store";
import { useDropTarget } from "./tasks";
import { Icon, InlineInput, MenuItem, Popover } from "./ui";

const SMART_ICONS: Record<SmartId, string> = {
  all: "layers",
  today: "sun",
  next7: "week",
  deadlines: "flag",
  inbox: "inbox",
  completed: "done",
};

function sameView(a: ViewRef, b: ViewRef) {
  return a.kind === b.kind && (a as { id?: string }).id === (b as { id?: string }).id;
}

function SmartRow({ id, name, count }: { id: SmartId; name: string; count: number }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const updateTask = useStore((s) => s.updateTask);
  const me: ViewRef = { kind: "smart", id };
  const drop = useDropTarget((taskId) => {
    if (id === "inbox") void updateTask(taskId, { list_id: null });
  });
  return (
    <button
      type="button"
      className={`nav-row ${sameView(view, me) ? "is-active" : ""} ${drop.over && id === "inbox" ? "is-drop" : ""} ${id === "deadlines" ? "nav-deadlines" : ""}`}
      onClick={() => setView(me)}
      {...drop.props}
    >
      <Icon name={SMART_ICONS[id]} />
      <span className="nav-name">{name}</span>
      {id !== "completed" && count > 0 && <span className="count mono">{count}</span>}
    </button>
  );
}

function ListRow({ list, depth, counts }: { list: List; depth: number; counts: Map<string, number> }) {
  const lists = useStore((s) => s.lists);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const updateList = useStore((s) => s.updateList);
  const deleteList = useStore((s) => s.deleteList);
  const addList = useStore((s) => s.addList);
  const updateTask = useStore((s) => s.updateTask);
  const [renaming, setRenaming] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const kids = childLists(lists, list.id);
  const me: ViewRef = { kind: "list", id: list.id };
  const drop = useDropTarget((taskId) => void updateTask(taskId, { list_id: list.id }));
  const count = counts.get(list.id) ?? 0;
  return (
    <>
      <div
        className={`nav-row ${sameView(view, me) ? "is-active" : ""} ${drop.over ? "is-drop" : ""}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => setView(me)}
        {...drop.props}
      >
        {kids.length > 0 ? (
          <button
            type="button"
            className={`twist ${list.collapsed ? "" : "is-open"}`}
            aria-label="Toggle sublists"
            onClick={(e) => {
              e.stopPropagation();
              void updateList(list.id, { collapsed: list.collapsed ? 0 : 1 });
            }}
          >
            <Icon name="chevron" size={12} />
          </button>
        ) : (
          <span className="twist-spacer" />
        )}
        <i className="dot" style={{ background: list.color }} />
        {renaming ? (
          <InlineInput
            initial={list.name}
            onCommit={(v) => {
              void updateList(list.id, { name: v });
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="nav-name" onDoubleClick={() => setRenaming(true)}>
            {list.name}
          </span>
        )}
        <span className="nav-tools hover-reveal" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="icon-btn" title="Add sublist" onClick={() => { setAddingSub(true); if (list.collapsed) void updateList(list.id, { collapsed: 0 }); }}>
            <Icon name="plus" size={12} />
          </button>
          <Popover align="right" trigger={<Icon name="dots" size={14} />} title="List options">
            {(close) => (
              <div className="menu">
                <MenuItem onClick={() => { setRenaming(true); close(); }}>Rename</MenuItem>
                <div className="swatches">
                  {LIST_COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      className={`swatch ${c === list.color ? "is-active" : ""}`}
                      style={{ background: c }}
                      aria-label={`Color ${c}`}
                      onClick={() => void updateList(list.id, { color: c })}
                    />
                  ))}
                </div>
                {list.parent_id && <MenuItem onClick={() => { void updateList(list.id, { parent_id: null }); close(); }}>Move to top level</MenuItem>}
                {confirm ? (
                  <MenuItem danger onClick={() => { void deleteList(list.id); close(); }}>
                    Really delete{count ? ` with ${count} open task${count === 1 ? "" : "s"}` : ""}?
                  </MenuItem>
                ) : (
                  <MenuItem danger onClick={() => setConfirm(true)}>Delete list</MenuItem>
                )}
              </div>
            )}
          </Popover>
        </span>
        {count > 0 && <span className="count mono">{count}</span>}
      </div>
      {addingSub && (
        <div className="nav-row nav-new" style={{ paddingLeft: 8 + (depth + 1) * 16 }}>
          <span className="twist-spacer" />
          <InlineInput
            placeholder="Sublist name"
            onCommit={(v) => {
              void addList(v, list.id);
              setAddingSub(false);
            }}
            onCancel={() => setAddingSub(false)}
          />
        </div>
      )}
      {!list.collapsed && kids.map((k) => <ListRow key={k.id} list={k} depth={depth + 1} counts={counts} />)}
    </>
  );
}

export function Sidebar() {
  const lists = useStore((s) => s.lists);
  const sections = useStore((s) => s.sections);
  const tasks = useStore((s) => s.tasks);
  const addList = useStore((s) => s.addList);
  const setView = useStore((s) => s.setView);
  const [adding, setAdding] = useState(false);
  const data = useMemo(() => ({ lists, sections, tasks }), [lists, sections, tasks]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lists) m.set(l.id, countOpen({ kind: "list", id: l.id }, data));
    return m;
  }, [lists, data]);
  return (
    <nav className="sidebar">
      <div className="nav-group">
        {SMART_VIEWS.map((v) => (
          <SmartRow key={v.id} id={v.id} name={v.name} count={countOpen({ kind: "smart", id: v.id }, data)} />
        ))}
      </div>
      <div className="nav-title">
        <span className="micro">Lists</span>
        <button type="button" className="icon-btn" title="New list" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="nav-group nav-lists">
        {childLists(lists, null).map((l) => (
          <ListRow key={l.id} list={l} depth={0} counts={counts} />
        ))}
        {adding && (
          <div className="nav-row nav-new">
            <span className="twist-spacer" />
            <InlineInput
              placeholder="List name"
              onCommit={(v) => {
                void addList(v).then((l) => setView({ kind: "list", id: l.id }));
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}
        {!lists.length && !adding && (
          <button type="button" className="ghost-btn" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> Create your first list
          </button>
        )}
      </div>
    </nav>
  );
}
