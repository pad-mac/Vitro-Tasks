// Single source of truth for the data model.
// The desktop app (SQLite) and the sync server (Postgres) both generate their
// tables from this file, so a future mobile client only has to follow it too.

export type ColType = "text" | "int" | "real";

export interface Col {
  name: string;
  type: ColType;
  /** SQL literal used as default, e.g. "0" or "''". Omit for nullable columns. */
  def?: string;
}

export interface Entity {
  name: EntityName;
  cols: Col[];
}

export type EntityName = "lists" | "sections" | "tasks" | "settings";

/** Columns every synced row carries. */
export const SYNC_COLS: Col[] = [
  { name: "updated_at", type: "int", def: "0" },
  { name: "deleted", type: "int", def: "0" },
];

export const ENTITIES: Entity[] = [
  {
    name: "lists",
    cols: [
      { name: "name", type: "text", def: "''" },
      { name: "color", type: "text", def: "''" },
      // A list with a parent is a sublist; nesting depth is not limited.
      { name: "parent_id", type: "text" },
      { name: "position", type: "real", def: "0" },
      { name: "view_mode", type: "text", def: "'list'" },
      { name: "group_by", type: "text", def: "'section'" },
      { name: "sort_by", type: "text", def: "'manual'" },
      { name: "collapsed", type: "int", def: "0" },
    ],
  },
  {
    name: "sections",
    cols: [
      { name: "list_id", type: "text", def: "''" },
      { name: "name", type: "text", def: "''" },
      { name: "position", type: "real", def: "0" },
    ],
  },
  {
    name: "tasks",
    cols: [
      // null list_id = Inbox
      { name: "list_id", type: "text" },
      { name: "section_id", type: "text" },
      { name: "parent_id", type: "text" },
      { name: "title", type: "text", def: "''" },
      { name: "notes", type: "text", def: "''" },
      // 0 none, 1 low, 2 medium, 3 high
      { name: "priority", type: "int", def: "0" },
      // 0 open, 1 done
      { name: "status", type: "int", def: "0" },
      // Planned date: when you intend to work on it. Dates are floating local
      // values (YYYY-MM-DD / HH:mm) so they mean the same on every device.
      { name: "start_date", type: "text" },
      { name: "start_time", type: "text" },
      { name: "end_date", type: "text" },
      { name: "end_time", type: "text" },
      // Hard deadline: when it must be done. Independent of the planned date.
      { name: "deadline_date", type: "text" },
      { name: "deadline_time", type: "text" },
      { name: "completed_at", type: "int" },
      { name: "position", type: "real", def: "0" },
      { name: "pinned", type: "int", def: "0" },
      { name: "created_at", type: "int", def: "0" },
    ],
  },
  {
    // Synced key/value settings (id is the key), e.g. view preferences.
    name: "settings",
    cols: [{ name: "value", type: "text", def: "''" }],
  },
];

export const ENTITY_NAMES = ENTITIES.map((e) => e.name);

export function entity(name: EntityName): Entity {
  const e = ENTITIES.find((x) => x.name === name);
  if (!e) throw new Error(`unknown entity ${name}`);
  return e;
}

/** Column names of a synced row, in a stable order (id first). */
export function colNames(name: EntityName): string[] {
  return ["id", ...entity(name).cols.map((c) => c.name), ...SYNC_COLS.map((c) => c.name)];
}

/** Fills columns that are missing or null with their schema default. */
export function withDefaults(name: EntityName, row: Row): Row {
  const out: Row = { ...row };
  for (const c of [...entity(name).cols, ...SYNC_COLS]) {
    if (c.def !== undefined && (out[c.name] === undefined || out[c.name] === null)) {
      out[c.name] = c.type === "text" ? c.def.slice(1, -1) : Number(c.def);
    }
  }
  return out;
}

const SQLITE_TYPES: Record<ColType, string> = { text: "TEXT", int: "INTEGER", real: "REAL" };
const PG_TYPES: Record<ColType, string> = { text: "TEXT", int: "BIGINT", real: "DOUBLE PRECISION" };

function colDdl(c: Col, types: Record<ColType, string>): string {
  return `${c.name} ${types[c.type]}${c.def !== undefined ? ` NOT NULL DEFAULT ${c.def}` : ""}`;
}

/** Statements that create or upgrade the local SQLite schema. */
export function sqliteDdl(): string[] {
  const out: string[] = [];
  for (const e of ENTITIES) {
    const cols = [...e.cols, ...SYNC_COLS, { name: "dirty", type: "int", def: "0" } as Col];
    out.push(
      `CREATE TABLE IF NOT EXISTS ${e.name} (id TEXT PRIMARY KEY, ${cols
        .map((c) => colDdl(c, SQLITE_TYPES))
        .join(", ")})`,
    );
  }
  out.push("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')");
  out.push("CREATE INDEX IF NOT EXISTS tasks_list ON tasks (list_id)");
  return out;
}

/** Statements that create the Postgres schema on the sync server. */
export function postgresDdl(): string[] {
  const out: string[] = ["CREATE SEQUENCE IF NOT EXISTS vitro_seq"];
  for (const e of ENTITIES) {
    const cols = [...e.cols, ...SYNC_COLS];
    out.push(
      `CREATE TABLE IF NOT EXISTS ${e.name} (id TEXT PRIMARY KEY, ${cols
        .map((c) => colDdl(c, PG_TYPES))
        .join(", ")}, seq BIGINT NOT NULL DEFAULT 0)`,
    );
    // Later versions add columns here without a migration framework.
    for (const c of cols) out.push(`ALTER TABLE ${e.name} ADD COLUMN IF NOT EXISTS ${colDdl(c, PG_TYPES)}`);
    out.push(`CREATE INDEX IF NOT EXISTS ${e.name}_seq ON ${e.name} (seq)`);
  }
  return out;
}

// ---------- Row types ----------

export interface SyncMeta {
  id: string;
  updated_at: number;
  deleted: number;
}

export type ViewMode = "list" | "kanban" | "timeline";
export type GroupBy = "section" | "date" | "deadline" | "priority" | "list" | "none";
export type SortBy = "manual" | "date" | "deadline" | "priority" | "title" | "created";

export interface List extends SyncMeta {
  name: string;
  color: string;
  parent_id: string | null;
  position: number;
  view_mode: ViewMode;
  group_by: GroupBy;
  sort_by: SortBy;
  collapsed: number;
}

export interface Section extends SyncMeta {
  list_id: string;
  name: string;
  position: number;
}

export interface Task extends SyncMeta {
  list_id: string | null;
  section_id: string | null;
  parent_id: string | null;
  title: string;
  notes: string;
  priority: number;
  status: number;
  start_date: string | null;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  deadline_date: string | null;
  deadline_time: string | null;
  completed_at: number | null;
  position: number;
  pinned: number;
  created_at: number;
}

export interface Setting extends SyncMeta {
  value: string;
}

export type Row = Record<string, string | number | null>;
export type ChangeSet = Partial<Record<EntityName, Row[]>>;

export interface SyncRequest {
  since: number;
  changes: ChangeSet;
}

export interface SyncResponse {
  cursor: number;
  changes: ChangeSet;
}
