import { useMemo, useRef, useState, type PointerEvent } from "react";
import { SMART_VIEWS, childLists, countOpen, hiddenLists, listWithDescendants, type SmartId, type ViewRef } from "../lib/views";
import type { List } from "../shared/schema";
import { hiddenSmartViews, useStore } from "../store";
import { useDropTarget } from "./tasks";
import { Icon, InlineInput, ServerMark } from "./ui";

export const SMART_ICONS: Record<SmartId, string> = {
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

/**
 * Lists in the sidebar take any order: drag one (mouse) up or down; the line
 * shows where it goes. On the upper or lower quarter of a list it goes before
 * or after it; on the middle it goes into it, as its last sublist.
 */
type ListDrop = { id: string; parent: string | null; before: string | null; into?: string; y: number };
function useListReorder(box: React.RefObject<HTMLDivElement | null>) {
  const [drop, setDrop] = useState<ListDrop | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const swallow = useRef(0);
  const start = (id: string) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || e.pointerType === "touch" || (e.target as HTMLElement).closest("button, input")) return;
    const y0 = e.clientY;
    let moving = false;
    let last: ListDrop | null = null;
    const where = (y: number): ListDrop | null => {
      const st = useStore.getState();
      const own = new Set(listWithDescendants(st.lists, id));
      const rows = [...(box.current?.querySelectorAll<HTMLElement>(".nav-row[data-list]") ?? [])].filter((r) => !own.has(r.dataset.list!));
      const top = box.current!.getBoundingClientRect().top;
      for (const r of rows) {
        const b = r.getBoundingClientRect();
        if (y > b.bottom) continue;
        const list = st.lists.find((l) => l.id === r.dataset.list)!;
        const q = (y - b.top) / b.height;
        if (q > 0.25 && q < 0.75) return { id, parent: list.id, before: null, into: list.id, y: b.top - top };
        if (q <= 0.25) return { id, parent: list.parent_id, before: list.id, y: b.top - top };
        // Lower quarter: after it — first among its sublists when they are shown under it.
        const kids = childLists(st.lists, list.id).filter((k) => !own.has(k.id));
        if (kids.length && !list.collapsed) return { id, parent: list.id, before: kids[0].id, y: b.bottom - top };
        const sibs = childLists(st.lists, list.parent_id).filter((k) => !own.has(k.id));
        const next = sibs[sibs.findIndex((k) => k.id === list.id) + 1];
        return { id, parent: list.parent_id, before: next?.id ?? null, y: b.bottom - top };
      }
      const lastRow = rows.at(-1);
      return lastRow ? { id, parent: null, before: null, y: lastRow.getBoundingClientRect().bottom - top } : null;
    };
    const move = (ev: globalThis.PointerEvent) => {
      if (!moving && Math.abs(ev.clientY - y0) < 5) return;
      if (!moving) {
        moving = true;
        setDragging(id);
        document.documentElement.classList.add("is-sorting-lists");
      }
      last = where(ev.clientY);
      setDrop(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.documentElement.classList.remove("is-sorting-lists");
      setDragging(null);
      setDrop(null);
      if (!moving || !last) return;
      swallow.current = Date.now() + 300;
      const st = useStore.getState();
      const sibs = childLists(st.lists, last.parent).filter((k) => k.id !== id);
      const at = last.before ? sibs.findIndex((k) => k.id === last!.before) : sibs.length;
      const prev = sibs[at - 1]?.position;
      const next = sibs[at]?.position;
      const position = prev === undefined ? (next === undefined ? 1 : next - 1) : next === undefined ? prev + 1 : (prev + next) / 2;
      const cur = st.lists.find((l) => l.id === id);
      if (!cur) return;
      void st.updateList(id, { position, ...(last.parent !== cur.parent_id ? { parent_id: last.parent } : {}) });
      if (last.into) void st.updateList(last.into, { collapsed: 0 });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // The click that ends a drag does not open the list.
  const swallowed = () => Date.now() < swallow.current;
  return { drop, dragging, start, swallowed };
}

function ListRow({ list, depth, counts, reorder }: { list: List; depth: number; counts: Map<string, number>; reorder: ReturnType<typeof useListReorder> }) {
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
        data-list={list.id}
        className={`nav-row ${sameView(view, me) ? "is-active" : ""} ${drop.over || reorder.drop?.into === list.id ? "is-drop" : ""} ${reorder.dragging === list.id ? "is-sorting" : ""}`}
        style={{ paddingLeft: 10 + depth * 18 }}
        onPointerDown={reorder.start(list.id)}
        onClick={() => !reorder.swallowed() && setView(me)}
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
        {depth === 0 && <ServerMark id={list.origin} />}
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
      {!list.collapsed && kids.map((k) => <ListRow key={k.id} list={k} depth={depth + 1} counts={counts} reorder={reorder} />)}
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
  // A sync error, or a server that needs an update.
  const syncError = useStore((s) => s.sync.status === "error" || !!s.sync.oldServers?.length);
  const lists = useStore((s) => s.lists);
  const sections = useStore((s) => s.sections);
  const tasks = useStore((s) => s.tasks);
  const settings = useStore((s) => s.settings);
  const width = useStore((s) => s.sidebarWidth);
  const addList = useStore((s) => s.addList);
  const setView = useStore((s) => s.setView);
  const [adding, setAdding] = useState(false);
  const listsBox = useRef<HTMLDivElement>(null);
  const hiddenRaw = useStore((s) => s.settings["sidebar:hidden"]);
  const hiddenSmart = useMemo(() => hiddenSmartViews({ "sidebar:hidden": hiddenRaw ?? "[]" }), [hiddenRaw]);
  const reorder = useListReorder(listsBox);
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
        {SMART_VIEWS.filter((v) => !hiddenSmart.includes(v.id)).map((v) => (
          <SmartRow key={v.id} id={v.id} name={v.name} count={countOpen({ kind: "smart", id: v.id }, data)} />
        ))}
      </div>
      <div className="nav-title">
        <span className="micro">Lists</span>
        <button type="button" className="icon-btn" title="New list" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="nav-group nav-lists" ref={listsBox}>
        {childLists(lists, null).map((l) => (
          <ListRow key={l.id} list={l} depth={0} counts={counts} reorder={reorder} />
        ))}
        {reorder.drop && !reorder.drop.into && <div className="drop-line nav-drop-line" style={{ transform: `translateY(${reorder.drop.y - 1}px)` }} />}
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
