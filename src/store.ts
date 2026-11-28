import { create } from "zustand";
import { openDb, type Db } from "./db/driver";
import { adoptRows, assignOrigin, getMeta, loadAll, loadDeletedTasks, migrate, purgeOrigin, purgeTask, put, remove, setMeta, uid, type AdoptedChange } from "./db/repo";
import { getDefaultServer, getServers, hostName, resetServer, setDefaultServer, setServers, OutdatedServerError, syncOnce, type SyncServer } from "./db/sync";
import {
  announceChange,
  appVersion,
  DEFAULT_SHORTCUT,
  detachedLayer,
  takeHandoff,
  findUpdate,
  haptic,
  onRemoteChange,
  setQuickAddShortcut,
  type FoundUpdate,
} from "./lib/platform";
import { parseShortcuts, type Shortcuts } from "./lib/shortcuts";
import { moveInOrder, orderKey, parseRanks, positionsFor, ranksFor } from "./lib/order";
import { readTickTick, readVitroCsv, writeVitroCsv } from "./lib/transfer";
import { separateWhen } from "./lib/horizon";
import { repeatStep as makeRepeatStep, stepRows, type RepeatStep } from "./lib/complete";
import { colorForNew, defaultPalette } from "./lib/palettes";
import {
  computePrefs,
  listVisibility,
  listWithDescendants,
  type Group,
  type SmartId,
  type ViewPrefs,
  type ViewRef,
  type VisibilityKey,
} from "./lib/views";
import type { EntityName, List, Row, Section, Setting, SortBy, Task } from "./shared/schema";
import type { WidgetState } from "./widget/core";

/**
 * What the undo button takes back: tasks that were completed, and for
 * repeating ones the task as it was before it moved on, plus the copy that
 * keeps the done occurrence.
 */
export interface Undo {
  ids: string[];
  restore?: Task[];
  remove?: string[];
}

/** A repeating task done (or won't do) once: the copy that keeps this occurrence and where the task moves on to. */

/** How long a just-completed task stays (struck through) before it goes. */
const LINGER_MS = 900;
const FOLDED_KEY = "vitro.folded";
function readFolded(): Record<string, true> {
  try {
    const ids = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]") as string[];
    return Object.fromEntries(ids.map((id) => [id, true as const]));
  } catch {
    return {};
  }
}

export interface DropHint {
  group: string;
  before: string | null;
  /** Index among the group's other tasks, and where the line goes (px from the top of the group; none over the task's own place). */
  index: number;
  y: number | null;
}

export interface TrashItem {
  task: Task;
  /** Subtasks deleted with it. */
  kids: Task[];
  /** When it was deleted (its last change). */
  at: number;
}

export type SplitLayer = "tasks" | "calendar";
export interface CalPrefs {
  mode: CalMode;
  weeks: number;
  days: number;
  monthLike: "month" | "multiweek";
  wrap: boolean;
}

function readSplitCal(raw: string | null): { splitCal: CalPrefs } | Record<string, never> {
  try {
    const x = JSON.parse(raw ?? "null") as Partial<CalPrefs> | null;
    if (!x) return {};
    const mode = (["month", "week", "multiweek", "days"] as const).find((m) => m === x.mode) ?? "month";
    return {
      splitCal: {
        mode,
        weeks: Math.max(2, Math.min(6, Number(x.weeks) || 4)),
        days: Math.max(1, Math.min(6, Number(x.days) || 3)),
        monthLike: x.monthLike === "multiweek" ? "multiweek" : "month",
        wrap: x.wrap === true,
      },
    };
  } catch {
    return {};
  }
}
export type Splits = Record<SplitLayer, SplitLayer | null>;
export type TaskViewRef = Exclude<ViewRef, { kind: "calendar" }>;

/** Splits as kept in meta: { tasks, calendar, view }; anything unreadable is no split. */
function readSplits(raw: string | null): { splits: Splits; splitView: TaskViewRef; splitRatio?: number } | Record<string, never> {
  try {
    const x = JSON.parse(raw ?? "null") as { tasks?: unknown; calendar?: unknown; view?: { kind?: unknown; id?: unknown }; ratio?: unknown } | null;
    if (!x) return {};
    const ratio = typeof x.ratio === "number" && x.ratio >= 0.2 && x.ratio <= 0.8 ? x.ratio : 0.5;
    const side = (v: unknown) => (v === "tasks" || v === "calendar" ? v : null);
    const view = x.view && (x.view.kind === "smart" || x.view.kind === "list") && typeof x.view.id === "string" ? (x.view as TaskViewRef) : ({ kind: "smart", id: "today" } as TaskViewRef);
    return { splits: { tasks: side(x.tasks), calendar: side(x.calendar) }, splitView: view, splitRatio: ratio };
  } catch {
    return {};
  }
}

/** The views (All, Today, …) hidden from the sidebar. The trash is hidden unless it was turned on ("sidebar:trash"). */
export function hiddenSmartViews(settings: Record<string, string>): SmartId[] {
  let v: SmartId[] = [];
  try {
    const x = JSON.parse(settings["sidebar:hidden"] ?? "[]");
    if (Array.isArray(x)) v = x.filter((id) => id !== "trash");
  } catch {
    /* none hidden */
  }
  return settings["sidebar:trash"] === "1" ? v : [...v, "trash"];
}


export type Theme = "system" | "light" | "dark";

export interface SyncState {
  status: "off" | "idle" | "syncing" | "error";
  message?: string;
  last?: number;
  /** The server speaks an older sync protocol than the app: what is new may not reach other devices. */
  outdated?: boolean;
  /** All servers together: the names of those that need updating. */
  oldServers?: string[];
  /** The server's version, when it says. */
  version?: string;
}

/** Screen rectangle a floating panel attaches to. */
export interface Anchor {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const anchorOf = (el: Element): Anchor => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

export type MenuTarget =
  /** `h`: height of the item the menu belongs to (it opens below the item, or above it when there is no room). `page`: open straight on a sub page. */
  | { kind: "task" | "list"; id: string; x: number; y: number; h?: number; page?: "date" | "deadline" | "move" }
  | { kind: "layer"; id: "tasks" | "calendar"; x: number; y: number }
  | { kind: "window"; id: string; x: number; y: number };

export type EditMode = "popup" | "pane";
export type CalMode = "month" | "week" | "multiweek" | "days";


export const SIDEBAR_DEFAULT = 262;

/** The four UI text sizes (Settings → Text size); 3 is the original size. Each multiplies every font size (--ts). */
export const TEXT_SIZES = [0.86, 0.93, 1, 1.08] as const;
export const TEXT_SIZE_DEFAULT = 3;
const clampTextSize = (n: number) => Math.max(1, Math.min(TEXT_SIZES.length, Math.round(n) || TEXT_SIZE_DEFAULT));
function applyTextSize(n: number) {
  if (typeof document !== "undefined") document.documentElement.style.setProperty("--ts", String(TEXT_SIZES[n - 1]));
}

/** Key under which a view's own settings are stored. */
export function viewKey(view: ViewRef): string {
  return view.kind === "calendar" ? "calendar" : `${view.kind}:${view.id}`;
}

/** Popup or side pane for a view: chosen per view, defaulting to the pane in list mode. */
export function computeEditMode(view: ViewRef, prefs: ViewPrefs | null, settings: Record<string, string>): EditMode {
  const stored = settings[`edit:${viewKey(view)}`];
  if (stored === "popup" || stored === "pane") return stored;
  if (view.kind === "calendar") return "popup";
  return prefs?.view_mode === "list" ? "pane" : "popup";
}

export interface UpdateState {
  status: "idle" | "checking" | "none" | "available" | "installing" | "error";
  version?: string;
  progress?: number;
  message?: string;
}

interface State {
  ready: boolean;
  fatal: string | null;
  lists: List[];
  sections: Section[];
  tasks: Task[];
  settings: Record<string, string>;
  view: ViewRef;
  /** The task view to return to from the calendar. */
  lastTaskView: ViewRef;
  selectedId: string | null;
  /** Set when the task was opened from a card, bar or chip: edit in a popup there. */
  anchor: Anchor | null;
  /** New-task popup, e.g. after dragging over days in the calendar. */
  composer: { anchor: Anchor; base: Partial<Task> } | null;
  menu: MenuTarget | null;
  /** Where a dragged task would land: before which task of which group (null: at the end). */
  dropHint: DropHint | null;
  renamingListId: string | null;
  focusSubtask: boolean;
  showCompleted: boolean;
  showDetails: boolean;
  /** Tasks just completed: still shown (struck through) for a moment, then gone. */
  lingering: Record<string, true>;
  /** The last completion, to take back from the undo button (until the view changes). */
  undo: Undo | null;
  /** Tasks whose subtasks are folded away in lists and on the board (kept on this device). */
  folded: Record<string, true>;
  /** Select mode: the selected task ids (null: not selecting). */
  selecting: string[] | null;
  sidebarOpen: boolean;
  sidebarWidth: number;
  /** Narrow windows: the list sidebar slides over the content. */
  drawerOpen: boolean;
  shortcuts: Shortcuts;
  calMode: CalMode;
  /** Rows shown in the multi-week calendar. */
  calWeeks: number;
  /** Multi-day: how many days side by side (1–6). */
  calDays: number;
  /** UI text size, 1–4 (3 = original). Kept per device. */
  textSize: number;
  /** Week view: long titles wrap onto more lines (else one line that fades out). */
  calWrap: boolean;
  /** Desktop: what each layer shows beside it, split (one each; kept per device). */
  splits: Splits;
  /** The tasks view of a split's second tasks pane. */
  splitView: TaskViewRef;
  setSplit(layer: SplitLayer, side: SplitLayer | null): void;
  /** The second pane's share of the two panes' width (0.2–0.8). */
  splitRatio: number;
  setSplitRatio(r: number): void;
  /** The split's calendar has settings of its own (mode, weeks, days, wrap). */
  splitCal: CalPrefs;
  setSplitCal(patch: Partial<CalPrefs>): void;
  /** The phone's floating task list (null: closed) and what it shows (This Week to begin with). */
  bubble: boolean;
  bubbleView: TaskViewRef;
  setBubble(open: boolean): void;
  setBubbleView(view: TaskViewRef): void;
  /** The phone calendar's open day (its day list under the week), for the add button. */
  calOpenDay: string | null;
  /** A task opened from its popup in the side pane, for as long as it stays open there (then popups again). */
  paneOnce: boolean;
  openInPane(id: string): void;
  /** Where the last pointer went down: a task picked in a split's second pane opens in a popup. */
  pointerIn: "main" | "split";
  setSplitView(view: TaskViewRef): void;
  /** Month or Multi-Week, whichever was chosen last (the target of the M shortcut). */
  calMonthLike: "month" | "multiweek";
  /** Bumped to make the calendar jump to today. */
  calTodayTick: number;
  /** A day the calendar should show (from a widget), with a counter so the same day can be asked for again. */
  calJump: { day: string; tick: number } | null;
  /** This window shows only one view layer (opened from the title bar). */
  detached: "tasks" | "calendar" | null;
  version: string;
  update: UpdateState;
  theme: Theme;
  shortcut: string;
  shortcutError: string | null;
  /** Sync servers set up on this device, in their order; off ones are hidden from every view and not synced. */
  servers: SyncServer[];
  /** Where new lists and Inbox tasks go. */
  defaultServer: string;
  /** Each server's state; `sync` sums them up. */
  serverSync: Record<string, SyncState>;
  sync: SyncState;

  init(): Promise<void>;
  reload(): Promise<void>;
  /** All data as Vitro CSV. */
  exportCsv(): Promise<string>;
  importCsv(text: string): Promise<ImportResult>;
  importTickTick(text: string, includeCompleted: boolean): Promise<ImportResult>;
  setView(view: ViewRef): void;
  select(id: string | null, anchor?: Anchor | null): void;
  openComposer(base: Partial<Task>, anchor: Anchor): void;
  closeComposer(): void;
  openMenu(menu: MenuTarget | null): void;
  setDropHint(hint: DropHint | null): void;
  /** Drops a task at a place in a group: moves it there (group change) and orders it. */
  dropTask(view: ViewRef, sort: SortBy, group: Pick<Group, "tasks" | "patch">, taskId: string, index: number): Promise<void>;
  /** Whether a view has a custom order for a sort. */
  hasCustomOrder(view: ViewRef, sort: SortBy): boolean;
  clearCustomOrder(view: ViewRef, sort: SortBy): Promise<void>;
  setRenamingList(id: string | null): void;
  addSubtaskTo(id: string, anchor?: Anchor | null): void;
  setShowCompleted(v: boolean): void;
  undoLast(): Promise<void>;
  toggleFold(id: string): void;
  /** Folds (or unfolds) these tasks' subtasks at once (`keys` as `useFold` makes them). */
  setFolds(keys: string[], on: boolean): void;
  setSelecting(ids: string[] | null): void;
  toggleSelected(id: string): void;
  setShowDetails(v: boolean): Promise<void>;
  setSidebarOpen(v: boolean): void;
  setSidebarWidth(px: number, save?: boolean): void;
  setDrawerOpen(v: boolean): void;
  setShortcuts(s: Shortcuts): Promise<void>;
  setCalMode(m: CalMode): void;
  setCalWeeks(n: number): void;
  setCalDays(n: number): void;
  setTextSize(n: number): void;
  setCalWrap(on: boolean): void;
  goCalToday(): void;
  /** Shows a day in the calendar (a tap on a widget's day). */
  goCalDay(day: string): void;
  editMode(view: ViewRef): EditMode;
  setEditMode(view: ViewRef, mode: EditMode): Promise<void>;
  /** Which of All, Today, … the sidebar shows (Settings → Sidebar; synced). */
  setSmartShown(id: SmartId, shown: boolean): Promise<void>;
  /** The palette new lists take their colours from (synced). */
  setPalette(id: string): Promise<void>;
  setListVisibility(listId: string, key: VisibilityKey, shown: boolean): Promise<void>;
  checkUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  duplicateTask(id: string): Promise<void>;
  setWontDo(id: string): Promise<void>;
  setTheme(t: Theme): Promise<void>;
  setShortcut(s: string): Promise<void>;

  addTask(patch: Partial<Task> & { title: string }): Promise<Task>;
  /** Adds a task at once (shown before it is saved): for a line that has to exist within a keystroke. */
  addTaskNow(patch: Partial<Task> & { title: string }): Task;
  updateTask(id: string, patch: Partial<Task>): Promise<void>;
  /** Shows a change while it is being dragged, without saving it. */
  previewTask(id: string, patch: Partial<Task>): void;
  /** Completes (or reopens) a task. `quiet`: no lingering and no undo (the parent's editor shows it anyway). */
  toggleTask(id: string, opts?: { quiet?: boolean }): Promise<void>;
  /** Completes open tasks (and their open subtasks) as one step the undo button takes back. */
  completeTasks(ids: string[], opts?: { quiet?: boolean; silent?: boolean }): Promise<void>;
  deleteTask(id: string): Promise<void>;
  /** The trash: deleted tasks (subtasks deleted with their task travel with it), last deleted first; null until read. */
  trash: TrashItem[] | null;
  loadTrash(): Promise<void>;
  /** Back where it was (with the subtasks deleted with it); into the Inbox if its list is gone too. */
  restoreTask(id: string): Promise<void>;
  /** Out of the trash for good, on every device. */
  purgeTasks(ids: string[]): Promise<void>;

  addList(name: string, parentId?: string | null): Promise<List>;
  updateList(id: string, patch: Partial<List>): Promise<void>;
  deleteList(id: string): Promise<void>;

  addSection(listId: string, name: string): Promise<Section>;
  updateSection(id: string, patch: Partial<Section>): Promise<void>;
  deleteSection(id: string): Promise<void>;

  prefs(view: ViewRef): ViewPrefs;
  setPrefs(view: ViewRef, patch: Partial<ViewPrefs>): Promise<void>;

  addServer(s: { name: string; url: string; token: string }): Promise<void>;
  updateServer(id: string, patch: Partial<Omit<SyncServer, "id">>): Promise<void>;
  /** The only server: its tasks stay on this device. One of several: its lists leave this device (they stay on the server). */
  removeServer(id: string): Promise<void>;
  setDefaultServer(id: string): Promise<void>;
  /** A list (with its sublists, sections and tasks) moves to another server. */
  moveListToServer(listId: string, serverId: string, parentId?: string | null): Promise<void>;
  syncNow(): Promise<void>;
  /** What the home screen widgets need to sync on their own (src/widget/core.ts): the data, and each server that is on with this device's position. */
  widgetState(): Promise<WidgetState>;
  /** Takes over rows changed in a widget (ticks), as they are. */
  adoptWidgetChanges(changes: AdoptedChange[]): Promise<void>;
}

export { computePrefs };

export interface ImportResult {
  lists: number;
  sections: number;
  tasks: number;
  /** Rows that were already there (and not older). */
  skipped: number;
  notes?: { repeating: number; tags: string[]; reminders: number };
  /** Open tasks imported before repeats existed that got their repeat rule now. */
  repeats?: number;
}

let db: Db;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncing = false;
let foundUpdate: FoundUpdate | null = null;

const nextPos = (rows: { position: number }[]) => rows.reduce((m, r) => Math.max(m, r.position), 0) + 1;

export const useStore = create<State>((set, get) => {
  /** The splits, the second pane's view and its width, kept per device. */
  function saveSplits() {
    const { splits, splitView, splitRatio } = get();
    void setMeta(db, "splits", JSON.stringify({ ...splits, view: splitView, ratio: splitRatio }));
  }
  /** Writes a row locally, mirrors it in memory, and queues a sync. */
  /**
   * The database's timestamp, taken back into the row that was saved, without a
   * second render of everything (it landed in the middle of animations: a picker
   * closing, the sheet). Nothing on screen shows it; if a newer edit replaced the
   * row meanwhile, only the old object is touched (as before: memory keeps the newer edit).
   */
  function stamp(row: { updated_at: number }, at: number) {
    row.updated_at = at;
  }

  /** The server new rows go to: the default one while it is on, else the first one that is on. */
  function homeServer(): string {
    const { servers, defaultServer } = get();
    const on = servers.filter((x) => x.enabled);
    if (on.some((x) => x.id === defaultServer)) return defaultServer;
    return on[0]?.id ?? defaultServer;
  }
  /** A new row lives where what it belongs to lives (its list, its parent task); an existing row keeps its server. */
  function originFor(name: EntityName, row: Record<string, unknown>): string {
    if (typeof row.origin === "string") return row.origin;
    const listOrigin = (id: unknown) => (typeof id === "string" ? get().lists.find((l) => l.id === id)?.origin : undefined);
    if (name === "lists") return listOrigin(row.parent_id) ?? homeServer();
    if (name === "sections") return listOrigin(row.list_id) ?? homeServer();
    if (name === "tasks")
      return listOrigin(row.list_id) ?? (typeof row.parent_id === "string" ? get().tasks.find((t) => t.id === row.parent_id)?.origin : undefined) ?? homeServer();
    return homeServer();
  }

  async function save<T extends { id: string }>(name: EntityName, row: T): Promise<T> {
    // Set on the row itself too: it may be the object already shown (it then knows its server).
    (row as { origin?: string }).origin = originFor(name, row as unknown as Record<string, unknown>);
    const saved = (await put(db, name, row as unknown as Row)) as unknown as T;
    void announceChange();
    scheduleSync();
    return saved;
  }

  function scheduleSync(delay = 1500) {
    if (!get().servers.some((x) => x.enabled)) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void get().syncNow(), delay);
  }

  /**
   * Writes imported rows. "missing" adds only rows that are not there yet
   * (importing the same backup twice changes nothing); "newer" also replaces
   * rows whose imported version is newer than the local one.
   */
  async function writeImport(data: Partial<Record<EntityName, Row[]>>, mode: "missing" | "newer"): Promise<ImportResult> {
    const res: ImportResult = { lists: 0, sections: 0, tasks: 0, skipped: 0 };
    for (const name of ["lists", "sections", "tasks", "settings"] as EntityName[]) {
      for (const row of data[name] ?? []) {
        const local = await db.all<{ updated_at: number; deleted: number }>(`SELECT updated_at, deleted FROM ${name} WHERE id = $1`, [row.id as string]);
        const have = local.length > 0 && local[0].deleted === 0;
        if (have && (mode === "missing" || Number(row.updated_at) <= local[0].updated_at)) {
          res.skipped++;
          continue;
        }
        // New rows land on the default server; replaced ones keep theirs.
        await put(db, name, { ...row, deleted: 0, origin: homeServer() });
        if (name !== "settings") res[name]++;
      }
    }
    await get().reload();
    void announceChange();
    scheduleSync(300);
    return res;
  }

  /**
   * Rows cannot change servers in place (the old server would keep them, and other
   * devices would get the same row from two places): they are copied to the new
   * server under new ids and deleted on the old one.
   */
  async function moveTaskToServer(cur: Task, patch: Partial<Task>, to: string) {
    const kids = get().tasks.filter((t) => t.parent_id === cur.id);
    const copy: Task = { ...cur, ...patch, id: uid(), origin: to, section_id: patch.section_id ?? null };
    const kidCopies = kids.map((k) => ({ ...k, id: uid(), origin: to, parent_id: copy.id, list_id: copy.list_id, section_id: null }));
    const gone = new Set([cur.id, ...kids.map((k) => k.id)]);
    set({
      tasks: [...get().tasks.filter((t) => !gone.has(t.id)), copy, ...kidCopies],
      selectedId: get().selectedId === cur.id ? copy.id : gone.has(get().selectedId ?? "") ? null : get().selectedId,
    });
    for (const t of [copy, ...kidCopies]) await put(db, "tasks", t as unknown as Row);
    for (const x of gone) await remove(db, "tasks", x);
    void announceChange();
    scheduleSync();
  }

  /** Returns the list's new id. */
  async function moveListTree(listId: string, to: string, parentId: string | null): Promise<string> {
    const { lists, sections, tasks, view } = get();
    const ids = listWithDescendants(lists, listId);
    const listMap = new Map(ids.map((x) => [x, uid()]));
    const secs = sections.filter((x) => ids.includes(x.list_id));
    const secMap = new Map(secs.map((x) => [x.id, uid()]));
    const ts = tasks.filter((t) => t.list_id && ids.includes(t.list_id));
    const taskMap = new Map(ts.map((t) => [t.id, uid()]));
    const newLists = lists
      .filter((l) => ids.includes(l.id))
      .map((l) => ({ ...l, id: listMap.get(l.id)!, origin: to, parent_id: l.id === listId ? parentId : (listMap.get(l.parent_id ?? "") ?? l.parent_id) }));
    const newSecs = secs.map((x) => ({ ...x, id: secMap.get(x.id)!, origin: to, list_id: listMap.get(x.list_id)! }));
    const newTasks = ts.map((t) => ({
      ...t,
      id: taskMap.get(t.id)!,
      origin: to,
      list_id: listMap.get(t.list_id!)!,
      section_id: t.section_id ? (secMap.get(t.section_id) ?? null) : null,
      parent_id: t.parent_id ? (taskMap.get(t.parent_id) ?? t.parent_id) : null,
    }));
    const sel = get().selectedId;
    set({
      lists: [...lists.filter((l) => !listMap.has(l.id)), ...newLists],
      sections: [...sections.filter((x) => !secMap.has(x.id)), ...newSecs],
      tasks: [...tasks.filter((t) => !taskMap.has(t.id)), ...newTasks],
      view: view.kind === "list" && listMap.has(view.id) ? { kind: "list", id: listMap.get(view.id)! } : view,
      selectedId: sel && taskMap.has(sel) ? taskMap.get(sel)! : sel,
    });
    for (const l of newLists) await put(db, "lists", l as unknown as Row);
    for (const x of newSecs) await put(db, "sections", x as unknown as Row);
    for (const t of newTasks) await put(db, "tasks", t as unknown as Row);
    for (const x of taskMap.keys()) await remove(db, "tasks", x);
    for (const x of secMap.keys()) await remove(db, "sections", x);
    for (const x of listMap.keys()) await remove(db, "lists", x);
    void announceChange();
    scheduleSync();
    return listMap.get(listId)!;
  }

  function repeatStep(cur: Task, status: 1 | 2, at: number): RepeatStep | null {
    return makeRepeatStep(cur, get().tasks.filter((t) => t.parent_id === cur.id), status, at, uid);
  }

  /** Shows the whole step at once (no frame with both the copy and the unmoved task), then saves it. */
  async function applyRepeatStep(step: RepeatStep) {
    // The next occurrence starts with its checklist open again.
    const rows = stepRows(step);
    let tasks = get().tasks;
    for (const r of rows) tasks = replace(tasks, r);
    set({ tasks });
    for (const r of rows) stamp(r, (await save("tasks", r)).updated_at);
  }

  /** One server's round trip, with its own state. */
  async function syncServer(server: SyncServer): Promise<number> {
    const mark = (st: SyncState) => set({ serverSync: { ...get().serverSync, [server.id]: st } });
    mark({ ...get().serverSync[server.id], status: "syncing", message: undefined });
    try {
      const r = await syncOnce(db, server);
      mark({ status: "idle", last: Date.now(), outdated: r.outdated, version: r.serverVersion });
      return r.pulled;
    } catch (e) {
      mark({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
        last: get().serverSync[server.id]?.last,
        outdated: e instanceof OutdatedServerError,
      });
      return 0;
    }
  }

  /** All servers in one state, for the title bar's button. */
  function sumUp(): SyncState {
    const on = get().servers.filter((x) => x.enabled);
    if (!on.length) return { status: "off" };
    const states = on.map((x) => get().serverSync[x.id] ?? { status: "idle" as const });
    const failed = on.filter((x) => get().serverSync[x.id]?.status === "error");
    if (failed.length) return { status: "error", message: failed.map((x) => `${x.name}: ${get().serverSync[x.id]?.message ?? "failed"}`).join(" · ") };
    if (states.some((x) => x.status === "syncing")) return { status: "syncing" };
    const lasts = states.map((x) => x.last ?? 0);
    const old = on.filter((x) => get().serverSync[x.id]?.outdated).map((x) => x.name);
    return { status: "idle", last: lasts.some((x) => !x) ? undefined : Math.min(...lasts), ...(old.length ? { oldServers: old } : {}) };
  }

  async function storeServers(servers: SyncServer[]) {
    await setServers(db, servers);
    set({ servers });
  }

  function replace<T extends { id: string }>(rows: T[], row: T): T[] {
    return rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row];
  }

  return {
    ready: false,
    fatal: null,
    lists: [],
    sections: [],
    tasks: [],
    settings: {},
    view: { kind: "smart", id: "today" },
    lastTaskView: { kind: "smart", id: "today" },
    selectedId: null,
    anchor: null,
    composer: null,
    menu: null,
    dropHint: null,
    renamingListId: null,
    focusSubtask: false,
    showCompleted: false,
    showDetails: true,
    lingering: {},
    undo: null,
    folded: readFolded(),
    selecting: null,
    sidebarOpen: true,
    sidebarWidth: SIDEBAR_DEFAULT,
    drawerOpen: false,
    shortcuts: parseShortcuts(null),
    calMode: "month",
    calWeeks: 4,
    calDays: 3,
    splits: { tasks: null, calendar: null },
    splitRatio: 0.5,
    splitCal: { mode: "month", weeks: 4, days: 3, monthLike: "month", wrap: false },
    paneOnce: false,
    bubble: false,
    bubbleView: { kind: "smart", id: "thisweek" },
    calOpenDay: null,
    pointerIn: "main",
    splitView: { kind: "smart", id: "today" },
    trash: null,
    textSize: TEXT_SIZE_DEFAULT,
    calWrap: false,
    calMonthLike: "month",
    calTodayTick: 0,
    calJump: null,
    detached: detachedLayer(),
    version: "",
    update: { status: "idle" },
    theme: "system",
    shortcut: DEFAULT_SHORTCUT,
    shortcutError: null,
    servers: [],
    defaultServer: "",
    serverSync: {},
    sync: { status: "off" },

    async init() {
      try {
        db = await openDb();
        await migrate(db);
        const theme = ((await getMeta(db, "theme")) as Theme | null) ?? "system";
        const shortcut = (await getMeta(db, "quickadd_shortcut")) ?? DEFAULT_SHORTCUT;
        const servers = await getServers(db);
        const defaultServer = await getDefaultServer(db);
        const showDetails = (await getMeta(db, "show_details")) !== "0";
        const sidebarWidth = Number(await getMeta(db, "sidebar_width")) || SIDEBAR_DEFAULT;
        const shortcuts = parseShortcuts(await getMeta(db, "shortcuts"));
        const calMode = ((await getMeta(db, "cal_mode")) as CalMode | null) ?? "month";
        const calWeeks = Math.max(2, Math.min(6, Number(await getMeta(db, "cal_weeks")) || 4));
        const calDays = Math.max(1, Math.min(6, Number(await getMeta(db, "cal_days")) || 3));
        const calMonthLike = (await getMeta(db, "cal_month_like")) === "multiweek" ? "multiweek" : "month";
        const calWrap = (await getMeta(db, "cal_wrap")) === "1";
        const textSize = clampTextSize(Number(await getMeta(db, "text_size")));
        applyTextSize(textSize);
        set({ calWeeks, calDays, calMonthLike, calWrap, textSize, ...readSplits(await getMeta(db, "splits")), ...readSplitCal(await getMeta(db, "split_cal")) });
        set({ theme, shortcut, servers, defaultServer, showDetails, sidebarWidth, shortcuts, calMode, sync: { status: servers.some((x) => x.enabled) ? "idle" : "off" } });
        // A detached window starts on the view it was opened from.
        const handoff = get().detached ? takeHandoff<ViewRef>() : null;
        if (handoff) set({ view: handoff, ...(handoff.kind !== "calendar" ? { lastTaskView: handoff } : {}) });
        void appVersion().then((version) => set({ version }));
        await get().reload();
        set({ ready: true });
        void onRemoteChange(() => void get().reload());
        // Both are no-ops until a sync server is configured.
        void get().syncNow();
        setInterval(() => void get().syncNow(), 60_000);
        window.addEventListener("focus", () => scheduleSync(200));
      } catch (e) {
        set({ fatal: e instanceof Error ? e.message : String(e) });
      }
    },

    async exportCsv() {
      const [lists, sections, tasks, settings] = await Promise.all([
        loadAll<Row>(db, "lists"),
        loadAll<Row>(db, "sections"),
        loadAll<Row>(db, "tasks"),
        loadAll<Row>(db, "settings"),
      ]);
      return writeVitroCsv({ lists, sections, tasks, settings });
    },

    async importCsv(text) {
      const data = readVitroCsv(text);
      return writeImport(data, "newer");
    },

    async importTickTick(text, includeCompleted) {
      const r = readTickTick(text, { lists: get().lists }, { includeCompleted, colors: Array.from({ length: 8 }, (_, i) => colorForNew(defaultPalette(get().settings), i)) });
      const res = await writeImport({ lists: r.lists as unknown as Row[], sections: r.sections as unknown as Row[], tasks: r.tasks as unknown as Row[] }, "missing");
      // Tasks from an earlier import of the same backup get the repeat rules that did not carry over then.
      let repeats = 0;
      const here = new Map(get().tasks.map((t) => [t.id, t]));
      for (const t of r.tasks) {
        const l = here.get(t.id);
        if (t.repeat && l && l.status === 0 && !l.repeat) {
          await get().updateTask(l.id, { repeat: t.repeat });
          repeats++;
        }
      }
      return { ...res, notes: r.notes, repeats };
    },

    async reload() {
      const [allLists, allSections, allTasks, settingRows, servers, defaultServer] = await Promise.all([
        loadAll<List>(db, "lists"),
        loadAll<Section>(db, "sections"),
        loadAll<Task>(db, "tasks"),
        loadAll<Setting>(db, "settings"),
        getServers(db),
        getDefaultServer(db),
      ]);
      const settings: Record<string, string> = {};
      for (const s of settingRows) settings[s.id] = s.value;
      // What lives on a server that is switched off is not shown anywhere.
      const off = new Set(servers.filter((x) => !x.enabled).map((x) => x.id));
      const shown = <T extends { origin?: string }>(rows: T[]) => (off.size ? rows.filter((r) => !off.has(r.origin ?? "")) : rows);
      const lists = shown(allLists);
      const sections = shown(allSections);
      const tasks = shown(allTasks);
      set({ lists, sections, tasks, settings, servers, defaultServer });
      const { view, selectedId } = get();
      if (view.kind === "list" && !lists.some((l) => l.id === view.id)) set({ view: { kind: "smart", id: "today" } });
      if (selectedId && !tasks.some((t) => t.id === selectedId)) set({ selectedId: null });
    },

    setView(view) {
      set({
        view,
        selectedId: null,
        anchor: null,
        composer: null,
        drawerOpen: false,
        undo: null,
        selecting: null,
        ...(view.kind !== "calendar" ? { lastTaskView: view } : {}),
      });
    },
    async undoLast() {
      const u = get().undo;
      if (!u) return;
      set({ undo: null });
      for (const id of u.ids) {
        const t = get().tasks.find((x) => x.id === id);
        if (t && t.status !== 0) await get().updateTask(id, { status: 0, completed_at: null });
      }
      // Repeating tasks: back to the occurrence they were on, without the done copy.
      for (const id of u.remove ?? []) await get().deleteTask(id);
      for (const was of u.restore ?? []) {
        const { id, updated_at: _u, origin: _o, ...fields } = was;
        if (get().tasks.some((t) => t.id === id)) await get().updateTask(id, fields);
      }
    },
    toggleFold(id) {
      const folded = { ...get().folded };
      if (folded[id]) delete folded[id];
      else folded[id] = true;
      set({ folded });
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify(Object.keys(folded)));
      } catch {
        /* storage may be unavailable */
      }
    },
    setFolds(keys, on) {
      const folded = { ...get().folded };
      for (const k of keys) {
        if (on) folded[k] = true;
        else delete folded[k];
      }
      set({ folded });
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify(Object.keys(folded)));
      } catch {
        /* storage may be unavailable */
      }
    },
    setSelecting(ids) {
      set({ selecting: ids, ...(ids ? { selectedId: null, anchor: null } : {}) });
    },
    toggleSelected(id) {
      const cur = get().selecting;
      if (!cur) return;
      set({ selecting: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    },
    select(id, anchor = null) {
      // The side pane was only for that task: anything else opens as usual again.
      set({ selectedId: id, anchor: id ? anchor : null, composer: null, focusSubtask: false, paneOnce: false });
    },
    setBubble(open) {
      set({ bubble: open });
    },
    setBubbleView(view) {
      set({ bubbleView: view });
    },
    openInPane(id) {
      set({ selectedId: id, composer: null, focusSubtask: false, paneOnce: true });
    },
    openComposer(base, anchor) {
      set({ composer: { base, anchor }, selectedId: null, anchor: null });
    },
    closeComposer() {
      set({ composer: null });
    },
    openMenu(menu) {
      set({ menu });
    },
    setRenamingList(id) {
      set({ renamingListId: id });
    },
    addSubtaskTo(id, anchor = null) {
      set({ selectedId: id, anchor, composer: null, focusSubtask: true });
    },
    setShowCompleted(v) {
      set({ showCompleted: v });
    },
    async setShowDetails(v) {
      set({ showDetails: v });
      await setMeta(db, "show_details", v ? "1" : "0");
    },
    setSidebarOpen(v) {
      set({ sidebarOpen: v });
    },
    setSidebarWidth(px, save = false) {
      const w = Math.round(Math.max(180, Math.min(480, px)));
      set({ sidebarWidth: w });
      if (save) void setMeta(db, "sidebar_width", String(w));
    },
    setDrawerOpen(v) {
      set({ drawerOpen: v });
    },
    async setShortcuts(shortcuts) {
      set({ shortcuts });
      await setMeta(db, "shortcuts", JSON.stringify(shortcuts));
    },
    setCalMode(calMode) {
      set({ calMode });
      void setMeta(db, "cal_mode", calMode);
      if (calMode === "month" || calMode === "multiweek") {
        set({ calMonthLike: calMode });
        void setMeta(db, "cal_month_like", calMode);
      }
    },
    setCalWrap(calWrap) {
      set({ calWrap });
      void setMeta(db, "cal_wrap", calWrap ? "1" : "0");
    },
    setCalWeeks(n) {
      const calWeeks = Math.max(2, Math.min(6, n));
      set({ calWeeks });
      void setMeta(db, "cal_weeks", String(calWeeks));
    },
    setSplit(layer, side) {
      set({ splits: { ...get().splits, [layer]: side } });
      saveSplits();
    },
    setSplitView(view) {
      set({ splitView: view });
      saveSplits();
    },
    setSplitRatio(r) {
      set({ splitRatio: Math.max(0.2, Math.min(0.8, r)) });
      saveSplits();
    },
    setSplitCal(patch) {
      const next = { ...get().splitCal, ...patch };
      if (patch.mode === "month" || patch.mode === "multiweek") next.monthLike = patch.mode;
      next.weeks = Math.max(2, Math.min(6, next.weeks));
      next.days = Math.max(1, Math.min(6, next.days));
      set({ splitCal: next });
      void setMeta(db, "split_cal", JSON.stringify(next));
    },
    setCalDays(n) {
      const calDays = Math.max(1, Math.min(6, n));
      set({ calDays });
      void setMeta(db, "cal_days", String(calDays));
    },
    setTextSize(n) {
      const textSize = clampTextSize(n);
      applyTextSize(textSize);
      set({ textSize });
      void setMeta(db, "text_size", String(textSize));
    },
    goCalToday() {
      set({ calTodayTick: get().calTodayTick + 1 });
    },
    goCalDay(day) {
      set({ calJump: { day, tick: (get().calJump?.tick ?? 0) + 1 } });
    },
    editMode(view) {
      const prefs = view.kind === "calendar" ? null : computePrefs(view, get().lists, get().settings);
      return computeEditMode(view, prefs, get().settings);
    },
    async setEditMode(view, mode) {
      const key = `edit:${viewKey(view)}`;
      set({ settings: { ...get().settings, [key]: mode } });
      await save("settings", { id: key, value: mode, updated_at: 0, deleted: 0 } as Setting);
    },
    async setPalette(palette) {
      set({ settings: { ...get().settings, palette } });
      await save("settings", { id: "palette", value: palette, updated_at: 0, deleted: 0 } as Setting);
    },
    async setSmartShown(smart, shown) {
      if (smart === "trash") {
        const value = shown ? "1" : "";
        set({ settings: { ...get().settings, "sidebar:trash": value } });
        await save("settings", { id: "sidebar:trash", value, updated_at: 0, deleted: 0 } as Setting);
        return;
      }
      const id = "sidebar:hidden";
      const hidden = hiddenSmartViews(get().settings).filter((x) => x !== smart);
      const value = JSON.stringify((shown ? hidden : [...hidden, smart]).filter((x) => x !== "trash"));
      set({ settings: { ...get().settings, [id]: value } });
      await save("settings", { id, value, updated_at: 0, deleted: 0 } as Setting);
    },

    async setListVisibility(listId, key, shown) {
      const id = `listvis:${listId}`;
      const value = JSON.stringify({ ...listVisibility(get().settings, listId), [key]: shown });
      set({ settings: { ...get().settings, [id]: value } });
      await save("settings", { id, value, updated_at: 0, deleted: 0 } as Setting);
    },

    async checkUpdate() {
      if (get().update.status === "checking" || get().update.status === "installing") return;
      set({ update: { status: "checking" } });
      try {
        foundUpdate = await findUpdate();
        set({ update: foundUpdate ? { status: "available", version: foundUpdate.version } : { status: "none" } });
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        // A release published without the signed feed answers with no usable JSON.
        const message = /release JSON|404|not found/i.test(raw) ? "no update feed has been published yet" : raw;
        set({ update: { status: "error", message } });
      }
    },
    async installUpdate() {
      if (!foundUpdate || get().update.status === "installing") return;
      const version = foundUpdate.version;
      set({ update: { status: "installing", version, progress: 0 } });
      try {
        await foundUpdate.install((progress) => set({ update: { status: "installing", version, progress } }));
      } catch (e) {
        set({ update: { status: "error", version, message: e instanceof Error ? e.message : String(e) } });
      }
    },

    async duplicateTask(id) {
      const cur = get().tasks.find((t) => t.id === id);
      if (!cur) return;
      const { id: _id, updated_at: _u, created_at: _c, ...rest } = cur;
      const copy = await get().addTask({ ...rest, title: cur.title, position: cur.position + 0.5 });
      for (const child of get().tasks.filter((t) => t.parent_id === id)) {
        const { id: _i, updated_at: _up, created_at: _cr, ...c } = child;
        await get().addTask({ ...c, parent_id: copy.id });
      }
    },
    async setWontDo(id) {
      const cur = get().tasks.find((t) => t.id === id);
      if (!cur) return;
      // A repeating task skips this occurrence: a won't-do copy keeps it, the task moves on.
      const step = cur.status === 0 ? repeatStep(cur, 2, Date.now()) : null;
      if (step) return applyRepeatStep(step);
      await get().updateTask(id, { status: 2, completed_at: Date.now() });
    },
    async setTheme(theme) {
      set({ theme });
      await setMeta(db, "theme", theme);
    },
    async setShortcut(shortcut) {
      try {
        await setQuickAddShortcut(shortcut);
        set({ shortcut, shortcutError: null });
        await setMeta(db, "quickadd_shortcut", shortcut);
      } catch (e) {
        set({ shortcutError: e instanceof Error ? e.message : String(e) });
      }
    },

    async addTask(patch) {
      const { tasks } = get();
      const now = Date.now();
      const task: Task = {
        id: uid(),
        list_id: null,
        section_id: null,
        parent_id: null,
        notes: "",
        priority: 0,
        status: 0,
        start_date: null,
        start_time: null,
        end_date: null,
        end_time: null,
        deadline_date: null,
        deadline_time: null,
        completed_at: null,
        position: nextPos(tasks),
        pinned: 0,
        created_at: now,
        updated_at: now,
        deleted: 0,
        repeat: null,
        horizon: null,
        ...separateWhen(patch),
      } as Task;
      const saved = await save("tasks", task);
      set({ tasks: [...get().tasks, saved] });
      return saved;
    },

    addTaskNow(patch) {
      const now = Date.now();
      const task: Task = {
        id: uid(),
        list_id: null,
        section_id: null,
        parent_id: null,
        notes: "",
        priority: 0,
        status: 0,
        start_date: null,
        start_time: null,
        end_date: null,
        end_time: null,
        deadline_date: null,
        deadline_time: null,
        completed_at: null,
        position: nextPos(get().tasks),
        pinned: 0,
        created_at: now,
        updated_at: now,
        deleted: 0,
        repeat: null,
        horizon: null,
        ...separateWhen(patch),
      } as Task;
      set({ tasks: [...get().tasks, task] });
      // Only the timestamp comes back: the line may already have been written in.
      void save("tasks", task).then((saved) => stamp(task, saved.updated_at));
      return task;
    },

    async updateTask(id, change) {
      const cur = get().tasks.find((t) => t.id === id);
      if (!cur) return;
      // A repeating task keeps its date (its series moves on from it): This Week is not for it.
      if (change.horizon && (change.repeat === undefined ? cur.repeat : change.repeat)) {
        const { horizon: _h, ...rest } = change;
        change = rest;
        if (!Object.keys(change).length) return;
      }
      const patch = separateWhen(change);
      // Into a list on another server (or the Inbox of the default one): the task moves there.
      if (patch.list_id !== undefined && patch.list_id !== cur.list_id && !cur.parent_id) {
        const to = patch.list_id ? get().lists.find((l) => l.id === patch.list_id)?.origin : homeServer();
        if (to !== undefined && to !== (cur.origin ?? "")) return moveTaskToServer(cur, patch, to);
      }
      const next = { ...cur, ...patch };
      // Moving to another list drops a section that does not belong there.
      if (patch.list_id !== undefined && patch.list_id !== cur.list_id && patch.section_id === undefined) {
        next.section_id = null;
      }
      set({ tasks: replace(get().tasks, next) });
      const saved = await save("tasks", next);
      stamp(next, saved.updated_at);
      // Subtasks follow their parent into another list.
      if (next.list_id !== cur.list_id) {
        for (const child of get().tasks.filter((t) => t.parent_id === id)) {
          await get().updateTask(child.id, { list_id: next.list_id, section_id: null });
        }
      }
    },

    previewTask(id, change) {
      const patch = separateWhen(change);
      set({ tasks: get().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    },

    async toggleTask(id, opts = {}) {
      const cur = get().tasks.find((t) => t.id === id);
      if (!cur) return;
      if (cur.status !== 0) {
        // A done or won't-do task reopens; an undo for it is no longer needed.
        const u = get().undo;
        if (u?.ids.includes(id)) set({ undo: null });
        await get().updateTask(id, { status: 0, completed_at: null });
        return;
      }
      await get().completeTasks([id], opts);
    },

    async completeTasks(ids, opts = {}) {
      const tasks = get().tasks;
      const open = ids.filter((id) => tasks.some((t) => t.id === id && t.status === 0));
      if (!open.length) return;
      const at = Date.now();
      // A repeating task moves on to its next date; a done copy keeps this occurrence.
      const steps = open.map((id) => repeatStep(tasks.find((t) => t.id === id)!, 1, at)).filter((x): x is RepeatStep => !!x);
      const moving = new Set(steps.map((x) => x.task.id));
      const plain = open.filter((id) => !moving.has(id));
      // Open subtasks are done with their parent.
      const all = [...new Set(plain.flatMap((id) => [id, ...tasks.filter((t) => t.parent_id === id && t.status === 0).map((t) => t.id)]))];
      const copies = steps.flatMap((x) => [x.copy.id, ...x.kidCopies.map((k) => k.id)]);
      // Silent: ticked in a widget, taken over as the app comes forward.
      if (!opts.silent) haptic("success");
      if (!opts.quiet && !opts.silent) {
        // Struck through where they are for a moment, then gone; the undo button stays until the view changes.
        const shown = [...all, ...copies];
        set({
          lingering: { ...get().lingering, ...Object.fromEntries(shown.map((x) => [x, true as const])) },
          undo: { ids: all, restore: steps.flatMap((x) => [x.task, ...x.kids]), remove: steps.map((x) => x.copy.id) },
        });
        setTimeout(() => {
          const l = { ...get().lingering };
          for (const x of shown) delete l[x];
          set({ lingering: l });
        }, LINGER_MS);
      }
      for (const step of steps) await applyRepeatStep(step);
      for (const x of all) await get().updateTask(x, { status: 1, completed_at: at });
    },

    async deleteTask(id) {
      const ids = [id, ...get().tasks.filter((t) => t.parent_id === id).map((t) => t.id)];
      set({
        tasks: get().tasks.filter((t) => !ids.includes(t.id)),
        selectedId: ids.includes(get().selectedId ?? "") ? null : get().selectedId,
      });
      for (const x of ids) await remove(db, "tasks", x);
      void announceChange();
      scheduleSync();
    },

    async loadTrash() {
      const rows = await loadDeletedTasks<Task>(db);
      const deleted = new Set(rows.map((t) => t.id));
      const kidsOf = new Map<string, Task[]>();
      for (const t of rows) if (t.parent_id && deleted.has(t.parent_id)) kidsOf.set(t.parent_id, [...(kidsOf.get(t.parent_id) ?? []), t]);
      const trash = rows
        .filter((t) => !t.parent_id || !deleted.has(t.parent_id))
        .map((task) => ({ task, kids: kidsOf.get(task.id) ?? [], at: task.updated_at }))
        .sort((a, b) => b.at - a.at);
      set({ trash });
    },

    async restoreTask(id) {
      const item = get().trash?.find((x) => x.task.id === id);
      if (!item) return;
      const { lists, sections, tasks } = get();
      const listLive = !item.task.list_id || lists.some((l) => l.id === item.task.list_id);
      const list_id = listLive ? item.task.list_id : null;
      const sectionLive = !!item.task.section_id && listLive && sections.some((x) => x.id === item.task.section_id);
      const section_id = sectionLive ? item.task.section_id : null;
      // A subtask deleted on its own goes back under its task (which is still there: else it travelled with it).
      const parent_id = item.task.parent_id && tasks.some((t) => t.id === item.task.parent_id) ? item.task.parent_id : null;
      await put(db, "tasks", { ...item.task, deleted: 0, list_id, section_id, parent_id } as unknown as Row);
      for (const k of item.kids) await put(db, "tasks", { ...k, deleted: 0, list_id, section_id } as unknown as Row);
      set({ trash: get().trash!.filter((x) => x.task.id !== id) });
      await get().reload();
      void announceChange();
      scheduleSync();
    },

    async purgeTasks(ids) {
      const items = (get().trash ?? []).filter((x) => ids.includes(x.task.id));
      for (const x of items) for (const t of [x.task, ...x.kids]) await purgeTask(db, t.id);
      set({ trash: (get().trash ?? []).filter((x) => !ids.includes(x.task.id)) });
      void announceChange();
      scheduleSync();
    },

    async addList(name, parentId = null) {
      const { lists } = get();
      const now = Date.now();
      const list: List = {
        id: uid(),
        name,
        color: colorForNew(defaultPalette(get().settings), lists.length),
        parent_id: parentId,
        position: nextPos(lists),
        view_mode: "list",
        group_by: "section",
        sort_by: "manual",
        collapsed: 0,
        updated_at: now,
        deleted: 0,
      };
      const saved = await save("lists", list);
      set({ lists: [...get().lists, saved] });
      return saved;
    },

    async updateList(id, patch) {
      const cur = get().lists.find((l) => l.id === id);
      if (!cur) return;
      // A list cannot become its own descendant.
      if (patch.parent_id && listWithDescendants(get().lists, id).includes(patch.parent_id)) return;
      // Under a list on another server: the list (with all it holds) moves to that server.
      const parentOrigin = patch.parent_id ? get().lists.find((l) => l.id === patch.parent_id)?.origin : undefined;
      if (parentOrigin !== undefined && parentOrigin !== (cur.origin ?? "")) {
        const moved = await moveListTree(id, parentOrigin, patch.parent_id!);
        const { parent_id: _p, ...rest } = patch;
        if (Object.keys(rest).length) await get().updateList(moved, rest);
        return;
      }
      const next = { ...cur, ...patch };
      set({ lists: replace(get().lists, next) });
      const saved = await save("lists", next);
      stamp(next, saved.updated_at);
    },

    async deleteList(id) {
      const ids = listWithDescendants(get().lists, id);
      const taskIds = get().tasks.filter((t) => t.list_id && ids.includes(t.list_id)).map((t) => t.id);
      const sectionIds = get().sections.filter((s) => ids.includes(s.list_id)).map((s) => s.id);
      const view = get().view;
      set({
        lists: get().lists.filter((l) => !ids.includes(l.id)),
        sections: get().sections.filter((s) => !sectionIds.includes(s.id)),
        tasks: get().tasks.filter((t) => !taskIds.includes(t.id)),
        view: view.kind === "list" && ids.includes(view.id) ? { kind: "smart", id: "today" } : view,
        selectedId: null,
      });
      for (const x of taskIds) await remove(db, "tasks", x);
      for (const x of sectionIds) await remove(db, "sections", x);
      for (const x of ids) await remove(db, "lists", x);
      void announceChange();
      scheduleSync();
    },

    async addSection(listId, name) {
      const now = Date.now();
      const section: Section = {
        id: uid(),
        list_id: listId,
        name,
        position: nextPos(get().sections),
        updated_at: now,
        deleted: 0,
      };
      const saved = await save("sections", section);
      set({ sections: [...get().sections, saved] });
      return saved;
    },

    async updateSection(id, patch) {
      const cur = get().sections.find((s) => s.id === id);
      if (!cur) return;
      const saved = await save("sections", { ...cur, ...patch });
      set({ sections: replace(get().sections, saved) });
    },

    async deleteSection(id) {
      // Tasks stay in the list and fall back to "No Section".
      for (const t of get().tasks.filter((x) => x.section_id === id)) await get().updateTask(t.id, { section_id: null });
      set({ sections: get().sections.filter((s) => s.id !== id) });
      await remove(db, "sections", id);
      void announceChange();
      scheduleSync();
    },

    prefs(view) {
      return computePrefs(view, get().lists, get().settings);
    },

    setDropHint(hint) {
      const cur = get().dropHint;
      if (cur === hint || (cur && hint && cur.group === hint.group && cur.before === hint.before && (cur.y === hint.y || (cur.y !== null && hint.y !== null && Math.abs(cur.y - hint.y) < 0.5)))) return;
      set({ dropHint: hint });
    },

    async dropTask(view, sort, group, taskId, index) {
      set({ dropHint: null });
      const task = get().tasks.find((t) => t.id === taskId);
      if (!task) return;
      const ids = group.tasks.map((t) => t.id);
      const inGroup = ids.includes(taskId);
      if (!inGroup) {
        // Into another group: take on what the group stands for (section,
        // date, priority, list). Groups like "Overdue" take nothing.
        if (!Object.keys(group.patch).length) return;
        await get().updateTask(taskId, group.patch);
      }
      const order = moveInOrder(ids, taskId, index);
      if (inGroup && order.every((id, i) => id === ids[i])) return;
      if (sort === "manual") {
        const byId = new Map(get().tasks.map((t) => [t.id, t]));
        const tasks = order.map((id) => byId.get(id)).filter((t): t is Task => !!t);
        for (const p of positionsFor(tasks, taskId)) await get().updateTask(p.id, { position: p.position });
        return;
      }
      const key = orderKey(viewKey(view), sort);
      const alive = new Set(get().tasks.filter((t) => t.status === 0).map((t) => t.id));
      const value = JSON.stringify(ranksFor(order, parseRanks(get().settings[key]), alive));
      set({ settings: { ...get().settings, [key]: value } });
      await save("settings", { id: key, value, updated_at: 0, deleted: 0 } as Setting);
    },

    hasCustomOrder(view, sort) {
      return Object.keys(parseRanks(get().settings[orderKey(viewKey(view), sort)])).length > 0;
    },

    async clearCustomOrder(view, sort) {
      const key = orderKey(viewKey(view), sort);
      set({ settings: { ...get().settings, [key]: "" } });
      await save("settings", { id: key, value: "", updated_at: 0, deleted: 0 } as Setting);
    },

    async setPrefs(view, patch) {
      if (view.kind === "list") return get().updateList(view.id, patch);
      if (view.kind !== "smart") return;
      const key = `view:${view.id}`;
      const value = JSON.stringify({ ...get().prefs(view), ...patch });
      set({ settings: { ...get().settings, [key]: value } });
      await save("settings", { id: key, value, updated_at: 0, deleted: 0 } as Setting);
    },

    async addServer({ name, url, token }) {
      const server: SyncServer = { id: uid(), name: name.trim() || hostName(url), url, token, enabled: true };
      const first = get().servers.length === 0;
      // The first server takes what was on this device (as before); a further one only brings its own lists.
      if (first) {
        await assignOrigin(db, "", server.id);
        await setDefaultServer(db, server.id);
        set({ defaultServer: server.id });
      }
      await storeServers([...get().servers, server]);
      await resetServer(db, server.id);
      await get().reload();
      await get().syncNow();
    },

    async updateServer(id, patch) {
      const cur = get().servers.find((x) => x.id === id);
      if (!cur) return;
      const next = { ...cur, ...patch };
      await storeServers(get().servers.map((x) => (x.id === id ? next : x)));
      // A new address has not seen this device's lists of it: start over and send them all.
      if (patch.url !== undefined && patch.url.trim().replace(/\/+$/, "") !== cur.url) await resetServer(db, id);
      if (patch.enabled !== undefined && patch.enabled !== cur.enabled) {
        await get().reload();
        // Hidden lists cannot stay open.
        const { view, lists } = get();
        if (view.kind === "list" && !lists.some((l) => l.id === view.id)) get().setView({ kind: "smart", id: "today" });
      }
      set({ sync: sumUp() });
      if (next.enabled && (patch.url !== undefined || patch.token !== undefined || patch.enabled)) await get().syncNow();
    },

    async removeServer(id) {
      const rest = get().servers.filter((x) => x.id !== id);
      if (rest.length) await purgeOrigin(db, id);
      else await assignOrigin(db, id, "");
      if (get().defaultServer === id) {
        await setDefaultServer(db, rest[0]?.id ?? "");
        set({ defaultServer: rest[0]?.id ?? "" });
      }
      const { [id]: _gone, ...serverSync } = get().serverSync;
      set({ serverSync });
      await storeServers(rest);
      await setMeta(db, `sync_cursor:${id}`, "0");
      await get().reload();
      set({ sync: sumUp() });
    },

    async setDefaultServer(id) {
      await setDefaultServer(db, id);
      set({ defaultServer: id });
    },

    async moveListToServer(listId, serverId, parentId = null) {
      const cur = get().lists.find((l) => l.id === listId);
      if (!cur || (cur.origin ?? "") === serverId) return;
      await moveListTree(listId, serverId, parentId);
    },

    async syncNow() {
      const on = get().servers.filter((x) => x.enabled);
      if (!on.length || syncing) {
        if (!on.length) set({ sync: { status: "off" } });
        return;
      }
      syncing = true;
      set({ sync: { ...get().sync, status: "syncing", message: undefined } });
      try {
        let pulled = 0;
        for (const server of on) pulled += await syncServer(server);
        if (pulled > 0) {
          await get().reload();
          void announceChange();
        }
      } finally {
        syncing = false;
        set({ sync: sumUp() });
      }
    },

    async widgetState() {
      // Positions first: data read after them is at least as new (a widget then pulls a row twice, never misses one).
      const on = get().servers.filter((x) => x.enabled);
      const cursors = await Promise.all(on.map((x) => getMeta(db, `sync_cursor:${x.id}`)));
      const { lists, sections, tasks, settings, serverSync } = get();
      const open = new Set(tasks.filter((t) => t.status === 0 && !t.parent_id).map((t) => t.id));
      return {
        v: 1,
        at: Date.now(),
        synced: on.length ? Math.min(...on.map((x) => serverSync[x.id]?.last ?? 0)) : 0,
        servers: on.map((x, i) => ({ id: x.id, url: x.url, token: x.token, cursor: Number(cursors[i] ?? 0) || 0 })),
        lists,
        sections,
        // Open tasks and all their subtasks (a repeating task's done copy takes its checklist along).
        tasks: tasks.filter((t) => (t.parent_id ? open.has(t.parent_id) : t.status === 0)),
        settings,
      };
    },

    async adoptWidgetChanges(changes) {
      if (!changes.length || !(await adoptRows(db, changes))) return;
      await get().reload();
      void announceChange();
      scheduleSync(300);
    },
  };
});
