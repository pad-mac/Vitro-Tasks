// Select mode (list and board): tasks and groups get circles, a tap selects,
// the header counts, and a bar at the bottom acts on all selected tasks.
// Also the undo button that follows a completion.
import { useState } from "react";
import { todayKey } from "../lib/dates";
import { haptic } from "../lib/platform";
import { PRIORITY_LABELS, orderedLists, type Group, type ViewRef } from "../lib/views";
import type { Task } from "../shared/schema";
import { useStore } from "../store";
import { DatePickerPanel, Flag, Icon, MenuItem, Popover } from "./ui";

/** The circle a task or group shows in select mode. */
export function SelectCircle({ on, partly = false }: { on: boolean; partly?: boolean }) {
  return (
    <span className={`sel-circle ${on ? "is-on" : ""} ${partly ? "is-partly" : ""}`} aria-hidden>
      {on && <Icon name="check" size={11} />}
    </span>
  );
}

/** A group's circle: selects or clears all of its tasks. */
export function GroupSelect({ tasks }: { tasks: Task[] }) {
  const selecting = useStore((s) => s.selecting);
  const setSelecting = useStore((s) => s.setSelecting);
  if (!selecting) return null;
  const ids = tasks.map((t) => t.id);
  const n = ids.filter((id) => selecting.includes(id)).length;
  const all = n > 0 && n === ids.length;
  return (
    <button
      type="button"
      className="sel-group"
      aria-label={all ? "Clear the group" : "Select the group"}
      onClick={(e) => {
        e.stopPropagation();
        haptic("selection");
        setSelecting(all ? selecting.filter((id) => !ids.includes(id)) : [...new Set([...selecting, ...ids])]);
      }}
    >
      <SelectCircle on={all} partly={n > 0 && !all} />
    </button>
  );
}

/** In select mode, a tap on a task selects it instead of opening it. Returns true when handled. */
export function selectTap(id: string): boolean {
  const st = useStore.getState();
  if (!st.selecting) return false;
  haptic("selection");
  st.toggleSelected(id);
  return true;
}

/** The header while selecting: Select All, the count, done. */
export function SelectHead({ title, groups }: { title: string; groups: Group[] }) {
  const selecting = useStore((s) => s.selecting) ?? [];
  const setSelecting = useStore((s) => s.setSelecting);
  const all = groups.flatMap((g) => g.tasks.map((t) => t.id));
  const allOn = all.length > 0 && all.every((id) => selecting.includes(id));
  return (
    <header className="view-head sel-head">
      <button type="button" className="sel-pill" onClick={() => setSelecting(allOn ? [] : all)}>
        {allOn ? "Deselect All" : "Select All"}
      </button>
      <div className="sel-title">
        <strong>{title}</strong>
        <span>{selecting.length} Selected</span>
      </div>
      <button type="button" className="sel-done" title="Done" onClick={() => setSelecting(null)}>
        <Icon name="check" size={18} />
      </button>
    </header>
  );
}

/** The bar at the bottom: date, list, section, delete, and more. */
export function SelectBar({ view }: { view: ViewRef }) {
  const selecting = useStore((s) => s.selecting) ?? [];
  const tasks = useStore((s) => s.tasks);
  const lists = useStore((s) => s.lists);
  const sections = useStore((s) => s.sections);
  const update = useStore((s) => s.updateTask);
  const del = useStore((s) => s.deleteTask);
  const complete = useStore((s) => s.completeTasks);
  const wontDo = useStore((s) => s.setWontDo);
  const duplicate = useStore((s) => s.duplicateTask);
  const setSelecting = useStore((s) => s.setSelecting);
  const [confirm, setConfirm] = useState(false);
  const chosen = tasks.filter((t) => selecting.includes(t.id));
  const none = chosen.length === 0;
  const each = (patch: Partial<Task>) => {
    for (const t of chosen) void update(t.id, patch);
  };
  // Lists and sections take top-level tasks (their subtasks follow them); a subtask stays with its parent.
  const place = (patch: Partial<Task>) => {
    for (const t of chosen) if (!t.parent_id) void update(t.id, patch);
  };
  const listSections = view.kind === "list" ? sections.filter((s) => s.list_id === view.id).sort((a, b) => a.position - b.position) : [];
  const done = () => setSelecting(null);
  const today = todayKey();
  return (
    <div className={`sel-bar ${none ? "is-empty" : ""}`} role="toolbar" aria-label="Selected tasks">
      <Popover prefer="above" title="Date" trigger={<span className="sel-btn"><Icon name="calendar" size={19} /></span>}>
        {(close) => (
          <div className="date-pop">
            <DatePickerPanel
              date={chosen.length === 1 ? chosen[0].start_date : null}
              time={null}
              onChange={(d, t) => each({ start_date: d, start_time: d ? t : null, end_date: null, end_time: null })}
              onDone={() => {
                close();
                done();
              }}
            />
          </div>
        )}
      </Popover>
      <Popover prefer="above" title="Move to list" trigger={<span className="sel-btn"><Icon name="move" size={19} /></span>}>
        {(close) => (
          <div className="menu menu-scroll">
            <MenuItem onClick={() => { place({ list_id: null, section_id: null }); close(); done(); }}>
              <Icon name="inbox" size={15} /> Inbox
            </MenuItem>
            {orderedLists(lists).map((l) => (
              <MenuItem key={l.id} onClick={() => { place({ list_id: l.id, section_id: null }); close(); done(); }}>
                <i className="dot" style={{ background: l.color }} /> {l.name}
              </MenuItem>
            ))}
          </div>
        )}
      </Popover>
      {listSections.length > 0 && (
        <Popover prefer="above" title="Move to section" trigger={<span className="sel-btn"><Icon name="layers" size={19} /></span>}>
          {(close) => (
            <div className="menu menu-scroll">
              <MenuItem onClick={() => { place({ section_id: null }); close(); done(); }}>No section</MenuItem>
              {listSections.map((s) => (
                <MenuItem key={s.id} onClick={() => { place({ section_id: s.id }); close(); done(); }}>
                  {s.name}
                </MenuItem>
              ))}
            </div>
          )}
        </Popover>
      )}
      <button
        type="button"
        className={`sel-btn ${confirm ? "is-confirm" : ""}`}
        title="Delete"
        disabled={none}
        onClick={() => {
          if (!confirm) {
            setConfirm(true);
            setTimeout(() => setConfirm(false), 2500);
            return;
          }
          // A parent takes its subtasks with it.
          for (const t of chosen) if (!t.parent_id || !selecting.includes(t.parent_id)) void del(t.id);
          setConfirm(false);
          done();
        }}
      >
        <Icon name="trash" size={19} />
        {confirm && <span>Delete {chosen.length}</span>}
      </button>
      <Popover prefer="above" align="right" title="More" trigger={<span className="sel-btn"><Icon name="dots" size={19} /></span>}>
        {(close) => (
          <div className="menu cm">
            <div className="cm-group">
              <span className="cm-label">Priority</span>
              <div className="cm-icons">
                {[3, 2, 1, 0].map((p) => (
                  <button type="button" key={p} className="cm-icon" title={PRIORITY_LABELS[p]} onClick={() => { each({ priority: p }); close(); done(); }}>
                    <Flag priority={p} size={16} />
                  </button>
                ))}
              </div>
            </div>
            <div className="cm-sep" />
            <MenuItem onClick={() => { void complete(chosen.map((t) => t.id)); close(); done(); }}>
              <Icon name="done" size={15} /> Complete
            </MenuItem>
            <MenuItem onClick={() => { for (const t of chosen) void wontDo(t.id); close(); done(); }}>
              <Icon name="ban" size={15} /> Won't Do
            </MenuItem>
            <MenuItem onClick={() => { const pin = chosen.some((t) => !t.pinned) ? 1 : 0; each({ pinned: pin }); close(); done(); }}>
              <Icon name="pin" size={15} /> {chosen.some((t) => !t.pinned) ? "Pin" : "Unpin"}
            </MenuItem>
            <MenuItem onClick={() => { each({ deadline_date: today, deadline_time: null }); close(); done(); }}>
              <Icon name="deadline" size={15} /> Deadline Today
            </MenuItem>
            <MenuItem onClick={() => { for (const t of chosen) if (!t.parent_id || !selecting.includes(t.parent_id)) void duplicate(t.id); close(); done(); }}>
              <Icon name="copy" size={15} /> Duplicate
            </MenuItem>
          </div>
        )}
      </Popover>
    </div>
  );
}

/** "Undo" after completing a task; it stays until the view changes. */
export function UndoButton() {
  const undo = useStore((s) => s.undo);
  const undoLast = useStore((s) => s.undoLast);
  const selecting = useStore((s) => s.selecting);
  if (!undo || selecting) return null;
  return (
    <button type="button" className="undo-btn" onClick={() => void undoLast()}>
      <Icon name="undo" size={15} />
      Undo
    </button>
  );
}
