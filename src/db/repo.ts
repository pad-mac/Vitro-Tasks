import type { Db, Param } from "./driver";
import {
  ENTITY_NAMES,
  colNames,
  sqliteDdl,
  withDefaults,
  type ChangeSet,
  type EntityName,
  type Row,
} from "../shared/schema";

export function uid(): string {
  return crypto.randomUUID();
}

/** Creates tables and adds any columns introduced by a newer app version. */
export async function migrate(db: Db): Promise<void> {
  const ddl = sqliteDdl();
  for (const stmt of ddl.filter((s) => s.startsWith("CREATE TABLE"))) await db.exec(stmt);
  for (const name of ENTITY_NAMES) {
    const have = new Set((await db.all<{ name: string }>(`PRAGMA table_info(${name})`)).map((r) => r.name));
    const create = ddl.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${name} `))!;
    const defs = create.slice(create.indexOf("(") + 1, create.lastIndexOf(")")).split(", ");
    for (const def of defs) {
      const col = def.split(" ")[0];
      if (!have.has(col)) await db.exec(`ALTER TABLE ${name} ADD COLUMN ${def}`);
    }
  }
  // Indexes last: they may reference columns that were just added.
  for (const stmt of ddl.filter((s) => !s.startsWith("CREATE TABLE"))) await db.exec(stmt);
}

/** Every live row, with the server it lives on (`origin`). */
export async function loadAll<T>(db: Db, name: EntityName): Promise<T[]> {
  return db.all<T>(`SELECT ${colNames(name).join(", ")}, origin FROM ${name} WHERE deleted = 0`);
}

/** Tasks in the trash (deleted, not yet deleted forever), with their server. */
export async function loadDeletedTasks<T>(db: Db): Promise<T[]> {
  return db.all<T>(`SELECT ${colNames("tasks").join(", ")}, origin FROM tasks WHERE deleted = 1`);
}

/**
 * Deletes a task forever: it leaves the trash on every device (deleted = 2) and its text is
 * cleared, so nothing of it is kept anywhere. The row itself stays, so the deletion still travels.
 */
export async function purgeTask(db: Db, id: string, now = Date.now()): Promise<void> {
  await db.exec(`UPDATE tasks SET deleted = 2, title = '', notes = '', dirty = 1, updated_at = MAX($1, updated_at + 1) WHERE id = $2`, [now, id]);
}

/** `keep`: columns written for a new row but left as they are on an existing one. */
function upsertSql(name: EntityName, extra: string[], keep: string[] = []): { sql: string; cols: string[] } {
  const cols = [...colNames(name), ...extra];
  const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
  const set = cols
    .filter((c) => c !== "id" && !keep.includes(c))
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  return {
    cols,
    sql: `INSERT INTO ${name} (${cols.join(", ")}) VALUES (${ph}) ON CONFLICT(id) DO UPDATE SET ${set}`,
  };
}

/** Local write: stamps the row and marks it for upload. */
export async function put(db: Db, name: EntityName, row: Row, now = Date.now()): Promise<Row> {
  // Never stamp older than the stored version, even if this device's clock is behind.
  const prev = await db.all<{ updated_at: number }>(`SELECT updated_at FROM ${name} WHERE id = $1`, [
    row.id as string,
  ]);
  const ts = prev.length ? Math.max(now, prev[0].updated_at + 1) : now;
  const stamped: Row = { ...withDefaults(name, row), updated_at: ts };
  // The server a row lives on is set when it is created and never changed by a write
  // (a row that moves to another server is copied there: see the store).
  const withOrigin = typeof row.origin === "string";
  const { sql, cols } = upsertSql(name, withOrigin ? ["dirty", "origin"] : ["dirty"], ["origin"]);
  await db.exec(
    sql,
    cols.map((c) => (c === "dirty" ? 1 : ((stamped[c] ?? null) as Param))),
  );
  return stamped;
}

/** Soft delete so the deletion can travel to other devices. */
export async function remove(db: Db, name: EntityName, id: string, now = Date.now()): Promise<void> {
  await db.exec(`UPDATE ${name} SET deleted = 1, dirty = 1, updated_at = MAX($1, updated_at + 1) WHERE id = $2`, [now, id]);
}

export async function getMeta(db: Db, key: string): Promise<string | null> {
  const r = await db.all<{ value: string }>("SELECT value FROM meta WHERE key = $1", [key]);
  return r.length ? r[0].value : null;
}

export async function setMeta(db: Db, key: string, value: string): Promise<void> {
  await db.exec(
    "INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

// ---------- Sync helpers ----------

/** Unsent rows of one server (only what that server keeps; `origin` itself is not sent). */
export async function collectDirty(db: Db, origin = ""): Promise<ChangeSet> {
  const out: ChangeSet = {};
  for (const name of ENTITY_NAMES) {
    const rows = await db.all<Row>(`SELECT ${colNames(name).join(", ")} FROM ${name} WHERE dirty = 1 AND origin = $1`, [origin]);
    if (rows.length) out[name] = rows;
  }
  return out;
}

/** Moves every row of one server to another (the first server set up takes what was local). */
export async function assignOrigin(db: Db, from: string, to: string): Promise<void> {
  for (const name of ENTITY_NAMES) await db.exec(`UPDATE ${name} SET origin = $1 WHERE origin = $2`, [to, from]);
}

/** Forgets a server's rows on this device (they stay on the server). */
export async function purgeOrigin(db: Db, origin: string): Promise<void> {
  for (const name of ENTITY_NAMES) await db.exec(`DELETE FROM ${name} WHERE origin = $1`, [origin]);
}

/** Marks a server's rows for upload again (a server that has not seen them yet). */
export async function markOriginDirty(db: Db, origin: string): Promise<void> {
  for (const name of ENTITY_NAMES) await db.exec(`UPDATE ${name} SET dirty = 1 WHERE origin = $1`, [origin]);
}


/**
 * Rows that carry a value in fields an older server dropped, as they are now.
 * Read before a pull that may clear them, and sent again once the server keeps
 * them (sendAgain).
 */
export async function valuesIn(db: Db, origin: string, fields: string[]): Promise<{ id: string; values: Row }[]> {
  if (!fields.length) return [];
  const rows = await db.all<Row>(
    `SELECT id, ${fields.join(", ")} FROM tasks WHERE origin = $1 AND (${fields.map((f) => `(${f} IS NOT NULL AND ${f} <> '')`).join(" OR ")})`,
    [origin],
  );
  return rows.map(({ id, ...values }) => ({ id: id as string, values }));
}

/**
 * Puts those values back where a pull cleared them, and marks the rows newer
 * than any version anywhere, so the server takes them (the same version again
 * would be ignored as old).
 */
export async function sendAgain(db: Db, kept: { id: string; values: Row }[], now = Date.now()): Promise<void> {
  for (const { id, values } of kept) {
    const fields = Object.keys(values);
    // Placeholders once each and in order (see driver).
    await db.exec(
      `UPDATE tasks SET ${fields.map((f, i) => `${f} = COALESCE(NULLIF(${f}, ''), $${i + 1})`).join(", ")}, updated_at = MAX($${fields.length + 1}, updated_at + 1), dirty = 1 WHERE id = $${fields.length + 2}`,
      [...fields.map((f) => values[f] as Param), now, id],
    );
  }
}

/** Clears the dirty flag for rows that were uploaded and not edited since. */
export async function markClean(db: Db, pushed: ChangeSet): Promise<void> {
  for (const name of ENTITY_NAMES) {
    for (const row of pushed[name] ?? []) {
      await db.exec(`UPDATE ${name} SET dirty = 0 WHERE id = $1 AND updated_at = $2`, [
        row.id as string,
        row.updated_at as number,
      ]);
    }
  }
}

/**
 * Applies rows from the server. Last write wins: a remote row replaces the
 * local one unless the local copy is newer or has unsent edits of the same age.
 * Returns how many rows changed locally.
 */
export async function applyRemote(db: Db, changes: ChangeSet, origin = ""): Promise<number> {
  let applied = 0;
  for (const name of ENTITY_NAMES) {
    for (const row of changes[name] ?? []) {
      // A row new to this device lives on the server it came from; a known row
      // keeps its server, and every field the incoming row does not carry (an
      // older server has no column for it): absent is not cleared.
      const absent = colNames(name).filter((c) => !(c in row));
      const { sql, cols } = upsertSql(name, ["dirty", "origin"], ["origin", ...absent]);
      const local = await db.all<{ updated_at: number; dirty: number }>(
        `SELECT updated_at, dirty FROM ${name} WHERE id = $1`,
        [row.id as string],
      );
      const remoteTs = Number(row.updated_at);
      if (local.length) {
        const l = local[0];
        if (l.updated_at > remoteTs) continue;
        if (l.updated_at === remoteTs) continue; // same version (or our own echo)
      }
      const full = withDefaults(name, row);
      await db.exec(
        sql,
        cols.map((c) => (c === "dirty" ? 0 : c === "origin" ? origin : ((full[c] ?? null) as Param))),
      );
      applied++;
    }
  }
  return applied;
}

/** A row changed in a home screen widget (src/widget/core.ts). */
export interface AdoptedChange {
  entity: EntityName;
  row: Row;
  origin: string;
  /** The widget sent it to its server already (the next sync brings nothing new then). */
  pushed: boolean;
}

/**
 * Takes over rows changed in a widget as they are, version and all: only
 * where newer than the local row, so a row that also comes from the server
 * lands once. What the widget could not send goes up with the next sync.
 */
export async function adoptRows(db: Db, changes: AdoptedChange[]): Promise<number> {
  let adopted = 0;
  for (const c of changes) {
    if (!ENTITY_NAMES.includes(c.entity) || typeof c.row?.id !== "string") continue;
    const local = await db.all<{ updated_at: number }>(`SELECT updated_at FROM ${c.entity} WHERE id = $1`, [c.row.id]);
    if (local.length && local[0].updated_at >= Number(c.row.updated_at)) continue;
    const { sql, cols } = upsertSql(c.entity, ["dirty", "origin"], ["origin"]);
    const full = withDefaults(c.entity, c.row);
    await db.exec(
      sql,
      cols.map((col) => (col === "dirty" ? (c.pushed ? 0 : 1) : col === "origin" ? c.origin : ((full[col] ?? null) as Param))),
    );
    adopted++;
  }
  return adopted;
}
