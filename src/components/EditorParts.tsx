// The task editor's body: title, description and subtasks flow in one
// scrolling column (as in TickTick), the line being written stays in view,
// and the subtask list itself (edited in place, reordered by holding).
// Everything about the editor's layout and scrolling is here, in one place.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { subtaskPositions } from "../lib/order";
import type { Task } from "../shared/schema";
import { useStore } from "../store";
import { useReorderTarget } from "./tasks";
import { Check, Icon, Rich } from "./ui";

/** Room kept below the line being written: clear of the fade at the body's bottom edge. */
const MARGIN = 34;

/** Scrolls the editor's body so that `el` (a subtask's line, the add line, a field) is in view. */
export function keepInView(el: Element | null, margin = MARGIN) {
  const box = el?.closest<HTMLElement>(".detail-body");
  if (!el || !box) return;
  const row = (el.closest(".subtask") ?? el) as HTMLElement;
  const r = row.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  if (r.height > b.height - 2 * margin) {
    // A field taller than the view (a long description): with the caret at the
    // end its last line is the one being written; elsewhere the browser follows the caret.
    const f = el as HTMLTextAreaElement;
    const atEnd = typeof f.selectionStart === "number" && f.selectionStart === f.value?.length;
    if (atEnd && r.bottom > b.bottom - margin) box.scrollTop += r.bottom - b.bottom + margin;
    return;
  }
  if (r.bottom > b.bottom - margin) box.scrollTop += r.bottom - b.bottom + margin;
  else if (r.top < b.top + margin) box.scrollTop -= b.top + margin - r.top;
}

/**
 * The body scrolls as one; whatever is being written stays in view while the
 * keyboard comes up, lines are added or the description grows. `is-cut` marks
 * a body with more below than it shows: its bottom edge fades out into the
 * bar (half open, full screen, while writing).
 * The boxes around the body never scroll: WebKit scrolls even
 * `overflow: hidden` boxes to show a focused field, which pushed the whole
 * editor up and left it there.
 */
export function useEditorScroll(body: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const B = body.current;
    if (!B) return;
    let frame = 0;
    const cut = () => B.classList.toggle("is-cut", B.scrollTop + B.clientHeight < B.scrollHeight - 1);
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const a = document.activeElement;
        if (a && B.contains(a)) keepInView(a);
        cut();
      });
    };
    // The body (the keyboard, the sheet's height) and each of its parts (rows added, a longer description).
    const ro = new ResizeObserver(follow);
    const watch = () => {
      ro.disconnect();
      ro.observe(B);
      for (const el of B.children) ro.observe(el);
    };
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(B, { childList: true });
    const boxes = [B.closest<HTMLElement>(".detail"), B.closest<HTMLElement>(".m-task-sheet")].filter((x): x is HTMLElement => !!x);
    const pin = (e: Event) => {
      const t = e.target as HTMLElement;
      if (boxes.includes(t) && (t.scrollTop || t.scrollLeft)) {
        t.scrollTop = 0;
        t.scrollLeft = 0;
      }
    };
    B.addEventListener("focusin", follow);
    B.addEventListener("input", follow);
    B.addEventListener("scroll", cut, { passive: true });
    for (const x of boxes) x.addEventListener("scroll", pin, true);
    follow();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      B.removeEventListener("focusin", follow);
      B.removeEventListener("input", follow);
      B.removeEventListener("scroll", cut);
      for (const x of boxes) x.removeEventListener("scroll", pin, true);
    };
  }, [body]);
}

/** A position between two neighbours (the first's own when they share one: renumbered after). */
function between(a: Task, b: Task): number {
  return b.position > a.position ? (a.position + b.position) / 2 : a.position;
}

/** The first line of a description, for previews. */
const firstLine = (s: string) => s.split("\n").find((l) => l.trim()) ?? "";

/**
 * A subtask in the editor. Its title is text until tapped, then a field:
 * Enter moves on to "Add Subtask", Backspace on an empty title removes the
 * subtask (like a line in a list). The arrow opens it on its own.
 */
function SubtaskRow({
  task,
  editing,
  details,
  onEdit,
  onDone,
  onOpen,
  onNext,
  onRemoved,
}: {
  task: Task;
  editing: boolean;
  details: boolean;
  onEdit: () => void;
  onDone: () => void;
  onOpen: () => void;
  /** Enter: a new line under this one (`empty`: this line was left empty, so it goes instead). */
  onNext: (empty: boolean) => void;
  onRemoved: () => void;
}) {
  const update = useStore((s) => s.updateTask);
  const toggle = useStore((s) => s.toggleTask);
  const del = useStore((s) => s.deleteTask);
  const [value, setValue] = useState(task.title);
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const gone = useRef(false);
  // Picks up changes made elsewhere while not being written in.
  useEffect(() => {
    if (!editing) setValue(task.title);
  }, [task.title, editing]);
  // Focus inside the tap that asked for it (iOS only opens the keyboard then).
  useLayoutEffect(() => {
    if (!editing) return;
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);
  const save = (v: string) => {
    clearTimeout(timer.current);
    if (v.trim() && v.trim() !== task.title) void update(task.id, { title: v.trim() });
  };
  const notes = task.notes ? firstLine(task.notes) : "";
  return (
    <div className={`subtask ${task.status ? "is-done" : ""} ${editing ? "is-editing" : ""}`} data-id={task.id}>
      <Check done={task.status !== 0} wontDo={task.status === 2} priority={task.priority} onToggle={() => void toggle(task.id, { quiet: true })} />
      <span
        className="subtask-main"
        onClick={(e) => {
          if (editing) return;
          // The description preview opens the subtask; anywhere else on the line edits its title.
          if ((e.target as HTMLElement).closest(".subtask-notes")) onOpen();
          else flushSync(onEdit); // the field mounts and takes the focus inside this tap (iOS opens the keyboard only then)
        }}
      >
        {editing ? (
          <input
            ref={ref}
            className="subtask-title"
            value={value}
            enterKeyHint="next"
            onChange={(e) => {
              setValue(e.target.value);
              clearTimeout(timer.current);
              const v = e.target.value;
              timer.current = setTimeout(() => save(v), 500);
            }}
            onBlur={() => {
              save(value);
              // A new line left without a title is not kept.
              if (!value.trim() && !task.title.trim() && !gone.current) {
                gone.current = true;
                void del(task.id);
              } else if (!value.trim()) setValue(task.title);
              onDone();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save(value);
                const empty = !value.trim() && !task.title.trim();
                if (empty) gone.current = true;
                onNext(empty);
                if (empty) void del(task.id);
              } else if (e.key === "Backspace" && !value) {
                // Deleting past the start of an empty line removes it.
                e.preventDefault();
                clearTimeout(timer.current);
                gone.current = true;
                onRemoved();
                void del(task.id);
              } else if (e.key === "Escape") {
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        ) : (
          <span className="subtask-title">
            {task.title ? <Rich text={task.title} /> : <span className="faint">Untitled</span>}
          </span>
        )}
        {details && notes && (
          <span className="subtask-notes">
            <Rich text={notes} />
          </span>
        )}
      </span>
      {!details && notes && (
        <span className="subtask-has-notes" title="Has a description">
          <Icon name="lines" size={13} />
        </span>
      )}
      <button type="button" className="sub-open" title="Open subtask" onClick={onOpen}>
        <Icon name="chevron" size={13} />
      </button>
    </div>
  );
}

/**
 * The subtasks of `parent` with the line to add more. Rows reorder by
 * dragging (mouse, or holding in the phone's full-screen editor).
 */
export function SubtaskList({ parent, subs, onOpen }: { parent: Task; subs: Task[]; onOpen: (id: string) => void }) {
  const addTask = useStore((s) => s.addTask);
  const addTaskNow = useStore((s) => s.addTaskNow);
  const update = useStore((s) => s.updateTask);
  const details = useStore((s) => s.showDetails);
  const focusSubtask = useStore((s) => s.focusSubtask);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const addRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSubtask) addRef.current?.focus();
  }, [focusSubtask, parent.id]);
  // Reordered by holding a row in the phone's full-screen editor (the rows are not mouse-draggable:
  // a subtask dropped on a list or a day elsewhere would leave its parent behind).
  const reorder = useReorderTarget(`subtasks:${parent.id}`, ".subtask[data-id]", (id, index) => {
    for (const p of subtaskPositions(subs, id, index)) void update(p.id, { position: p.position });
  });
  // A new row pushes the add line down: follow it as soon as the row is there.
  const count = useRef(subs.length);
  useLayoutEffect(() => {
    if (subs.length > count.current && document.activeElement === addRef.current) keepInView(addRef.current);
    count.current = subs.length;
  }, [subs.length]);
  const focusAdd = () => {
    setEditing(null);
    addRef.current?.focus();
    requestAnimationFrame(() => keepInView(addRef.current));
  };
  return (
    <section className="subtasks">
      <section className={`subtask-items ${reorder.over ? "is-drop" : ""}`} {...reorder.props}>
        {subs.map((s, i) => (
          <SubtaskRow
            key={s.id}
            task={s}
            editing={editing === s.id}
            details={details}
            onEdit={() => setEditing(s.id)}
            onDone={() => setEditing((cur) => (cur === s.id ? null : cur))}
            onOpen={() => onOpen(s.id)}
            onNext={(empty) => {
              // Enter on the last line (or on an empty one) goes on to the add line;
              // in the middle of the list a new line opens right under this one.
              const next = subs[i + 1];
              if (empty || !next) return focusAdd();
              const made = addTaskNow({ title: "", parent_id: parent.id, list_id: parent.list_id, position: between(s, next) });
              if (made.position === s.position) for (const p of subtaskPositions([...subs.slice(0, i + 1), made, ...subs.slice(i + 1)], made.id, i + 1)) void update(p.id, { position: p.position });
              flushSync(() => setEditing(made.id));
            }}
            onRemoved={() => {
              // The caret goes on at the end of the line above (or to the add line).
              const prev = subs[i - 1] ?? subs[i + 1];
              if (prev) flushSync(() => setEditing(prev.id));
              else focusAdd();
            }}
          />
        ))}
        {reorder.line}
      </section>
      <div className="subtask subtask-add">
        <span className="subtask-plus">
          <Icon name="plus" size={14} />
        </span>
        <input
          ref={addRef}
          value={draft}
          placeholder="Add Subtask"
          enterKeyHint="next"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setEditing(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              void addTask({ title: draft.trim(), parent_id: parent.id, list_id: parent.list_id });
              setDraft("");
              // The new row pushes this line down: follow it right away, not on the next key.
              requestAnimationFrame(() => requestAnimationFrame(() => keepInView(addRef.current)));
            }
          }}
        />
      </div>
    </section>
  );
}
