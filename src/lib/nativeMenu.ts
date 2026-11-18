// The task menu as a native iOS context menu (the task is lifted out of the
// list and the menu sits below or above it). Pickers that need more room
// (date, deadline) open as the app's own menu once the native one is gone.
import { endNativeDrag, startNativeDrag } from "../components/tasks";
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

interface Open {
  token: number;
  taskId: string;
  rect: DOMRect;
  after: (() => void) | null;
  onShown: () => void;
  onClosed: () => void;
  onFailed: () => void;
}

let token = 0;
let current: Open | null = null;

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

function run(open: Open, action: string) {
  const st = useStore.getState();
  const task = st.tasks.find((t) => t.id === open.taskId);
  if (!task) return;
  const r = open.rect;
  // Web pickers open next to the task, after the native menu has gone.
  const page = (name: "date" | "deadline") => () => st.openMenu({ kind: "task", id: task.id, x: r.left + 12, y: r.top - 4, h: r.height + 8, page: name });
  if (action.startsWith("prio:")) void st.updateTask(task.id, { priority: Number(action.slice(5)) });
  else if (action.startsWith("move:")) void st.updateTask(task.id, { list_id: action.slice(5) || null });
  else if (action === "pin") void st.updateTask(task.id, { pinned: task.pinned ? 0 : 1 });
  else if (action === "date") open.after = page("date");
  else if (action === "deadline") open.after = page("deadline");
  else if (action === "subtask") open.after = () => st.addSubtaskTo(task.id, { x: r.left, y: r.top, w: r.width, h: r.height });
  else if (action === "wontdo") void st.setWontDo(task.id);
  else if (action === "reopen") void st.toggleTask(task.id);
  else if (action === "duplicate") void st.duplicateTask(task.id);
  else if (action === "delete") void st.deleteTask(task.id);
}

onNative("menuAction", (p) => {
  if (current && p.token === current.token) run(current, String(p.id ?? ""));
});
onNative("menuShown", (p) => {
  if (current && p.token === current.token) current.onShown();
});
// Dragging the lifted task out of the open menu: the drag goes on in the page.
const tokenTask = new Map<number, string>();
onNative("menuDrag", (p) => {
  const id = tokenTask.get(Number(p.token));
  if (id) startNativeDrag(id);
});
onNative("menuDragEnd", () => endNativeDrag());
onNative("menuClosed", (p) => {
  if (!current || p.token !== current.token) return;
  const open = current;
  current = null;
  open.onClosed();
  open.after?.();
});
onNative("menuFailed", (p) => {
  if (!current || p.token !== current.token) return;
  const open = current;
  current = null;
  open.onFailed();
});

/**
 * Opens the native menu for a task; false when there is no native side.
 * `movable`: the task can be dragged out of the menu to a new place.
 */
export function showNativeTaskMenu(
  taskId: string,
  rect: DOMRect,
  movable: boolean,
  on: { shown: () => void; closed: () => void; failed: () => void },
): boolean {
  if (!hasNative()) return false;
  const items = itemsFor(taskId);
  if (!items) return false;
  token += 1;
  tokenTask.set(token, taskId);
  current = { token, taskId, rect, after: null, onShown: on.shown, onClosed: on.closed, onFailed: on.failed };
  postNative({
    type: "menu",
    token,
    rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    radius: 12,
    payload: movable ? `vitro-task:${taskId}` : "",
    items,
  });
  return true;
}

/** Closes the native menu (a drag started from it). */
export function dismissNativeMenu() {
  if (!current) return;
  const open = current;
  current = null;
  postNative({ type: "menuDismiss" });
  open.onClosed();
}

export const nativeMenuOpen = () => current !== null;
