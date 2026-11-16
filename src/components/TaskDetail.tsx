import { useEffect, useRef, useState } from "react";
import { deadlineCountdown, todayKey } from "../lib/dates";
import { PRIORITY_LABELS, orderedLists, subtasksOf } from "../lib/views";
import type { Task } from "../shared/schema";
import { useStore } from "../store";
import { Check, DateField, Icon, MenuItem, Popover } from "./ui";

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

export function TaskDetail({ task }: { task: Task }) {
  const lists = useStore((s) => s.lists);
  const sections = useStore((s) => s.sections);
  const tasks = useStore((s) => s.tasks);
  const update = useStore((s) => s.updateTask);
  const toggle = useStore((s) => s.toggleTask);
  const addTask = useStore((s) => s.addTask);
  const del = useStore((s) => s.deleteTask);
  const select = useStore((s) => s.select);
  const [sub, setSub] = useState("");
  const today = todayKey();

  const title = useDraft(task.title, task.id, (v) => void update(task.id, { title: v }));
  const notes = useDraft(task.notes, task.id, (v) => void update(task.id, { notes: v }));
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    autoGrow(titleRef.current);
    autoGrow(notesRef.current);
  }, [title.value, notes.value, task.id]);

  const list = lists.find((l) => l.id === task.list_id);
  const listSections = sections.filter((s) => s.list_id === task.list_id).sort((a, b) => a.position - b.position);
  const section = listSections.find((s) => s.id === task.section_id);
  const subs = subtasksOf(tasks, task.id);
  const parent = task.parent_id ? tasks.find((t) => t.id === task.parent_id) : null;
  const overdue = task.status === 0 && task.deadline_date !== null && task.deadline_date < today;

  return (
    <aside className="detail">
      <header className="detail-head">
        <Check done={task.status === 1} priority={task.priority} onToggle={() => void toggle(task.id)} />
        <div className="prio-picker" role="radiogroup" aria-label="Priority">
          {[0, 1, 2, 3].map((p) => (
            <button
              type="button"
              key={p}
              role="radio"
              aria-checked={task.priority === p}
              className={`prio p${p} ${task.priority === p ? "is-active" : ""}`}
              title={`Priority: ${PRIORITY_LABELS[p]}`}
              onClick={() => void update(task.id, { priority: p })}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`icon-btn push ${task.pinned ? "is-on" : ""}`}
          title={task.pinned ? "Unpin" : "Pin to top"}
          onClick={() => void update(task.id, { pinned: task.pinned ? 0 : 1 })}
        >
          <Icon name="pin" size={14} />
        </button>
        <button type="button" className="icon-btn" title="Close" onClick={() => select(null)}>
          <Icon name="x" size={14} />
        </button>
      </header>

      <div className="detail-body">
        {parent && (
          <button type="button" className="crumb" onClick={() => select(parent.id)}>
            <span className="flip"><Icon name="chevron" size={12} /></span> {parent.title}
          </button>
        )}
        <textarea ref={titleRef} className="detail-title" rows={1} placeholder="Title" {...title}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />

        <dl className="fields">
          <dt>Planned</dt>
          <dd>
            <DateField
              date={task.start_date}
              time={task.start_time}
              placeholder="When to work on it"
              tone={task.status === 0 && task.start_date !== null && task.start_date < today ? "overdue" : undefined}
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
                <span className="arrow">→</span>
                <DateField
                  date={task.end_date}
                  time={task.end_time}
                  placeholder="End"
                  align="right"
                  onChange={(d, t) =>
                    void update(task.id, {
                      end_date: d && d >= task.start_date! ? d : null,
                      end_time: d && d >= task.start_date! ? t : null,
                    })
                  }
                />
              </>
            )}
          </dd>

          <dt className="dt-deadline">Deadline</dt>
          <dd>
            <DateField
              date={task.deadline_date}
              time={task.deadline_time}
              placeholder="When it must be done"
              icon="flag"
              tone="signal"
              onChange={(d, t) => void update(task.id, { deadline_date: d, deadline_time: d ? t : null })}
            />
            {task.deadline_date && task.status === 0 && (
              <span className={`countdown mono ${overdue ? "is-over" : ""}`}>{deadlineCountdown(task.deadline_date, today)}</span>
            )}
          </dd>

          {!task.parent_id && (
            <>
              <dt>List</dt>
              <dd>
                <Popover
                  trigger={
                    <span className="field-trigger">
                      {list ? <i className="dot" style={{ background: list.color }} /> : <Icon name="inbox" size={14} />}
                      {list?.name ?? "Inbox"}
                    </span>
                  }
                >
                  {(close) => (
                    <div className="menu menu-scroll">
                      <MenuItem active={!task.list_id} onClick={() => { void update(task.id, { list_id: null }); close(); }}>Inbox</MenuItem>
                      {orderedLists(lists).map((l) => (
                        <MenuItem key={l.id} active={l.id === task.list_id} onClick={() => { void update(task.id, { list_id: l.id }); close(); }}>
                          <span style={{ paddingLeft: l.depth * 14 }}><i className="dot" style={{ background: l.color }} /> {l.name}</span>
                        </MenuItem>
                      ))}
                    </div>
                  )}
                </Popover>
                {listSections.length > 0 && (
                  <Popover trigger={<span className="field-trigger is-quiet">{section?.name ?? "No section"}</span>}>
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
              </dd>
            </>
          )}
        </dl>

        <textarea ref={notesRef} className="detail-notes" rows={3} placeholder="Notes" {...notes} />

        {!task.parent_id && (
          <section className="subtasks">
            <span className="micro">Subtasks{subs.length ? ` · ${subs.filter((s) => s.status === 1).length}/${subs.length}` : ""}</span>
            {subs.map((s) => (
              <div key={s.id} className={`subtask ${s.status ? "is-done" : ""}`}>
                <Check done={s.status === 1} priority={s.priority} onToggle={() => void toggle(s.id)} />
                <span className="task-title" onClick={() => select(s.id)}>{s.title}</span>
                <button type="button" className="icon-btn hover-reveal" title="Delete subtask" onClick={() => void del(s.id)}>
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
            <div className="subtask subtask-add">
              <Icon name="plus" size={14} />
              <input
                value={sub}
                placeholder="Add subtask"
                onChange={(e) => setSub(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && sub.trim()) {
                    void addTask({ title: sub.trim(), parent_id: task.id, list_id: task.list_id });
                    setSub("");
                  }
                }}
              />
            </div>
          </section>
        )}
      </div>

      <footer className="detail-foot">
        <span className="micro mono">created {new Date(task.created_at).toISOString().slice(0, 10)}</span>
        <button type="button" className="text-btn is-danger push" onClick={() => void del(task.id)}>
          <Icon name="trash" size={14} /> Delete
        </button>
      </footer>
    </aside>
  );
}
