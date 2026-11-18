// Phone sheets: the task editor and the add sheet, built for touch. Both
// share the property list (date, deadline, priority, list) whose pickers open
// in place under their row instead of floating over the sheet.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { addDays, deadlineCountdown, formatDateTime, todayKey } from "../lib/dates";
import { haptic } from "../lib/platform";
import { parseQuick } from "../lib/quickparse";
import { PRIORITY_LABELS, defaultsForView, orderedLists, subtasksOf } from "../lib/views";
import { ParsedChips } from "../QuickAdd";
import type { Section, Task } from "../shared/schema";
import { useStore } from "../store";
import { SuggestList, useListSuggest } from "./ListSuggest";
import { useCreateTask } from "./tasks";
import { RichField, useDraft } from "./TaskDetail";
import { Check, Flag, Icon, MiniCalendar, Rich, usePresence } from "./ui";

// ---------- Sheet gesture ----------

/**
 * Dragging a sheet by its top or its content: up to full screen, down to half
 * or closed. Native listeners, so a drag can stop the content from scrolling
 * along (React's touch handlers are passive).
 */
function useSheetGesture(
  ref: RefObject<HTMLElement | null>,
  opts: { enabled: boolean; full: boolean; onFull: () => void; onHalf: () => void; onClose: () => void },
) {
  const [drag, setDrag] = useState(0);
  const o = useRef(opts);
  o.current = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el || !opts.enabled) return;
    let g: { x: number; y: number; lastY: number; lastT: number; v: number; active: boolean; scroller: HTMLElement | null } | null = null;
    const start = (e: TouchEvent) => {
      const t = e.target as HTMLElement;
      g = null;
      if (e.touches.length !== 1) return;
      if (t.closest("input, textarea, [contenteditable='true'], .p-lists, .floating, .pop-panel")) return;
      const top = !!t.closest(".p-sheet-top");
      const scroller = t.closest<HTMLElement>(".p-scroll");
      // Full screen: only the top, or a pull down from the top of the content.
      if (o.current.full && !top && scroller && scroller.scrollTop > 0) return;
      g = { x: e.touches[0].clientX, y: e.touches[0].clientY, lastY: e.touches[0].clientY, lastT: Date.now(), v: 0, active: false, scroller };
    };
    const move = (e: TouchEvent) => {
      if (!g) return;
      const t = e.touches[0];
      const dy = t.clientY - g.y;
      if (!g.active) {
        if (Math.abs(dy) < 8) return;
        if (Math.abs(t.clientX - g.x) > Math.abs(dy)) return void (g = null);
        // Full screen: pushing up scrolls the content.
        if (o.current.full && dy < 0) return void (g = null);
        g.active = true;
      }
      e.preventDefault();
      const now = Date.now();
      g.v = (t.clientY - g.lastY) / Math.max(1, now - g.lastT);
      g.lastY = t.clientY;
      g.lastT = now;
      setDrag(o.current.full ? Math.max(0, dy) : dy < 0 ? dy * 0.5 : dy);
    };
    const end = () => {
      const cur = g;
      g = null;
      if (!cur?.active) return;
      const dy = cur.lastY - cur.y;
      setDrag(0);
      if (!o.current.full && (dy < -40 || cur.v < -0.45)) {
        o.current.onFull();
        haptic("light");
      } else if (o.current.full && (dy > 90 || cur.v > 0.6)) o.current.onHalf();
      else if (!o.current.full && (dy > 80 || cur.v > 0.6)) o.current.onClose();
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [ref, opts.enabled]);
  return drag;
}

// ---------- Pickers ----------

type DayPick = [label: string, day: string];

/** Quick picks, a month and a time (the system's time wheel). */
function DayPicker({
  date,
  time,
  onChange,
  min,
  range,
  picks,
  clearLabel = "Remove date",
}: {
  date: string | null;
  time: string | null;
  onChange: (date: string | null, time: string | null) => void;
  min?: string | null;
  range?: [string, string] | null;
  picks?: DayPick[];
  clearLabel?: string;
}) {
  const today = todayKey();
  const quick: DayPick[] = picks ?? [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["Next week", addDays(today, 7)],
  ];
  return (
    <>
      <div className="p-quick">
        {quick.map(([label, d]) => (
          <button type="button" key={label} className={`p-chip ${d === date ? "is-on" : ""}`} disabled={!!min && d < min} onClick={() => onChange(d, time)}>
            {label}
          </button>
        ))}
      </div>
      <MiniCalendar key={(date ?? min ?? today).slice(0, 7)} value={date} onPick={(d) => onChange(d, time)} min={min} range={range} />
      <label className="p-time">
        <Icon name="clock" size={17} />
        <span>Time</span>
        <input type="time" value={time ?? ""} onChange={(e) => onChange(date ?? min ?? today, e.target.value || null)} />
        {time && (
          <button type="button" className="p-time-clear" aria-label="No time" onClick={(e) => { e.preventDefault(); onChange(date, null); }}>
            <Icon name="x" size={13} />
          </button>
        )}
      </label>
      {date && (
        <button type="button" className="p-clear" onClick={() => onChange(null, null)}>
          {clearLabel}
        </button>
      )}
    </>
  );
}

export interface PropValues {
  start_date?: string | null;
  start_time?: string | null;
  end_date?: string | null;
  end_time?: string | null;
  deadline_date?: string | null;
  deadline_time?: string | null;
  priority?: number;
  list_id?: string | null;
  section_id?: string | null;
}

/** Start and end of a task: a Start / End switch over one picker. */
function SpanPicker({ v, onChange }: { v: PropValues; onChange: (patch: PropValues) => void }) {
  const [edge, setEdge] = useState<"start" | "end">("start");
  const start = v.start_date ?? null;
  const end = v.end_date ?? null;
  const atEnd = edge === "end" && !!start;
  const setStart = (d: string | null, t: string | null) =>
    onChange({ start_date: d, start_time: d ? t : null, ...(d && end && end >= d ? {} : { end_date: null, end_time: null }) });
  const setEnd = (d: string | null, t: string | null) => {
    if (!start) return;
    const ok = d !== null && d >= start;
    onChange({ end_date: ok && d > start ? d : null, end_time: ok ? t : null });
  };
  return (
    <>
      {start && (
        <div className="p-seg">
          <button type="button" className={!atEnd ? "is-on" : ""} onClick={() => setEdge("start")}>
            Start
          </button>
          <button type="button" className={atEnd ? "is-on" : ""} onClick={() => setEdge("end")}>
            End
          </button>
        </div>
      )}
      {atEnd ? (
        <DayPicker
          date={end ?? (v.end_time ? start : null)}
          time={v.end_time ?? null}
          min={start}
          range={end ? [start!, end] : null}
          picks={[
            ["+1 day", addDays(start!, 1)],
            ["+2 days", addDays(start!, 2)],
            ["+1 week", addDays(start!, 7)],
          ]}
          onChange={setEnd}
          clearLabel="Remove end"
        />
      ) : (
        <DayPicker date={start} time={v.start_time ?? null} range={start && end ? [start, end] : null} onChange={setStart} />
      )}
    </>
  );
}

function PriorityChoice({ value, onPick }: { value: number; onPick: (p: number) => void }) {
  return (
    <div className="p-prio">
      {[3, 2, 1, 0].map((p) => (
        <button type="button" key={p} className={`p-prio-btn ${p === value ? "is-on" : ""}`} onClick={() => onPick(p)}>
          <Flag priority={p} size={20} />
          <span>{PRIORITY_LABELS[p]}</span>
        </button>
      ))}
    </div>
  );
}

function ListChoice({ value, onPick }: { value: string | null; onPick: (id: string | null) => void }) {
  const lists = useStore((s) => s.lists);
  const rows: { id: string | null; name: string; color?: string; depth: number }[] = [{ id: null, name: "Inbox", depth: 0 }, ...orderedLists(lists)];
  return (
    <div className="p-lists">
      {rows.map((l) => (
        <button type="button" key={l.id ?? "inbox"} className={`p-list-row ${l.id === value ? "is-on" : ""}`} style={{ paddingLeft: 14 + l.depth * 18 }} onClick={() => onPick(l.id)}>
          {l.id ? <i className="dot" style={{ background: l.color }} /> : <Icon name="inbox" size={16} />}
          <span>{l.name}</span>
          {l.id === value && <Icon name="check" size={16} />}
        </button>
      ))}
    </div>
  );
}

function SectionChoice({ sections, value, onPick }: { sections: Section[]; value: string | null; onPick: (id: string | null) => void }) {
  return (
    <div className="p-lists">
      {[{ id: null as string | null, name: "No section" }, ...sections].map((s) => (
        <button type="button" key={s.id ?? "none"} className={`p-list-row ${s.id === value ? "is-on" : ""}`} onClick={() => onPick(s.id)}>
          <span>{s.name}</span>
          {s.id === value && <Icon name="check" size={16} />}
        </button>
      ))}
    </div>
  );
}

export type PropKey = "date" | "deadline" | "priority" | "list" | "section";

/** One property: a full-width row (icon, name, value) whose picker opens under it. */
function PropRow({
  id,
  open,
  setOpen,
  icon,
  label,
  value,
  tone,
  children,
}: {
  id: PropKey;
  open: PropKey | null;
  setOpen: (k: PropKey | null) => void;
  icon: ReactNode;
  label: string;
  value: string;
  tone?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isOpen = open === id;
  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [isOpen]);
  return (
    <div className={`p-item ${isOpen ? "is-open" : ""}`} ref={ref}>
      <button type="button" className="p-row" onClick={() => setOpen(isOpen ? null : id)}>
        <span className="p-ico">{icon}</span>
        <span className="p-label">{label}</span>
        <span className={`p-value ${value ? tone ?? "" : "is-empty"}`}>{value || "None"}</span>
        <span className="p-chev">
          <Icon name="chevron" size={13} />
        </span>
      </button>
      {isOpen && <div className="p-picker">{children}</div>}
    </div>
  );
}

/** Date, deadline, priority, list (and section) as one grouped list. */
export function PropGroup({
  v,
  onChange,
  open,
  setOpen,
  sub,
  sections = [],
}: {
  v: PropValues;
  onChange: (patch: PropValues) => void;
  open: PropKey | null;
  setOpen: (k: PropKey | null) => void;
  /** A subtask: no list or section of its own. */
  sub?: boolean;
  sections?: Section[];
}) {
  const lists = useStore((s) => s.lists);
  const today = todayKey();
  const list = lists.find((l) => l.id === v.list_id);
  const start = v.start_date ?? null;
  const dateText = start
    ? `${formatDateTime(start, v.start_time ?? null, today)}${
        v.end_date ? ` – ${formatDateTime(v.end_date, v.end_time ?? null, today)}` : v.end_time ? ` – ${v.end_time}` : ""
      }`
    : "";
  const dl = v.deadline_date ?? null;
  const dlText = dl ? `${formatDateTime(dl, v.deadline_time ?? null, today)} · ${deadlineCountdown(dl, today)}` : "";
  const p = v.priority ?? 0;
  const section = sections.find((s) => s.id === v.section_id);
  return (
    <div className="p-group">
      <PropRow id="date" open={open} setOpen={setOpen} icon={<Icon name="calendar" size={18} />} label="Date" value={dateText} tone={start && start < today ? "is-over" : ""}>
        <SpanPicker v={v} onChange={onChange} />
      </PropRow>
      <PropRow id="deadline" open={open} setOpen={setOpen} icon={<Icon name="deadline" size={18} />} label="Deadline" value={dlText} tone="is-signal">
        <DayPicker date={dl} time={v.deadline_time ?? null} clearLabel="Remove deadline" onChange={(d, t) => onChange({ deadline_date: d, deadline_time: d ? t : null })} />
      </PropRow>
      <PropRow id="priority" open={open} setOpen={setOpen} icon={<Flag priority={p} size={18} />} label="Priority" value={p ? PRIORITY_LABELS[p] : ""} tone={`is-p${p}`}>
        <PriorityChoice
          value={p}
          onPick={(x) => {
            onChange({ priority: x });
            setOpen(null);
          }}
        />
      </PropRow>
      {!sub && (
        <PropRow
          id="list"
          open={open}
          setOpen={setOpen}
          icon={list ? <i className="dot p-dot" style={{ background: list.color }} /> : <Icon name="inbox" size={18} />}
          label="List"
          value={list?.name ?? "Inbox"}
        >
          <ListChoice
            value={v.list_id ?? null}
            onPick={(id) => {
              onChange({ list_id: id, ...(id !== v.list_id ? { section_id: null } : {}) });
              setOpen(null);
            }}
          />
        </PropRow>
      )}
      {!sub && sections.length > 0 && (
        <PropRow id="section" open={open} setOpen={setOpen} icon={<Icon name="list" size={18} />} label="Section" value={section?.name ?? ""}>
          <SectionChoice
            sections={sections}
            value={v.section_id ?? null}
            onPick={(id) => {
              onChange({ section_id: id });
              setOpen(null);
            }}
          />
        </PropRow>
      )}
    </div>
  );
}

// ---------- Task editor ----------

function PhoneTaskEditor({ task, onDone }: { task: Task; onDone: () => void }) {
  const anchor = useStore((s) => s.anchor);
  const sections = useStore((s) => s.sections);
  const tasks = useStore((s) => s.tasks);
  const update = useStore((s) => s.updateTask);
  const toggle = useStore((s) => s.toggleTask);
  const addTask = useStore((s) => s.addTask);
  const del = useStore((s) => s.deleteTask);
  const duplicate = useStore((s) => s.duplicateTask);
  const wontDo = useStore((s) => s.setWontDo);
  const select = useStore((s) => s.select);
  const focusSubtask = useStore((s) => s.focusSubtask);
  const [open, setOpen] = useState<PropKey | null>(null);
  const [sub, setSub] = useState("");
  const title = useDraft(task.title, task.id, (v) => void update(task.id, { title: v }));
  const notes = useDraft(task.notes, task.id, (v) => void update(task.id, { notes: v }));
  const subRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSubtask) subRef.current?.focus();
  }, [focusSubtask, task.id]);

  const listSections = sections.filter((s) => s.list_id === task.list_id).sort((a, b) => a.position - b.position);
  const subs = subtasksOf(tasks, task.id);
  const parent = task.parent_id ? tasks.find((t) => t.id === task.parent_id) : null;
  const isOpen = task.status === 0;
  const addSub = () => {
    if (!sub.trim()) return;
    void addTask({ title: sub.trim(), parent_id: task.id, list_id: task.list_id });
    setSub("");
  };

  return (
    <div className="p-editor">
      {parent && (
        <button type="button" className="p-crumb" onClick={() => select(parent.id, anchor)}>
          <span className="flip">
            <Icon name="chevron" size={13} />
          </span>
          <span>{parent.title}</span>
        </button>
      )}
      <div className="p-title-row">
        <Check done={!isOpen} wontDo={task.status === 2} priority={task.priority} onToggle={() => void toggle(task.id)} />
        <RichField draft={title} className="p-title" rows={1} placeholder="What would you like to do?" singleLine />
      </div>
      <RichField draft={notes} className="p-notes" rows={1} placeholder="Notes" />

      <PropGroup v={task} onChange={(patch) => void update(task.id, patch)} open={open} setOpen={setOpen} sub={!!task.parent_id} sections={listSections} />

      {!task.parent_id && (
        <div className="p-group p-subs">
          <div className="p-group-head">
            <span>Subtasks</span>
            {subs.length > 0 && <em>{subs.filter((s) => s.status !== 0).length}/{subs.length}</em>}
          </div>
          {subs.map((s) => (
            <div key={s.id} className={`p-sub ${s.status ? "is-done" : ""}`}>
              <Check done={s.status !== 0} wontDo={s.status === 2} priority={s.priority} onToggle={() => void toggle(s.id)} />
              <button type="button" className="p-sub-title" onClick={() => select(s.id, anchor)}>
                <Rich text={s.title} />
              </button>
              <button type="button" className="p-sub-del" aria-label="Delete subtask" onClick={() => void del(s.id)}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <div className="p-sub p-sub-add">
            <Icon name="plus" size={18} />
            <input
              ref={subRef}
              value={sub}
              placeholder="Add subtask"
              enterKeyHint="done"
              onChange={(e) => setSub(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addSub();
              }}
              onBlur={addSub}
            />
          </div>
        </div>
      )}

      <div className="p-actions">
        <button type="button" onClick={() => void update(task.id, { pinned: task.pinned ? 0 : 1 })}>
          <Icon name="pin" size={20} />
          <span>{task.pinned ? "Unpin" : "Pin"}</span>
        </button>
        <button type="button" onClick={() => void duplicate(task.id)}>
          <Icon name="copy" size={20} />
          <span>Duplicate</span>
        </button>
        {isOpen ? (
          <button type="button" onClick={() => void wontDo(task.id)}>
            <Icon name="ban" size={20} />
            <span>Won't Do</span>
          </button>
        ) : (
          <button type="button" onClick={() => void toggle(task.id)}>
            <Icon name="undo" size={20} />
            <span>Reopen</span>
          </button>
        )}
        <button
          type="button"
          className="is-danger"
          onClick={() => {
            onDone();
            void del(task.id);
          }}
        >
          <Icon name="trash" size={20} />
          <span>Delete</span>
        </button>
      </div>
    </div>
  );
}

/** A task opens in a sheet; pull it up for full screen (typing does that too), down to close. */
export function MobileTaskSheet({ task }: { task: Task | null }) {
  const select = useStore((s) => s.select);
  const [shown, closing] = usePresence(task, 240);
  const [full, setFull] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = task?.id ?? null;
  useEffect(() => {
    if (id) setFull(false);
  }, [id]);
  const close = () => select(null);
  const drag = useSheetGesture(ref, { enabled: !!shown, full, onFull: () => setFull(true), onHalf: () => setFull(false), onClose: close });
  // Typing gets the whole screen, so the field stays clear of the keyboard.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onFocus = (e: FocusEvent) => {
      if ((e.target as HTMLElement).matches("input:not([type='time']), textarea")) setFull(true);
    };
    el.addEventListener("focusin", onFocus);
    return () => el.removeEventListener("focusin", onFocus);
  }, [shown?.id]);
  if (!shown) return null;
  return (
    <>
      <div className={`m-scrim m-task-scrim ${closing ? "" : "is-open"}`} onClick={close} />
      <div
        ref={ref}
        className={`m-task-sheet ${full ? "is-full" : ""} ${closing ? "is-closing" : ""} ${drag ? "is-dragging" : ""}`}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
      >
        <div className="p-sheet-top">
          <div className="m-grabber" onClick={() => setFull(!full)}>
            <i />
          </div>
          {full && (
            <button type="button" className="p-top-btn is-right" onClick={close}>
              Done
            </button>
          )}
        </div>
        <div className="p-scroll">
          <PhoneTaskEditor key={shown.id} task={shown} onDone={close} />
        </div>
      </div>
    </>
  );
}

// ---------- Add sheet ----------

let openAddImpl: ((base: Partial<Task> | null) => void) | null = null;

/** Opens the add sheet with defaults (call it from a touch or click handler, so the keyboard comes up). */
export function openAddSheet(base: Partial<Task> | null = null) {
  openAddImpl?.(base);
}

type Tool = "date" | "deadline" | "priority" | "list";

/**
 * The add sheet: a line to type into, with buttons for date, deadline,
 * priority and list (their pickers take the keyboard's place). Pull it up for
 * a full-screen editor with notes. It stays mounted (off screen) so the tap
 * on + can focus it right away.
 */
export function MobileAdd({
  open,
  onClose,
  inputRef,
  onOpen,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onOpen: (base: Partial<Task> | null) => void;
  preset: Partial<Task> | null;
}) {
  const view = useStore((s) => s.view);
  const sections = useStore((s) => s.sections);
  const create = useCreateTask();
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [picked, setPicked] = useState<PropValues>({});
  const [tool, setTool] = useState<Tool | null>(null);
  const [full, setFull] = useState(false);
  const [prop, setProp] = useState<PropKey | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // A tool button is being pressed: the field losing focus must not close the sheet.
  const keep = useRef(false);
  const suggest = useListSuggest(value, setValue, inputRef as RefObject<HTMLInputElement>);
  const parsed = parseQuick(value);
  const title = parsed.title;
  // Something in the text sets a property (the chips then show what it understood).
  const typed = !!(parsed.start_date || parsed.deadline_date || parsed.priority || parsed.listQuery);
  const lists = useStore((s) => s.lists);
  const pickedList = picked.list_id ? lists.find((l) => l.id === picked.list_id) : undefined;
  useEffect(() => {
    openAddImpl = onOpen;
    return () => {
      openAddImpl = null;
    };
  }, [onOpen]);
  // Each opening starts clean.
  useLayoutEffect(() => {
    if (open) return;
    setTool(null);
    setFull(false);
    setProp(null);
    setPicked({});
    setNotes("");
  }, [open]);
  const base: Partial<Task> = { ...(preset ?? (view.kind === "calendar" ? { start_date: todayKey() } : defaultsForView(view))), ...picked };
  const close = () => {
    inputRef.current?.blur();
    onClose();
  };
  const submit = () => {
    if (!title) return;
    void create(value, { ...base, ...(notes.trim() ? { notes: notes.trim() } : {}) });
    setValue("");
    close();
  };
  const drag = useSheetGesture(ref, { enabled: open, full, onFull: () => setFull(true), onHalf: () => setFull(false), onClose: close });
  const pick = (patch: PropValues) => setPicked((p) => ({ ...p, ...patch }));
  const toolButton = (t: Tool, icon: ReactNode, label: string, on: boolean) => (
    <button
      type="button"
      className={`m-tool ${tool === t ? "is-open" : ""} ${on ? "is-set" : ""}`}
      aria-label={label}
      onPointerDown={() => (keep.current = true)}
      onClick={() => {
        setTool(tool === t ? null : t);
        if (tool === t) inputRef.current?.focus();
        else inputRef.current?.blur();
        setTimeout(() => (keep.current = false), 300);
      }}
    >
      {icon}
    </button>
  );
  const today = todayKey();
  const listSections = sections.filter((s) => s.list_id === base.list_id).sort((a, b) => a.position - b.position);
  return (
    <>
      <div className={`m-scrim ${open ? "is-open" : ""}`} onClick={close} />
      <div
        ref={ref}
        className={`m-sheet m-add-sheet ${open ? "is-open" : ""} ${full ? "is-full" : ""} ${tool ? "has-tool" : ""} ${drag ? "is-dragging" : ""}`}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
        aria-hidden={!open}
      >
        <div className="p-sheet-top">
          {full ? (
            <>
              <button type="button" className="p-top-btn" onClick={close}>
                Cancel
              </button>
              <b className="p-top-title">New Task</b>
              <button type="button" className="p-top-btn is-right is-strong" disabled={!title} onClick={submit}>
                Add
              </button>
            </>
          ) : (
            <div className="m-grabber" onClick={() => setFull(true)}>
              <i />
            </div>
          )}
        </div>
        <div className="p-scroll">
          <div className="m-add-row">
            <input
              ref={inputRef}
              value={value}
              placeholder="What needs doing?"
              enterKeyHint="done"
              autoCapitalize="sentences"
              tabIndex={open ? 0 : -1}
              {...suggest.inputProps}
              onFocus={() => setTool(null)}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (suggest.onKeyDown(e)) return;
                if (e.key === "Enter") submit();
                if (e.key === "Escape") close();
              }}
              onBlur={() => {
                // Closing the keyboard closes an empty sheet (not when a picker takes its place).
                setTimeout(() => {
                  if (keep.current || !inputRef.current || document.activeElement === inputRef.current) return;
                  if (!inputRef.current.value.trim() && !full && !ref.current?.contains(document.activeElement)) onClose();
                }, 60);
              }}
            />
            {!full && (
              <button type="button" className="m-send" disabled={!title} aria-label="Add" onPointerDown={(e) => e.preventDefault()} onClick={submit}>
                <Icon name="arrowup" size={18} />
              </button>
            )}
          </div>
          {suggest.open && <SuggestList s={suggest} className="m-suggest" />}
          {full && <textarea className="p-notes m-add-notes" rows={3} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />}
          {!suggest.open && (
            <div className="m-add-chips">
              {typed ? <ParsedChips value={value} /> : !full && !value.trim() && <span className="qa-hint">tomorrow 14:00 · ^fri deadline · !high · #list</span>}
            </div>
          )}
          {full ? (
            <PropGroup v={base} onChange={pick} open={prop} setOpen={setProp} sections={listSections} />
          ) : (
            <>
              <div className="m-tools">
                {toolButton("date", <Icon name="calendar" size={20} />, "Date", !!base.start_date)}
                {toolButton("deadline", <Icon name="deadline" size={20} />, "Deadline", !!base.deadline_date)}
                {toolButton("priority", <Flag priority={base.priority ?? 0} size={20} />, "Priority", !!base.priority)}
                {toolButton("list", pickedList ? <i className="dot p-dot" style={{ background: pickedList.color }} /> : <Icon name="inbox" size={20} />, "List", !!pickedList)}
                <span className="m-tools-value">
                  {base.start_date ? formatDateTime(base.start_date, base.start_time ?? null, today) : ""}
                  {base.end_date ? ` – ${formatDateTime(base.end_date, base.end_time ?? null, today)}` : ""}
                </span>
                <button type="button" className="m-tool" aria-label="Full screen" onPointerDown={() => (keep.current = true)} onClick={() => { setFull(true); setTool(null); setTimeout(() => (keep.current = false), 300); }}>
                  <span className="rot-up">
                    <Icon name="chevron" size={18} />
                  </span>
                </button>
              </div>
              {tool && (
                <div className="p-picker m-add-picker">
                  {tool === "date" && <SpanPicker v={base} onChange={pick} />}
                  {tool === "deadline" && (
                    <DayPicker
                      date={base.deadline_date ?? null}
                      time={base.deadline_time ?? null}
                      clearLabel="Remove deadline"
                      onChange={(d, t) => pick({ deadline_date: d, deadline_time: d ? t : null })}
                    />
                  )}
                  {tool === "priority" && (
                    <PriorityChoice
                      value={base.priority ?? 0}
                      onPick={(p) => {
                        pick({ priority: p });
                        setTool(null);
                        inputRef.current?.focus();
                      }}
                    />
                  )}
                  {tool === "list" && (
                    <ListChoice
                      value={base.list_id ?? null}
                      onPick={(id) => {
                        pick({ list_id: id, section_id: null });
                        setTool(null);
                        inputRef.current?.focus();
                      }}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
