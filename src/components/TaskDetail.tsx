import { useEffect, useRef, useState } from "react";
import { SubtaskList, useEditorScroll } from "./EditorParts";
import { formatDateTime, todayKey } from "../lib/dates";
import { matchList, parseQuick } from "../lib/quickparse";
import { PRIORITY_LABELS, orderedLists, subtasksOf } from "../lib/views";
import type { Task } from "../shared/schema";
import { useStore } from "../store";
import { Check, DateField, DeadlineField, Flag, FloatingPanel, Icon, MenuItem, Popover, Rich, usePresence } from "./ui";
import { hasLink } from "../lib/rich";

/** Text field that edits locally and saves shortly after typing stops, or on blur. */
function useDraft(value: string, taskId: string, save: (v: string) => void) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ draft, value, save });
  latest.current = { draft, value, save };
  const flush = () => {
    clearTimeout(timer.current);
    const { draft: d, value: v, save: s } = latest.current;
    if (d !== v) s(d);
  };
  // Switching tasks: save what was typed, then load the new text.
  useEffect(() => {
    setDraft(value);
    return flush;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
  // Pick up changes made elsewhere (sync, quick add) while not typing.
  useEffect(() => {
    if (document.activeElement?.getAttribute("data-draft") !== taskId) setDraft(value);
  }, [value, taskId]);
  return {
    value: draft,
    "data-draft": taskId,
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 500);
    },
    onBlur: flush,
  };
}

function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

type Draft = ReturnType<typeof useDraft>;


/**
 * A text field that shows its links as clickable links while not being edited.
 * Clicking anywhere else in the text switches to editing.
 */
function RichField({
  draft,
  className,
  placeholder,
  rows,
  singleLine,
}: {
  draft: Draft;
  className: string;
  placeholder: string;
  rows: number;
  singleLine?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => autoGrow(ref.current), [draft.value, editing]);
  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);
  if (!editing && draft.value && hasLink(draft.value)) {
    return (
      <div
        className={`${className} rich-view`}
        role="textbox"
        tabIndex={0}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("a")) return;
          e.preventDefault();
          setEditing(true);
        }}
        onFocus={() => setEditing(true)}
      >
        <Rich text={draft.value} />
      </div>
    );
  }
  return (
    <textarea
      ref={ref}
      className={className}
      rows={rows}
      placeholder={placeholder}
      {...draft}
      onBlur={() => {
        draft.onBlur();
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (singleLine && e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

function ListPicker({ listId, onPick, prefer = "above" }: { listId: string | null; onPick: (id: string | null) => void; prefer?: "above" | "below" }) {
  const lists = useStore((s) => s.lists);
  const list = lists.find((l) => l.id === listId);
  return (
    <Popover
      prefer={prefer}
      trigger={
        <span className="foot-trigger">
          {list ? <i className="dot" style={{ background: list.color }} /> : <Icon name="inbox" size={14} />}
          {list?.name ?? "Inbox"}
        </span>
      }
    >
      {(close) => (
        <div className="menu menu-scroll">
          <MenuItem active={!listId} onClick={() => { onPick(null); close(); }}>
            <Icon name="inbox" size={14} /> Inbox
          </MenuItem>
          {orderedLists(lists).map((l) => (
            <MenuItem key={l.id} active={l.id === listId} onClick={() => { onPick(l.id); close(); }}>
              <span style={{ paddingLeft: l.depth * 14 }} className="menu-label">
                <i className="dot" style={{ background: l.color }} /> {l.name}
              </span>
            </MenuItem>
          ))}
        </div>
      )}
    </Popover>
  );
}

function PriorityPicker({ priority, onPick }: { priority: number; onPick: (p: number) => void }) {
  return (
    <Popover align="right" title={`Priority: ${PRIORITY_LABELS[priority]}`} trigger={<span className="icon-btn"><Flag priority={priority} /></span>}>
      {(close) => (
        <div className="menu">
          {[3, 2, 1, 0].map((p) => (
            <MenuItem key={p} active={p === priority} onClick={() => { onPick(p); close(); }}>
              <Flag priority={p} size={15} /> {PRIORITY_LABELS[p]}
            </MenuItem>
          ))}
        </div>
      )}
    </Popover>
  );
}

/**
 * The task editor. `sheet`: the phone's sheet (`full`: pulled up to full
 * screen), with the list, deadline, priority and more in a row of their own
 * under the date, so long dates get the whole first row.
 */
export function TaskDetail({ task, variant, full = false }: { task: Task; variant: "pane" | "popup" | "sheet"; full?: boolean }) {
  const anchor = useStore((s) => s.anchor);
  const sections = useStore((s) => s.sections);
  const tasks = useStore((s) => s.tasks);
  const update = useStore((s) => s.updateTask);
  const toggle = useStore((s) => s.toggleTask);
  const del = useStore((s) => s.deleteTask);
  const duplicate = useStore((s) => s.duplicateTask);
  const wontDo = useStore((s) => s.setWontDo);
  const select = useStore((s) => s.select);
  const showDetails = useStore((s) => s.showDetails);
  const setShowDetails = useStore((s) => s.setShowDetails);
  const today = todayKey();

  const title = useDraft(task.title, task.id, (v) => void update(task.id, { title: v }));
  const notes = useDraft(task.notes, task.id, (v) => void update(task.id, { notes: v }));
  const bodyRef = useRef<HTMLDivElement>(null);
  useEditorScroll(bodyRef);

  const listSections = sections.filter((s) => s.list_id === task.list_id).sort((a, b) => a.position - b.position);
  const section = listSections.find((s) => s.id === task.section_id);
  const subs = subtasksOf(tasks, task.id);
  const parent = task.parent_id ? tasks.find((t) => t.id === task.parent_id) : null;
  const open = task.status === 0;

  const back = (
    <button type="button" className="icon-btn pane-back" title="Back" onClick={() => select(null)}>
      <Icon name="back" size={16} />
    </button>
  );
  const dates = (
    <>
      <DateField
        ghost
        date={task.start_date}
        time={task.start_time}
        placeholder="Date"
        tone={open && task.start_date !== null && task.start_date < today ? "overdue" : undefined}
        onChange={(d, t) =>
          void update(task.id, {
            start_date: d,
            start_time: d ? t : null,
            ...(d && task.end_date && task.end_date >= d ? {} : { end_date: null, end_time: null }),
          })
        }
      />
      {task.start_date && (
        <>
          <span className="arrow">–</span>
          <DateField
            ghost
            icon=""
            className="is-end"
            date={task.end_date ?? (task.end_time ? task.start_date : null)}
            time={task.end_time}
            placeholder="End"
            onChange={(d, t) => {
              const ok = d !== null && d >= task.start_date!;
              void update(task.id, { end_date: ok && d > task.start_date! ? d : null, end_time: ok ? t : null });
            }}
          />
        </>
      )}
    </>
  );
  const deadline = (
    <DeadlineField
      date={task.deadline_date}
      time={task.deadline_time}
      open={open}
      onChange={(d, t) => void update(task.id, { deadline_date: d, deadline_time: d ? t : null })}
    />
  );
  const priority = <PriorityPicker priority={task.priority} onPick={(p) => void update(task.id, { priority: p })} />;
  const listPart = (
    <>
      {!task.parent_id && <ListPicker prefer="above" listId={task.list_id} onPick={(id) => void update(task.id, { list_id: id })} />}
      {!task.parent_id && listSections.length > 0 && (
        <Popover prefer="above" trigger={<span className="foot-trigger is-quiet">{section?.name ?? "No section"}</span>}>
          {(close) => (
            <div className="menu menu-scroll">
              <MenuItem active={!section} onClick={() => { void update(task.id, { section_id: null }); close(); }}>No section</MenuItem>
              {listSections.map((s) => (
                <MenuItem key={s.id} active={s.id === task.section_id} onClick={() => { void update(task.id, { section_id: s.id }); close(); }}>
                  {s.name}
                </MenuItem>
              ))}
            </div>
          )}
        </Popover>
      )}
    </>
  );
  const more = (
    <Popover prefer="above" align="right" title="More" trigger={<span className="icon-btn"><Icon name="dots" /></span>}>
      {(close) => (
        <div className="menu">
          <MenuItem onClick={() => { void update(task.id, { pinned: task.pinned ? 0 : 1 }); close(); }}>
            <Icon name="pin" size={15} /> {task.pinned ? "Unpin" : "Pin"}
          </MenuItem>
          <MenuItem onClick={() => { void duplicate(task.id); close(); }}>
            <Icon name="copy" size={15} /> Duplicate
          </MenuItem>
          <MenuItem onClick={() => { void setShowDetails(!showDetails); close(); }}>
            <Icon name="notes" size={15} /> {showDetails ? "Hide Details" : "Show Details"}
          </MenuItem>
          {open && (
            <MenuItem onClick={() => { void wontDo(task.id); close(); }}>
              <Icon name="ban" size={15} /> Won't Do
            </MenuItem>
          )}
          <MenuItem danger onClick={() => { void del(task.id); close(); }}>
            <Icon name="trash" size={15} /> Delete
          </MenuItem>
        </div>
      )}
    </Popover>
  );

  return (
    <aside className={`detail detail-${variant === "sheet" ? "pane detail-sheet" : variant}`}>
      <header className="detail-head">
        {variant === "pane" && back}
        <Check done={!open} wontDo={task.status === 2} priority={task.priority} onToggle={() => void toggle(task.id)} />
        <i className="vr" />
        {dates}
        {variant !== "sheet" && (
          <>
            <span className="push" />
            {deadline}
            {priority}
          </>
        )}
        {variant === "pane" && (
          <button type="button" className="icon-btn pane-close" title="Close" onClick={() => select(null)}>
            <Icon name="x" size={14} />
          </button>
        )}
      </header>
      <div className="detail-body" ref={bodyRef}>
        {parent && (
          <button type="button" className="crumb" onClick={() => select(parent.id, anchor)}>
            <span className="flip"><Icon name="chevron" size={12} /></span> {parent.title}
          </button>
        )}
        <RichField draft={title} className="detail-title" rows={1} placeholder="What would you like to do?" singleLine />
        <RichField draft={notes} className="detail-notes" rows={1} placeholder="Description" />
        {!task.parent_id && <SubtaskList parent={task} subs={subs} onOpen={(id) => select(id, anchor)} />}
      </div>

      {variant === "sheet" && (
        <div className="detail-bar">
          {full && back}
          {listPart}
          <span className="push" />
          {deadline}
          {priority}
          {more}
        </div>
      )}
      {variant !== "sheet" && (
        <footer className="detail-foot">
          {listPart}
          <span className="push" />
          {more}
        </footer>
      )}
    </aside>
  );
}

/** The editor as a floating card next to whatever was clicked (board, timeline, calendar). */
export function TaskPopup({ task }: { task: Task | null }) {
  const anchor = useStore((s) => s.anchor);
  const select = useStore((s) => s.select);
  // Without a clicked element (a shortcut, a menu), open in the middle of the window.
  const at = anchor ?? { x: innerWidth / 2 - 210, y: 90, w: 0, h: 0 };
  const [shown, closing] = usePresence(task ? { task, at } : null);
  if (!shown) return null;
  return (
    <FloatingPanel anchor={shown.at} onClose={() => select(null)} className="task-popup" closing={closing}>
      <TaskDetail task={shown.task} variant="popup" />
    </FloatingPanel>
  );
}

/** New-task card: opens after dragging over days or hours in the calendar. */
export function Composer() {
  const composer = useStore((s) => s.composer);
  const close = useStore((s) => s.closeComposer);
  const addTask = useStore((s) => s.addTask);
  const lists = useStore((s) => s.lists);
  const [draft, setDraft] = useState<Partial<Task>>({});
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (!composer) return;
    setDraft(composer.base);
    setTitle("");
  }, [composer]);
  const [shown, closing] = usePresence(composer);
  if (!shown) return null;
  const today = todayKey();
  const d = { ...shown.base, ...draft };
  const create = () => {
    const p = parseQuick(title);
    if (!p.title) return close();
    const list = matchList(p.listQuery, lists);
    void addTask({
      ...d,
      title: p.title,
      ...(p.priority ? { priority: p.priority } : {}),
      ...(p.deadline_date ? { deadline_date: p.deadline_date, deadline_time: p.deadline_time } : {}),
      ...(p.start_time && !d.start_time ? { start_time: p.start_time } : {}),
      ...(list ? { list_id: list.id } : {}),
    });
    close();
  };
  const range =
    d.start_date &&
    `${formatDateTime(d.start_date, d.start_time ?? null, today)}${
      d.end_date ? ` – ${formatDateTime(d.end_date, d.end_time ?? null, today)}` : d.end_time ? ` – ${d.end_time}` : ""
    }`;
  return (
    <FloatingPanel anchor={shown.anchor} onClose={close} className="task-popup composer" closing={closing}>
      <div className="detail detail-popup">
        <header className="detail-head">
          <span className="composer-date accent-text">
            <Icon name="calendar" size={14} /> {range || "No date"}
          </span>
          <span className="push" />
          <DeadlineField
            date={d.deadline_date ?? null}
            time={d.deadline_time ?? null}
            onChange={(date, time) => setDraft({ ...draft, deadline_date: date, deadline_time: date ? time : null })}
          />
          <PriorityPicker priority={d.priority ?? 0} onPick={(p) => setDraft({ ...draft, priority: p })} />
        </header>
        <div className="detail-body">
          <input
            autoFocus
            className="detail-title"
            placeholder="What would you like to do?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
        </div>
        <footer className="detail-foot">
          <ListPicker listId={d.list_id ?? null} onPick={(id) => setDraft({ ...draft, list_id: id })} />
          <span className="push" />
          <button type="button" className="btn is-primary" disabled={!title.trim()} onClick={create}>
            Add
          </button>
        </footer>
      </div>
    </FloatingPanel>
  );
}
