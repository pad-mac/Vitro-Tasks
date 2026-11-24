// The app's own right-click menus: tasks, lists, the view-layer buttons and detached windows.
import { useState } from "react";
import { addDays, deadlineCountdown, formatDateTime, todayKey } from "../lib/dates";
import { openLayerWindow, windowAction } from "../lib/platform";
import { PRIORITY_LABELS, listVisibility, orderedLists } from "../lib/views";
import { PALETTES, PALETTE_COLORS, defaultPalette } from "../lib/palettes";
import { useStore, type MenuTarget } from "../store";
import { DatePickerPanel, Flag, FloatingPanel, Icon, MenuItem, ServerMark, ToggleItem, usePresence } from "./ui";
import { holdMenu, taskElement } from "./HoldMenu";

/** A row of icon buttons (dates, priorities): no heading, the icons say it. */
function IconRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cm-group" role="group" aria-label={label}>
      <div className="cm-icons">{children}</div>
    </div>
  );
}

function SubHead({ title, onBack, children }: { title: string; onBack: () => void; children?: React.ReactNode }) {
  return (
    <div className="cm-subhead-row">
      <button type="button" className="cm-subhead" onClick={onBack}>
        <Icon name="back" size={14} /> {title}
      </button>
      {children}
    </div>
  );
}

function TaskMenu({ id, at, page: initial, close }: { id: string; at: { x: number; y: number }; page?: "date" | "deadline" | "move"; close: () => void }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === id));
  const lists = useStore((s) => s.lists);
  const update = useStore((s) => s.updateTask);
  const del = useStore((s) => s.deleteTask);
  const duplicate = useStore((s) => s.duplicateTask);
  const wontDo = useStore((s) => s.setWontDo);
  const toggle = useStore((s) => s.toggleTask);
  const addSubtaskTo = useStore((s) => s.addSubtaskTo);
  const [page, setPage] = useState<"main" | "move" | "date" | "deadline">(initial ?? "main");
  const [edge, setEdge] = useState<"start" | "end">("start");
  if (!task) return null;
  const today = todayKey();
  const run = (fn: () => unknown) => () => {
    void fn();
    close();
  };
  // Opened from the phone's hold menu (a page given): back goes to that menu, not to this one's first page.
  const back = () => {
    if (!initial) return setPage("main");
    close();
    const el = taskElement(id);
    if (el) setTimeout(() => holdMenu.open(el, true), 60);
  };

  if (page === "move") {
    return (
      <div className="menu menu-scroll">
        <SubHead title="Move to" onBack={back} />
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
  if (page === "date") {
    const start = task.start_date;
    const end = task.end_date ?? (task.end_time ? start : null);
    const span: [string, string] | null = start && end ? [start, end] : null;
    const isEnd = edge === "end" && !!start;
    return (
      <div className="menu cm-picker">
        <SubHead title="Date" onBack={back}>
          <div className="seg" role="tablist" aria-label="Start or end">
            <button type="button" role="tab" aria-selected={!isEnd} className={!isEnd ? "is-active" : ""} onClick={() => setEdge("start")}>
              Start
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isEnd}
              className={isEnd ? "is-active" : ""}
              disabled={!start}
              title={start ? "End date and time" : "Set a start date first"}
              onClick={() => setEdge("end")}
            >
              End
            </button>
          </div>
        </SubHead>
        {isEnd ? (
          <DatePickerPanel
            key="end"
            date={end}
            time={task.end_time}
            min={start}
            range={span}
            picks={[
              ["+1 day", addDays(start!, 1)],
              ["+2 days", addDays(start!, 2)],
              ["+1 week", addDays(start!, 7)],
            ]}
            onChange={(d, t) => {
              const ok = d !== null && d >= start!;
              void update(id, { end_date: ok && d > start! ? d : null, end_time: ok ? t : null });
            }}
            onDone={close}
          />
        ) : (
          <DatePickerPanel
            key="start"
            date={start}
            time={task.start_time}
            range={span}
            repeat={task.parent_id ? undefined : task.repeat}
            onRepeat={task.parent_id ? undefined : (r) => void update(id, { repeat: r })}
            onChange={(d, t) =>
              void update(id, {
                start_date: d,
                start_time: d ? t : null,
                ...(d && task.end_date && task.end_date >= d ? {} : { end_date: null, end_time: null }),
              })
            }
            onDone={close}
          />
        )}
      </div>
    );
  }
  if (page === "deadline") {
    return (
      <div className="menu cm-picker">
        <SubHead title="Deadline" onBack={back} />
        <DatePickerPanel
          date={task.deadline_date}
          time={task.deadline_time}
          onChange={(d, t) => void update(id, { deadline_date: d, deadline_time: d ? t : null })}
          onDone={close}
        />
      </div>
    );
  }

  const dates: [string, string, string][] = [
    ["today", "Today", today],
    ["tomorrow", "Tomorrow", addDays(today, 1)],
    ["nextweek", "Next week (in 7 days)", addDays(today, 7)],
  ];
  return (
    <div className="menu cm cm-task">
      <IconRow label="Date">
        {dates.map(([icon, title, d]) => (
          <button
            type="button"
            key={title}
            title={title}
            className={`cm-icon ${task.start_date === d ? "is-active" : ""}`}
            onClick={run(() => update(id, { start_date: d, end_date: null, end_time: null }))}
          >
            <Icon name={icon} size={20} />
          </button>
        ))}
        <button type="button" title="Pick a date" className="cm-icon" onClick={() => setPage("date")}>
          <Icon name="pickdate" size={20} />
        </button>
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
      {/* With a deadline, the item shows it (red mark, the date, the days left) instead of a label. */}
      <button type="button" className={`menu-item ${task.deadline_date ? "has-deadline" : ""}`} onClick={() => setPage("deadline")}>
        <span className="menu-label">
          <Icon name="deadline" size={15} />
          {task.deadline_date ? (
            <span className="cm-deadline">
              {formatDateTime(task.deadline_date, task.deadline_time, today)}
              {task.status === 0 && <em>{deadlineCountdown(task.deadline_date, today)}</em>}
            </span>
          ) : (
            "Add deadline"
          )}
        </span>
        <Icon name="chevron" size={12} />
      </button>
      <div className="cm-sep" />
      {!task.parent_id && (
        <MenuItem onClick={run(() => addSubtaskTo(id, { x: at.x, y: at.y, w: 0, h: 0 }))}>
          <Icon name="subtask" size={15} /> Add Subtask
        </MenuItem>
      )}
      {!task.parent_id && (
        <button type="button" className="menu-item" onClick={() => setPage("move")}>
          <span className="menu-label">
            <Icon name="move" size={15} /> Move to
          </span>
          <Icon name="chevron" size={12} />
        </button>
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
  const settings = useStore((s) => s.settings);
  const openCount = useStore((s) => s.tasks.filter((t) => t.list_id === id && t.status === 0).length);
  const updateList = useStore((s) => s.updateList);
  const deleteList = useStore((s) => s.deleteList);
  const addList = useStore((s) => s.addList);
  const setRenaming = useStore((s) => s.setRenamingList);
  const setVisibility = useStore((s) => s.setListVisibility);
  const servers = useStore((s) => s.servers);
  const moveToServer = useStore((s) => s.moveListToServer);
  const [confirm, setConfirm] = useState(false);
  const [page, setPage] = useState<"main" | "colors">("main");
  const allLists = useStore((s) => s.lists);
  if (!list) return null;
  const vis = listVisibility(settings, id);
  const palette = defaultPalette(settings);
  const color = list.color.toLowerCase();
  if (page === "colors") {
    // Custom: colours lists have that are in no palette (this list's first).
    const custom = [...new Set([color, ...allLists.map((l) => l.color.toLowerCase())])].filter((c) => /^#[0-9a-f]{6}$/.test(c) && !PALETTE_COLORS.has(c)).slice(0, 7);
    return (
      <div className="menu cm cm-colors">
        <SubHead title="Colour" onBack={() => setPage("main")} />
        {PALETTES.map((p) => (
          <div key={p.id} className="palette-group">
            <span className="cm-label">{p.name}</span>
            <div className="swatches">
              {p.colors.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`swatch ${c === color ? "is-active" : ""}`}
                  style={{ background: c }}
                  aria-label={`${p.name} ${c}`}
                  onClick={() => void updateList(id, { color: c })}
                />
              ))}
            </div>
          </div>
        ))}
        <div className="palette-group">
          <span className="cm-label">Custom</span>
          <div className="swatches">
            {/* Any colour: the system's colour picker; saved when it closes. */}
            <label className="swatch swatch-add" title="Pick any colour">
              <Icon name="plus" size={11} />
              <input
                type="color"
                defaultValue={color}
                ref={(el) => {
                  if (el) el.onchange = () => void updateList(id, { color: el.value });
                }}
              />
            </label>
            {custom.map((c) => (
              <button
                type="button"
                key={c}
                className={`swatch ${c === color ? "is-active" : ""}`}
                style={{ background: c }}
                aria-label={`Custom ${c}`}
                onClick={() => void updateList(id, { color: c })}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }
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
      {servers.length > 1 && !list.parent_id && (
        <>
          <div className="cm-sep" />
          {servers.map((x) => (
            <MenuItem key={x.id} active={x.id === list.origin} onClick={() => { if (x.id !== list.origin) void moveToServer(id, x.id); close(); }}>
              <ServerMark id={x.id} /> {x.id === list.origin ? `On ${x.name}` : `Move to ${x.name}`}
            </MenuItem>
          ))}
          <div className="cm-sep" />
        </>
      )}
      {/* The default palette; the last circle opens every palette and custom colours. */}
      <div className="swatches">
        {palette.colors.map((c) => (
          <button
            type="button"
            key={c}
            className={`swatch ${c === color ? "is-active" : ""}`}
            style={{ background: c }}
            aria-label={`Colour ${c}`}
            onClick={() => void updateList(id, { color: c })}
          />
        ))}
        <button
          type="button"
          className={`swatch swatch-more ${palette.colors.includes(color) ? "" : "is-active"}`}
          style={palette.colors.includes(color) ? undefined : { background: color }}
          title="More colours"
          aria-label="More colours"
          onClick={() => setPage("colors")}
        />
      </div>
      <div className="cm-sep" />
      <span className="cm-label">Show tasks in</span>
      <ToggleItem on={vis.all} onToggle={() => void setVisibility(id, "all", !vis.all)}>
        <Icon name="layers" size={15} /> All
      </ToggleItem>
      <ToggleItem on={vis.today} onToggle={() => void setVisibility(id, "today", !vis.today)}>
        <Icon name="sun" size={15} /> Today and Next 7 Days
      </ToggleItem>
      <ToggleItem on={vis.calendar} onToggle={() => void setVisibility(id, "calendar", !vis.calendar)}>
        <Icon name="calendar" size={15} /> Calendar
      </ToggleItem>
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

function LayerMenu({ layer, close }: { layer: "tasks" | "calendar"; close: () => void }) {
  const view = useStore((s) => s.view);
  const lastTaskView = useStore((s) => s.lastTaskView);
  return (
    <div className="menu cm">
      <MenuItem
        onClick={() => {
          void openLayerWindow(layer, layer === "calendar" ? { kind: "calendar" } : view.kind === "calendar" ? lastTaskView : view);
          close();
        }}
      >
        <Icon name="window" size={15} /> Open {layer === "tasks" ? "Tasks" : "Calendar"} in a new window
      </MenuItem>
    </div>
  );
}

function WindowMenu({ close }: { close: () => void }) {
  return (
    <div className="menu cm">
      <MenuItem onClick={() => { void windowAction("minimize"); close(); }}>
        <Icon name="winmin" size={15} /> Minimize
      </MenuItem>
      <MenuItem onClick={() => { void windowAction("toggleMaximize"); close(); }}>
        <Icon name="winmax" size={15} /> Maximize / Restore
      </MenuItem>
      <MenuItem onClick={() => { void windowAction("close"); close(); }}>
        <Icon name="x" size={15} /> Close window
      </MenuItem>
    </div>
  );
}

function MenuBody({ menu, close }: { menu: MenuTarget; close: () => void }) {
  switch (menu.kind) {
    case "task":
      return <TaskMenu id={menu.id} at={menu} page={menu.page} close={close} />;
    case "list":
      return <ListMenu id={menu.id} close={close} />;
    case "layer":
      return <LayerMenu layer={menu.id} close={close} />;
    default:
      return <WindowMenu close={close} />;
  }
}

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const openMenu = useStore((s) => s.openMenu);
  const [shown, closing] = usePresence(menu, 110);
  if (!shown) return null;
  const close = () => openMenu(null);
  return (
    <FloatingPanel
      key={`${shown.kind}:${shown.id}:${shown.x}:${shown.y}`}
      anchor={{ x: shown.x, y: shown.y, w: 0, h: "h" in shown ? (shown.h ?? 0) : 0 }}
      placement="below"
      onClose={close}
      className="context-menu"
      closing={closing}
    >
      <MenuBody menu={shown} close={close} />
    </FloatingPanel>
  );
}
