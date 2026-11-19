import { create } from "zustand";
import { openDb, type Db } from "./db/driver";
import { getMeta, loadAll, migrate, put, remove, setMeta, uid } from "./db/repo";
import { getSyncConfig, setSyncConfig, syncOnce, type SyncConfig } from "./db/sync";
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
import {
  SMART_DEFAULTS,
  listVisibility,
  listWithDescendants,
  type Group,
  type SmartId,
  type ViewPrefs,
  type ViewRef,
  type VisibilityKey,
} from "./lib/views";
import type { EntityName, List, Row, Section, Setting, SortBy, Task } from "./shared/schema";

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

export const LIST_COLORS = ["#7c8794", "#5b8def", "#3fa796", "#c9a227", "#d9773d", "#c8553d", "#9a6bd1", "#5f9e5a"];

export type Theme = "system" | "light" | "dark";

export interface SyncState {
  status: "off" | "idle" | "syncing" | "error";
  message?: string;
  last?: number;
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
export type CalMode = "month" | "week" | "multiweek";

/** Default highlight: brushed silver. */
export const DEFAULT_HIGHLIGHT = "#b4b9bf";

export const SIDEBAR_DEFAULT = 262;

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
  undo: { ids: string[] } | null;
  /** Tasks whose subtasks are folded away in lists and on the board (kept on this device). */
  folded: Record<string, true>;
  /** Select mode: the selected task ids (null: not selecting). */
  selecting: string[] | null;
  sidebarOpen: boolean;
  sidebarWidth: number;
  /** Narrow windows: the list sidebar slides over the content. */
  drawerOpen: boolean;
  highlight: string;
  shortcuts: Shortcuts;
  calMode: CalMode;
  /** Rows shown in the multi-week calendar. */
  calWeeks: number;
  /** Month or Multi-Week, whichever was chosen last (the target of the M shortcut). */
  calMonthLike: "month" | "multiweek";
  /** Bumped to make the calendar jump to today. */
  calTodayTick: number;
  /** This window shows only one view layer (opened from the title bar). */
  detached: "tasks" | "calendar" | null;
  version: string;
  update: UpdateState;
  theme: Theme;
  shortcut: string;
  shortcutError: string | null;
  syncConfig: SyncConfig | null;
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
  setSelecting(ids: string[] | null): void;
  toggleSelected(id: string): void;
  setShowDetails(v: boolean): Promise<void>;
  setSidebarOpen(v: boolean): void;
  setSidebarWidth(px: number, save?: boolean): void;
  setDrawerOpen(v: boolean): void;
  setHighlight(color: string): Promise<void>;
  setShortcuts(s: Shortcuts): Promise<void>;
  setCalMode(m: CalMode): void;
  setCalWeeks(n: number): void;
  goCalToday(): void;
  editMode(view: ViewRef): EditMode;
  setEditMode(view: ViewRef, mode: EditMode): Promise<void>;
  setListVisibility(listId: string, key: VisibilityKey, shown: boolean): Promise<void>;
  checkUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  duplicateTask(id: string): Promise<void>;
  setWontDo(id: string): Promise<void>;
  setTheme(t: Theme): Promise<void>;
  setShortcut(s: string): Promise<void>;

  addTask(patch: Partial<Task> & { title: string }): Promise<Task>;
  updateTask(id: string, patch: Partial<Task>): Promise<void>;
  /** Shows a change while it is being dragged, without saving it. */
  previewTask(id: string, patch: Partial<Task>): void;
  /** Completes (or reopens) a task. `quiet`: no lingering and no undo (the parent's editor shows it anyway). */
  toggleTask(id: string, opts?: { quiet?: boolean }): Promise<void>;
  /** Completes open tasks (and their open subtasks) as one step the undo button takes back. */
  completeTasks(ids: string[], opts?: { quiet?: boolean }): Promise<void>;
  deleteTask(id: string): Promise<void>;

  addList(name: string, parentId?: string | null): Promise<List>;
  updateList(id: string, patch: Partial<List>): Promise<void>;
  deleteList(id: string): Promise<void>;

  addSection(listId: string, name: string): Promise<Section>;
  updateSection(id: string, patch: Partial<Section>): Promise<void>;
  deleteSection(id: string): Promise<void>;

  prefs(view: ViewRef): ViewPrefs;
  setPrefs(view: ViewRef, patch: Partial<ViewPrefs>): Promise<void>;

  saveSyncConfig(cfg: SyncConfig | null): Promise<void>;
  syncNow(): Promise<void>;
}

/** View mode, grouping and sorting for a view: stored on the list, or in settings for smart views. */
export function computePrefs(view: ViewRef, lists: List[], settings: Record<string, string>): ViewPrefs {
  if (view.kind === "list") {
    const l = lists.find((x) => x.id === view.id);
    if (l) return { view_mode: l.view_mode, group_by: l.group_by, sort_by: l.sort_by };
  }
  const id: SmartId = view.kind === "smart" ? view.id : "all";
  const base = SMART_DEFAULTS[id];
  try {
    const raw = settings[`view:${id}`];
    return raw ? { ...base, ...(JSON.parse(raw) as Partial<ViewPrefs>) } : base;
  } catch {
    return base;
  }
}

export interface ImportResult {
  lists: number;
  sections: number;
  tasks: number;
  /** Rows that were already there (and not older). */
  skipped: number;
  notes?: { repeating: number; tags: string[]; reminders: number };
}

let db: Db;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncing = false;
let foundUpdate: FoundUpdate | null = null;

const nextPos = (rows: { position: number }[]) => rows.reduce((m, r) => Math.max(m, r.position), 0) + 1;

export const useStore = create<State>((set, get) => {
  /** Writes a row locally, mirrors it in memory, and queues a sync. */
  async function save<T extends { id: string }>(name: EntityName, row: T): Promise<T> {
    const saved = (await put(db, name, row as unknown as Row)) as unknown as T;
    void announceChange();
    scheduleSync();
    return saved;
  }

  function scheduleSync(delay = 1500) {
    if (!get().syncConfig) return;
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
        await put(db, name, { ...row, deleted: 0 });
        if (name !== "settings") res[name]++;
      }
    }
    await get().reload();
    void announceChange();
    scheduleSync(300);
    return res;
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
    highlight: DEFAULT_HIGHLIGHT,
    shortcuts: parseShortcuts(null),
    calMode: "month",
    calWeeks: 4,
    calMonthLike: "month",
    calTodayTick: 0,
    detached: detachedLayer(),
    version: "",
    update: { status: "idle" },
    theme: "system",
    shortcut: DEFAULT_SHORTCUT,
    shortcutError: null,
    syncConfig: null,
    sync: { status: "off" },

    async init() {
      try {
        db = await openDb();
        await migrate(db);
        const theme = ((await getMeta(db, "theme")) as Theme | null) ?? "system";
        const shortcut = (await getMeta(db, "quickadd_shortcut")) ?? DEFAULT_SHORTCUT;
        const syncConfig = await getSyncConfig(db);
        const showDetails = (await getMeta(db, "show_details")) !== "0";
        const highlight = (await getMeta(db, "highlight")) || DEFAULT_HIGHLIGHT;
        const sidebarWidth = Number(await getMeta(db, "sidebar_width")) || SIDEBAR_DEFAULT;
        const shortcuts = parseShortcuts(await getMeta(db, "shortcuts"));
        const calMode = ((await getMeta(db, "cal_mode")) as CalMode | null) ?? "month";
        const calWeeks = Math.max(2, Math.min(6, Number(await getMeta(db, "cal_weeks")) || 4));
        const calMonthLike = (await getMeta(db, "cal_month_like")) === "multiweek" ? "multiweek" : "month";
        set({ calWeeks, calMonthLike });
        set({ theme, shortcut, syncConfig, showDetails, highlight, sidebarWidth, shortcuts, calMode, sync: { status: syncConfig ? "idle" : "off" } });
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
      const r = readTickTick(text, { lists: get().lists }, { includeCompleted, colors: LIST_COLORS });
      const res = await writeImport({ lists: r.lists as unknown as Row[], sections: r.sections as unknown as Row[], tasks: r.tasks as unknown as Row[] }, "missing");
      return { ...res, notes: r.notes };
    },

    async reload() {
      const [lists, sections, tasks, settingRows] = await Promise.all([
        loadAll<List>(db, "lists"),
        loadAll<Section>(db, "sections"),
        loadAll<Task>(db, "tasks"),
        loadAll<Setting>(db, "settings"),
      ]);
      const settings: Record<string, string> = {};
      for (const s of settingRows) settings[s.id] = s.value;
      set({ lists, sections, tasks, settings });
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
    setSelecting(ids) {
      set({ selecting: ids, ...(ids ? { selectedId: null, anchor: null } : {}) });
    },
    toggleSelected(id) {
      const cur = get().selecting;
      if (!cur) return;
      set({ selecting: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    },
    select(id, anchor = null) {
      set({ selectedId: id, anchor: id ? anchor : null, composer: null, focusSubtask: false });
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
    async setHighlight(color) {
      set({ highlight: color });
      await setMeta(db, "highlight", color);
    },
    async setShortcuts(shortcuts) {
      set({ shortcuts });
      await setMeta(db, "shortcuts", JSON.stringify(shortcuts));
    },
    setCalMode(calMode) {
      set({ calMode });
      void setMeta(db, "cal_mode", calMode);
      if (calMode !== "week") {
        set({ calMonthLike: calMode });
        void setMeta(db, "cal_month_like", calMode);
      }
    },
    setCalWeeks(n) {
      const calWeeks = Math.max(2, Math.min(6, n));
      set({ calWeeks });
      void setMeta(db, "cal_weeks", String(calWeeks));
    },
    goCalToday() {
      set({ calTodayTick: get().calTodayTick + 1 });
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
        ...patch,
      };
      const saved = await save("tasks", task);
      set({ tasks: [...get().tasks, saved] });
      return saved;
    },

    async updateTask(id, patch) {
      const cur = get().tasks.find((t) => t.id === id);
      if (!cur) return;
      const next = { ...cur, ...patch };
      // Moving to another list drops a section that does not belong there.
      if (patch.list_id !== undefined && patch.list_id !== cur.list_id && patch.section_id === undefined) {
        next.section_id = null;
      }
      set({ tasks: replace(get().tasks, next) });
      const saved = await save("tasks", next);
      // Only take the timestamp back: a newer edit may already be in memory.
      set({ tasks: get().tasks.map((t) => (t.id === id ? { ...t, updated_at: saved.updated_at } : t)) });
      // Subtasks follow their parent into another list.
      if (next.list_id !== cur.list_id) {
        for (const child of get().tasks.filter((t) => t.parent_id === id)) {
          await get().updateTask(child.id, { list_id: next.list_id, section_id: null });
        }
      }
    },

    previewTask(id, patch) {
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
      // Open subtasks are done with their parent.
      const all = [...new Set(open.flatMap((id) => [id, ...tasks.filter((t) => t.parent_id === id && t.status === 0).map((t) => t.id)]))];
      haptic("success");
      if (!opts.quiet) {
        // Struck through where they are for a moment, then gone; the undo button stays until the view changes.
        set({ lingering: { ...get().lingering, ...Object.fromEntries(all.map((x) => [x, true as const])) }, undo: { ids: all } });
        setTimeout(() => {
          const l = { ...get().lingering };
          for (const x of all) delete l[x];
          set({ lingering: l });
        }, LINGER_MS);
      }
      const at = Date.now();
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

    async addList(name, parentId = null) {
      const { lists } = get();
      const now = Date.now();
      const list: List = {
        id: uid(),
        name,
        color: LIST_COLORS[lists.length % LIST_COLORS.length],
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
      const next = { ...cur, ...patch };
      set({ lists: replace(get().lists, next) });
      const saved = await save("lists", next);
      set({ lists: get().lists.map((l) => (l.id === id ? { ...l, updated_at: saved.updated_at } : l)) });
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

    async saveSyncConfig(cfg) {
      if (cfg && cfg.url.trim()) {
        await setSyncConfig(db, cfg);
        const stored = await getSyncConfig(db);
        set({ syncConfig: stored, sync: { status: "idle" } });
        await get().syncNow();
      } else {
        await setMeta(db, "sync_url", "");
        await setMeta(db, "sync_token", "");
        set({ syncConfig: null, sync: { status: "off" } });
      }
    },

    async syncNow() {
      const cfg = get().syncConfig;
      if (!cfg || syncing) return;
      syncing = true;
      set({ sync: { ...get().sync, status: "syncing", message: undefined } });
      try {
        const r = await syncOnce(db, cfg);
        if (r.pulled > 0) {
          await get().reload();
          void announceChange();
        }
        set({ sync: { status: "idle", last: Date.now() } });
      } catch (e) {
        set({ sync: { status: "error", message: e instanceof Error ? e.message : String(e), last: get().sync.last } });
      } finally {
        syncing = false;
      }
    },
  };
});
