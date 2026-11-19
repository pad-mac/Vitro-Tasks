// The task editor's lower half: how the description and the subtasks share
// the room, how the line being written stays in view, and the subtask list
// itself (edited in place, reordered by dragging). Everything about the
// editor's layout and scrolling is here, in one place.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { isMobile } from "../lib/platform";
import { subtaskPositions } from "../lib/order";
import type { Task } from "../shared/schema";
import { useStore } from "../store";
import { useReorderTarget } from "./tasks";
import { Check, Icon, Rich } from "./ui";

/** How much of the other part stays visible while one is being written in (phone). */
const PEEK = 56;

/** Scrolls `el`'s part (a `.detail-sec`) so that `el` is fully in view. */
export function keepInView(el: Element | null, margin = 8) {
  const sec = el?.closest<HTMLElement>(".detail-sec");
  if (!el || !sec) return;
  const row = (el.closest(".subtask") ?? el) as HTMLElement;
  const r = row.getBoundingClientRect();
  const s = sec.getBoundingClientRect();
  // A field taller than its part (a long description): the caret is the browser's business.
  if (r.height > s.height - 2 * margin) return;
  if (r.bottom > s.bottom - margin) sec.scrollTop += r.bottom - s.bottom + margin;
  else if (r.top < s.top + margin) sec.scrollTop -= s.top + margin - r.top;
}

/**
 * The description (`a`) and the subtasks (`b`) share the room below the
 * title: each may take up to half of it, and whatever one does not need, the
 * other may use. Each scrolls on its own once it is cut (`is-cut`).
 *
 * On the phone, the part being written in gets the room (the other keeps a
 * peek), so the keyboard never covers what is being typed; the line with the
 * caret is kept in view. The containers around the parts never scroll
 * (WebKit scrolls even `overflow: hidden` boxes to show a focused field,
 * which pushed the whole editor up and left it there).
 */
export function useEditorLayout(body: RefObject<HTMLElement | null>, a: RefObject<HTMLElement | null>, b: RefObject<HTMLElement | null>) {
  const ro = useRef<ResizeObserver | null>(null);
  const watched = useRef(new Set<Element>());
  const focus = useRef<"a" | "b" | null>(null);
  const fit = useRef(() => {});
  fit.current = () => {
    const B = body.current;
    const A = a.current;
    if (!B || !A) return;
    const S = b.current;
    const parts = S ? [A, S] : [A];
    // Watch what can grow: the body and the contents of both parts. Only new
    // elements are added (observing again would report again, every frame).
    // Before the observer exists (the first layout pass) nothing counts as watched.
    const ob = ro.current;
    if (ob) {
      const now = new Set<Element>([B, ...parts.flatMap((el) => [...el.children, ...[...el.children].flatMap((c) => [...c.children])])]);
      for (const el of watched.current) if (!now.has(el)) ob.unobserve(el);
      for (const el of now) if (!watched.current.has(el)) ob.observe(el);
      watched.current = now;
    }
    // Measured as they are: scrollHeight is a part's full content even while
    // it is cut, so nothing is reset (which would throw away its scroll).
    const cs = getComputedStyle(B);
    const gap = parseFloat(cs.rowGap) || 0;
    const kids = [...B.children].filter((el) => (el as HTMLElement).offsetParent !== null || el === A);
    let fixed = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + gap * Math.max(0, kids.length - 1);
    for (const el of kids) if (el !== A && el !== S) fixed += (el as HTMLElement).offsetHeight;
    const avail = B.clientHeight - fixed;
    const ha = A.scrollHeight;
    const hb = S?.scrollHeight ?? 0;
    let ma = Infinity;
    let mb = Infinity;
    if (ha + hb > avail + 1) {
      const half = avail / 2;
      const f = isMobile ? focus.current : null;
      if (!S) ma = avail;
      else if (f === "b") {
        ma = Math.min(ha, PEEK);
        mb = avail - ma;
      } else if (f === "a") {
        mb = Math.min(hb, PEEK);
        ma = avail - mb;
      } else if (ha <= half) mb = avail - ha;
      else if (hb <= half) ma = avail - hb;
      else ma = mb = half;
    }
    const set = (el: HTMLElement, h: number, max: number) => {
      const cut = h > max + 1;
      const value = cut ? `${Math.max(0, Math.floor(max))}px` : "";
      if (el.style.maxHeight !== value) el.style.maxHeight = value;
      el.classList.toggle("is-cut", cut);
    };
    set(A, ha, ma);
    if (S) set(S, hb, mb);
    keepInView(document.activeElement && B.contains(document.activeElement) ? document.activeElement : null);
  };
  useEffect(() => {
    const B = body.current;
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fit.current());
    };
    ro.current = new ResizeObserver(later);
    fit.current();
    // Which part is being written in.
    const where = () => {
      const el = document.activeElement;
      const next = el && a.current?.contains(el) ? "a" : el && b.current?.contains(el) ? "b" : null;
      if (next !== focus.current) {
        focus.current = next;
        later();
      }
    };
    const onIn = () => where();
    const onOut = () => setTimeout(where, 0);
    // The boxes around the parts stay where they are.
    const boxes = [B, B?.closest<HTMLElement>(".detail"), B?.closest<HTMLElement>(".m-task-sheet")].filter((x): x is HTMLElement => !!x);
    const pin = (e: Event) => {
      const t = e.target as HTMLElement;
      if (boxes.includes(t) && (t.scrollTop || t.scrollLeft)) {
        t.scrollTop = 0;
        t.scrollLeft = 0;
      }
    };
    // Typing (a new subtask line, a growing description): keep the caret's line in view.
    const onInput = () => requestAnimationFrame(() => keepInView(document.activeElement));
    B?.addEventListener("focusin", onIn);
    B?.addEventListener("focusout", onOut);
    B?.addEventListener("input", onInput);
    for (const x of boxes) x.addEventListener("scroll", pin, true);
    return () => {
      cancelAnimationFrame(frame);
      ro.current?.disconnect();
      watched.current.clear();
      B?.removeEventListener("focusin", onIn);
      B?.removeEventListener("focusout", onOut);
      B?.removeEventListener("input", onInput);
      for (const x of boxes) x.removeEventListener("scroll", pin, true);
    };
  }, []);
  useLayoutEffect(() => fit.current());
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
  onNext: () => void;
  onRemoved: () => void;
}) {
  const update = useStore((s) => s.updateTask);
  const toggle = useStore((s) => s.toggleTask);
  const del = useStore((s) => s.deleteTask);
  const [value, setValue] = useState(task.title);
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
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
          else onEdit();
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
              if (!value.trim()) setValue(task.title);
              onDone();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save(value);
                onNext();
              } else if (e.key === "Backspace" && !value) {
                // Deleting past the start of an empty line removes it.
                e.preventDefault();
                clearTimeout(timer.current);
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
export function SubtaskList({ parent, subs, sectionRef, onOpen }: { parent: Task; subs: Task[]; sectionRef: RefObject<HTMLElement | null>; onOpen: (id: string) => void }) {
  const addTask = useStore((s) => s.addTask);
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
    <section className="subtasks detail-sec" ref={sectionRef}>
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
            onNext={focusAdd}
            onRemoved={() => {
              // The caret goes on at the end of the line above (or to the add line).
              const prev = subs[i - 1] ?? subs[i + 1];
              if (prev) setEditing(prev.id);
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
