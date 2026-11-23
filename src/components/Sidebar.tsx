import { useMemo, useRef, useState, type PointerEvent } from "react";
import { SMART_VIEWS, childLists, countOpen, hiddenLists, type SmartId, type ViewRef } from "../lib/views";
import type { List } from "../shared/schema";
import { useStore } from "../store";
import { useDropTarget } from "./tasks";
import { Icon, InlineInput } from "./ui";

const SMART_ICONS: Record<SmartId, string> = {
  all: "layers",
  today: "sun",
  next7: "week",
  deadlines: "deadline",
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
      {id !== "completed" && count > 0 && <span className="count">{count}</span>}
    </button>
  );
}

function ListRow({ list, depth, counts }: { list: List; depth: number; counts: Map<string, number> }) {
  const lists = useStore((s) => s.lists);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const updateList = useStore((s) => s.updateList);
  const updateTask = useStore((s) => s.updateTask);
  const openMenu = useStore((s) => s.openMenu);
  const renaming = useStore((s) => s.renamingListId === list.id);
  const setRenaming = useStore((s) => s.setRenamingList);
  const kids = childLists(lists, list.id);
  const me: ViewRef = { kind: "list", id: list.id };
  const drop = useDropTarget((taskId) => void updateTask(taskId, { list_id: list.id }));
  const count = counts.get(list.id) ?? 0;
  return (
    <>
      <div
        className={`nav-row ${sameView(view, me) ? "is-active" : ""} ${drop.over ? "is-drop" : ""}`}
        style={{ paddingLeft: 10 + depth * 18 }}
        onClick={() => setView(me)}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu({ kind: "list", id: list.id, x: e.clientX, y: e.clientY });
        }}
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
        ) : depth === 0 ? null : (
          <span className="twist-spacer" />
        )}
        {renaming ? (
          <InlineInput
            initial={list.name}
            onCommit={(v) => {
              void updateList(list.id, { name: v });
              setRenaming(null);
            }}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <span className="nav-name" onDoubleClick={() => setRenaming(list.id)}>
            {list.name}
          </span>
        )}
        <i className="dot" style={{ background: list.color }} />
        {/* The options button takes the count's place on hover, so the name keeps its room. */}
        <span className="nav-end">
          <span className="count">{count > 0 ? count : ""}</span>
          <button
            type="button"
            className="icon-btn nav-more"
            title="List options"
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              openMenu({ kind: "list", id: list.id, x: r.left, y: r.bottom + 4 });
            }}
          >
            <Icon name="dots" size={14} />
          </button>
        </span>
      </div>
      {!list.collapsed && kids.map((k) => <ListRow key={k.id} list={k} depth={depth + 1} counts={counts} />)}
    </>
  );
}

/** Drag handle on the sidebar's right edge. Double-click resets the width. */
function Resizer() {
  const width = useStore((s) => s.sidebarWidth);
  const setWidth = useStore((s) => s.setSidebarWidth);
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      className="sidebar-resizer"
      title="Drag to resize"
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
        document.documentElement.classList.add("is-resizing");
      }}
      onPointerMove={(e) => {
        if (start.current) setWidth(start.current.w + e.clientX - start.current.x);
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        setWidth(start.current.w + e.clientX - start.current.x, true);
        start.current = null;
        document.documentElement.classList.remove("is-resizing");
      }}
      onDoubleClick={() => setWidth(262, true)}
    />
  );
}

export function Sidebar({ drawer = false, onSettings }: { drawer?: boolean; onSettings?: () => void }) {
  const syncError = useStore((s) => s.sync.status === "error");
  const lists = useStore((s) => s.lists);
  const sections = useStore((s) => s.sections);
  const tasks = useStore((s) => s.tasks);
  const settings = useStore((s) => s.settings);
  const width = useStore((s) => s.sidebarWidth);
  const addList = useStore((s) => s.addList);
  const setView = useStore((s) => s.setView);
  const [adding, setAdding] = useState(false);
  const data = useMemo(() => ({ lists, sections, tasks, hidden: hiddenLists(settings) }), [lists, sections, tasks, settings]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lists) m.set(l.id, countOpen({ kind: "list", id: l.id }, data));
    return m;
  }, [lists, data]);
  return (
    <div className={`sidebar-wrap ${drawer ? "is-drawer" : ""}`} style={{ width: drawer ? Math.min(width, 300) : width }}>
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
    {/* The phone: settings are at the bottom of the sidebar (not in the tab bar). */}
    {onSettings && (
      <div className="sidebar-foot">
        <button type="button" className="nav-row sidebar-settings" onClick={onSettings}>
          <Icon name="settings" size={17} />
          <span className="nav-name">Settings</span>
          {syncError && <i className="m-badge" title="Sync needs attention" />}
        </button>
      </div>
    )}
    {!drawer && <Resizer />}
    </div>
  );
}
