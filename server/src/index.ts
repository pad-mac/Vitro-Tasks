// Vitro Tasks sync server: Postgres + one sync endpoint.
// Config via environment: DATABASE_URL, VITRO_TOKEN, PORT (default 8787).
import http from "node:http";
import pg from "pg";
import {
  ENTITY_NAMES,
  LOCAL_COLS,
  SYNC_PROTOCOL,
  colNames,
  intCols,
  postgresDdl,
  withDefaults,
  type ChangeSet,
  type EntityName,
  type Row,
  type SyncRequest,
  type SyncResponse,
} from "../../src/shared/schema";

pg.types.setTypeParser(20, (v) => Number(v)); // BIGINT -> number

/** The release this server was built from (set in the published image). */
const VERSION = process.env.VITRO_VERSION || "dev";

export async function migrate(pool: pg.Pool): Promise<void> {
  for (const stmt of postgresDdl()) await pool.query(stmt);
}

function validRow(row: Row): boolean {
  return !!row && typeof row.id === "string" && row.id.length > 0 && row.id.length <= 200 && Number.isFinite(Number(row.updated_at));
}

/** Never stored as a row's own fields. */
const NOT_FIELDS = new Set(["seq", "extra", ...LOCAL_COLS.map((c) => c.name)]);
/** Most a row may carry in fields this server has no column for. */
const EXTRA_LIMIT = 32 * 1024;

/**
 * One row's write: a new row takes defaults for what it leaves out; a known
 * row keeps every field the incoming one leaves out (an older app does not
 * clear what a newer one set). Fields without a column go into `extra`.
 */
function rowWrite(name: EntityName, row: Row): { sql: string; params: unknown[] } {
  const cols = colNames(name);
  const known = new Set(cols);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!known.has(k) && !NOT_FIELDS.has(k) && v !== undefined) extra[k] = v;
  const extraJson = JSON.stringify(extra);
  if (extraJson.length > EXTRA_LIMIT) throw new HttpError(400, `too much in a ${name} row`);
  const present = cols.filter((c) => c !== "id" && c in row);
  const full = withDefaults(name, row);
  // Whole numbers only (BIGINT): fractions are rounded, anything else is the client's error.
  for (const c of intCols(name)) {
    const v = full[c];
    if (v === null || v === undefined) continue;
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) throw new HttpError(400, `bad number in a ${name} row: ${c}`);
    full[c] = Math.round(n);
  }
  const set = [...present.map((c) => `${c} = EXCLUDED.${c}`), `extra = ${name}.extra || EXCLUDED.extra`, "seq = EXCLUDED.seq"];
  return {
    sql:
      `INSERT INTO ${name} (${cols.join(", ")}, extra, seq) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, $${cols.length + 1}::jsonb, nextval('vitro_seq')) ` +
      `ON CONFLICT (id) DO UPDATE SET ${set.join(", ")} WHERE ${name}.updated_at < EXCLUDED.updated_at`,
    params: [...cols.map((c) => full[c] ?? null), extraJson],
  };
}

/**
 * Applies a client's changes and returns everything newer than its cursor.
 * Last write wins per row by updated_at; every accepted write gets the next
 * sequence number, which is what cursors count.
 */
export async function sync(pool: pg.Pool, req: SyncRequest): Promise<SyncResponse> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One sync at a time, so sequence order equals commit order.
    await client.query("SELECT pg_advisory_xact_lock(727274)");
    for (const name of ENTITY_NAMES) {
      for (const row of req.changes?.[name] ?? []) {
        if (!validRow(row)) throw new HttpError(400, `invalid ${name} row`);
        const { sql, params } = rowWrite(name, row);
        await client.query(sql, params);
      }
    }
    const since = Number(req.since) || 0;
    const changes: ChangeSet = {};
    let cursor = since;
    for (const name of ENTITY_NAMES) {
      const cols = colNames(name);
      const r = await client.query(`SELECT ${cols.join(", ")}, extra, seq FROM ${name} WHERE seq > $1 ORDER BY seq`, [since]);
      if (r.rows.length) {
        changes[name] = r.rows.map(({ seq, extra, ...row }) => {
          cursor = Math.max(cursor, seq);
          // Its own columns win over anything kept in extra under the same name.
          return { ...(extra ?? {}), ...row } as Row;
        });
      }
    }
    await client.query("COMMIT");
    return { cursor, changes, server: { protocol: SYNC_PROTOCOL, version: VERSION } };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function readBody(req: http.IncomingMessage, limit = 20 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, "body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createServer(pool: pg.Pool, token: string): http.Server {
  return http.createServer(async (req, res) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        return void res.end();
      }
      const path = (req.url ?? "/").split("?")[0];
      if (req.method === "GET" && path === "/v1/health") return send(200, { ok: true, version: VERSION });
      if (req.headers.authorization !== `Bearer ${token}`) throw new HttpError(401, "bad or missing token");
      if (req.method === "POST" && path === "/v1/sync") {
        let parsed: SyncRequest;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch (e) {
          if (e instanceof HttpError) throw e;
          throw new HttpError(400, "body is not valid JSON");
        }
        return send(200, await sync(pool, parsed));
      }
      throw new HttpError(404, "not found");
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      console.error(e);
      send(500, { error: "internal error" });
    }
  });
}

async function main() {
  const token = process.env.VITRO_TOKEN;
  const url = process.env.DATABASE_URL;
  if (!token || token.length < 16) throw new Error("Set VITRO_TOKEN to a secret of at least 16 characters.");
  if (!url) throw new Error("Set DATABASE_URL to a Postgres connection string.");
  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool);
  const port = Number(process.env.PORT ?? 8787);
  createServer(pool, token).listen(port, () => console.log(`vitro sync server listening on :${port}`));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop()!)) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
