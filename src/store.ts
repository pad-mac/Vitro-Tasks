import { create } from "zustand";
import { openDb, type Db } from "./db/driver";
import { getMeta, loadAll, migrate, put, remove, setMeta, uid } from "./db/repo";
import { getSyncConfig, setSyncConfig, syncOnce, type SyncConfig } from "./db/sync";
import { announceChange, DEFAULT_SHORTCUT, onRemoteChange, setQuickAddShortcut } from "./lib/platform";
import {
  SMART_DEFAULTS,
  listWithDescendants,
  type SmartId,
  type ViewPrefs,
  type ViewRef,
} from "./lib/views";
import type { EntityName, List, Row, Section, Setting, Task } from "./shared/schema";

export const LIST_COLORS = ["#7c8794", "#5b8def", "#3fa796", "#c9a227", "#d9773d", "#c8553d", "#9a6bd1", "#5f9e5a"];

export type Theme = "system" | "light" | "dark";

export interface SyncState {
  status: "off" | "idle" | "syncing" | "error";
  message?: string;
  last?: number;
}

interface State {
  ready: boolean;
  fatal: string | null;
  lists: List[];
  sections: Section[];
  tasks: Task[];
  settings: Record<string, string>;
  view: ViewRef;
  selectedId: string | null;
  showCompleted: boolean;
  theme: Theme;
  shortcut: string;
  shortcutError: string | null;
  syncConfig: SyncConfig | null;
  sync: SyncState;

  init(): Promise<void>;
  reload(): Promise<void>;
  setView(view: ViewRef): void;
  select(id: string | null): void;
  setShowCompleted(v: boolean): void;
  setTheme(t: Theme): Promise<void>;
  setShortcut(s: string): Promise<void>;

  addTask(patch: Partial<Task> & { title: string }): Promise<Task>;
  updateTask(id: string, patch: Partial<Task>): Promise<void>;
  toggleTask(id: string): Promise<void>;
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

let db: Db;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncing = false;

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
    selectedId: null,
    showCompleted: false,
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
        set({ theme, shortcut, syncConfig, sync: { status: syncConfig ? "idle" : "off" } });
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
      set({ view, selectedId: null });
    },
    select(id) {
      set({ selectedId: id });
    },
    setShowCompleted(v) {
      set({ showCompleted: v });
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

    async toggleTask(id) {
      const cur = get().tasks.find((t) => t.id === id);
      if (!cur) return;
      const done = cur.status === 0;
      await get().updateTask(id, { status: done ? 1 : 0, completed_at: done ? Date.now() : null });
      if (done) {
        for (const child of get().tasks.filter((t) => t.parent_id === id && t.status === 0)) {
          await get().updateTask(child.id, { status: 1, completed_at: Date.now() });
        }
      }
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
