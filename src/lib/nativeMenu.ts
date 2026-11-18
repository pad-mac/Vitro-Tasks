// Holding a task on iOS: the system's own context menu and drag (see
// PressController in plugins/native-ui). At the start of every touch the page
// tells the native side which task is under the finger, with its menu; the
// native side lifts a picture of it, and the page hides the task meanwhile.
// Pickers that need more room (date, deadline) open as the app's own menu
// once the native one is gone.
import { useStore } from "../store";
import { deadlineCountdown, formatDateTime, todayKey } from "./dates";
import { hasNative, onNative, postNative } from "./native";
import { PRIORITY_LABELS, orderedLists } from "./views";

interface Item {
  id?: string;
  title: string;
  icon?: string;
  color?: string;
  subtitle?: string;
  checked?: boolean;
  destructive?: boolean;
  inline?: boolean;
  size?: "small" | "medium" | "large";
  children?: Item[];
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function itemsFor(taskId: string): Item[] | null {
  const st = useStore.getState();
  const task = st.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  const today = todayKey();
  const flagColor = (p: number) => (p ? cssVar(`--p${p}`) : undefined);
  const top: Item = {
    title: "",
    inline: true,
    size: "medium",
    children: [
      { id: "pin", title: task.pinned ? "Unpin" : "Pin", icon: task.pinned ? "pin.slash" : "pin" },
      { id: "date", title: "Date", icon: "calendar" },
      {
        title: "Priority",
        icon: task.priority ? "flag.fill" : "flag",
        color: flagColor(task.priority),
        children: [3, 2, 1, 0].map((p) => ({
          id: `prio:${p}`,
          title: PRIORITY_LABELS[p],
          icon: p ? "flag.fill" : "flag.slash",
          color: flagColor(p),
          checked: task.priority === p,
        })),
      },
    ],
  };
  const organize: Item = {
    title: "",
    inline: true,
    children: [
      ...(task.parent_id
        ? []
        : [
            { id: "subtask", title: "Add Subtask", icon: "text.badge.plus" },
            {
              title: "Move to",
              icon: "folder",
              children: [
                { id: "move:", title: "Inbox", icon: "tray", checked: !task.list_id },
                ...orderedLists(st.lists).map((l) => ({
                  id: `move:${l.id}`,
                  title: `${"   ".repeat(l.depth)}${l.name}`,
                  icon: "circle.fill",
                  color: l.color,
                  checked: l.id === task.list_id,
                })),
              ],
            },
          ]),
      {
        id: "deadline",
        title: task.deadline_date ? "Deadline" : "Add Deadline",
        icon: "target",
        subtitle: task.deadline_date
          ? `${formatDateTime(task.deadline_date, task.deadline_time, today)}${task.status === 0 ? ` · ${deadlineCountdown(task.deadline_date, today)}` : ""}`
          : undefined,
      },
    ],
  };
  const more: Item = {
    title: "",
    inline: true,
    children: [
      task.status === 0 ? { id: "wontdo", title: "Won't Do", icon: "nosign" } : { id: "reopen", title: "Reopen", icon: "arrow.uturn.backward" },
      { id: "duplicate", title: "Duplicate", icon: "plus.square.on.square" },
    ],
  };
  const remove: Item = { title: "", inline: true, children: [{ id: "delete", title: "Delete", icon: "trash", destructive: true }] };
  return [top, organize, more, remove];
}

/** The task last reported under a finger, and actions waiting for the menu to close. */
let touched: { id: string; el: HTMLElement } | null = null;
let liftedId: string | null = null;
let after: (() => void) | null = null;
let liftSeenAt = 0;

/**
 * Hides every copy of the lifted task (rows, cards, calendar chips) while its
 * picture stands in for it. A style rule rather than a class, so it holds
 * when React redraws the row meanwhile.
 */
function hideLifted(id: string | null) {
  let style = document.getElementById("vitro-lifted") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "vitro-lifted";
    document.head.appendChild(style);
  }
  style.textContent = id ? `[data-id="${CSS.escape(id)}"]:is(.task-row, .card, .cal-chip, .tl-item) { visibility: hidden !important; }` : "";
}

function run(id: string, action: string) {
  const st = useStore.getState();
  const task = st.tasks.find((t) => t.id === id);
  if (!task) return;
  const el = touched?.id === id ? touched.el : document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  const r = el?.getBoundingClientRect() ?? new DOMRect(16, innerHeight / 3, innerWidth - 32, 60);
  // Web pickers open next to the task, after the native menu has gone.
  const page = (name: "date" | "deadline") => () => st.openMenu({ kind: "task", id: task.id, x: r.left + 12, y: r.top - 4, h: r.height + 8, page: name });
  if (action.startsWith("prio:")) void st.updateTask(task.id, { priority: Number(action.slice(5)) });
  else if (action.startsWith("move:")) void st.updateTask(task.id, { list_id: action.slice(5) || null });
  else if (action === "pin") void st.updateTask(task.id, { pinned: task.pinned ? 0 : 1 });
  else if (action === "date") after = page("date");
  else if (action === "deadline") after = page("deadline");
  else if (action === "subtask") after = () => st.addSubtaskTo(task.id, { x: r.left, y: r.top, w: r.width, h: r.height });
  else if (action === "wontdo") void st.setWontDo(task.id);
  else if (action === "reopen") void st.toggleTask(task.id);
  else if (action === "duplicate") void st.duplicateTask(task.id);
  else if (action === "delete") void st.deleteTask(task.id);
}

onNative("lifted", (p) => {
  liftedId = String(p.id ?? "");
  liftSeenAt = Date.now();
  hideLifted(liftedId);
});
onNative("restore", () => {
  liftedId = null;
  hideLifted(null);
  const next = after;
  after = null;
  next?.();
});
onNative("menuAction", (p) => run(String(p.id ?? ""), String(p.action ?? "")));

/**
 * At the start of each touch: the task under the finger (with its menu), or
 * none. `movable`: it can be dragged to a new place in its list or board.
 */
export function reportTouch(el: HTMLElement | null, movable = false) {
  if (!hasNative()) return;
  const id = el?.dataset.id;
  const items = id ? itemsFor(id) : null;
  if (!el || !id || !items) {
    touched = null;
    postNative({ type: "touch" });
    return;
  }
  touched = { id, el };
  const r = el.getBoundingClientRect();
  postNative({ type: "touch", id, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, radius: 12, movable, items });
}

/** The native side lifted a task since `since` (ms timestamp). */
export const liftedSince = (since: number) => liftSeenAt >= since;
export const isLifted = () => liftedId !== null;
