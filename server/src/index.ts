// Vitro Tasks sync server: Postgres + one sync endpoint.
// Config via environment: DATABASE_URL, VITRO_TOKEN, PORT (default 8787).
import http from "node:http";
import pg from "pg";
import {
  ENTITY_NAMES,
  colNames,
  postgresDdl,
  withDefaults,
  type ChangeSet,
  type EntityName,
  type Row,
  type SyncRequest,
  type SyncResponse,
} from "../../src/shared/schema";

pg.types.setTypeParser(20, (v) => Number(v)); // BIGINT -> number

export async function migrate(pool: pg.Pool): Promise<void> {
  for (const stmt of postgresDdl()) await pool.query(stmt);
}

function validRow(name: EntityName, row: Row): boolean {
  return (
    !!row &&
    typeof row.id === "string" &&
    row.id.length > 0 &&
    row.id.length <= 200 &&
    Number.isFinite(Number(row.updated_at)) &&
    Object.keys(row).every((k) => colNames(name).includes(k))
  );
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
      const cols = colNames(name);
      const set = cols.filter((c) => c !== "id").map((c) => `${c} = EXCLUDED.${c}`);
      const sql =
        `INSERT INTO ${name} (${cols.join(", ")}, seq) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, nextval('vitro_seq')) ` +
        `ON CONFLICT (id) DO UPDATE SET ${set.join(", ")}, seq = EXCLUDED.seq WHERE ${name}.updated_at < EXCLUDED.updated_at`;
      for (const row of req.changes?.[name] ?? []) {
        if (!validRow(name, row)) throw new HttpError(400, `invalid ${name} row`);
        const full = withDefaults(name, row);
        await client.query(sql, cols.map((c) => full[c] ?? null));
      }
    }
    const since = Number(req.since) || 0;
    const changes: ChangeSet = {};
    let cursor = since;
    for (const name of ENTITY_NAMES) {
      const cols = colNames(name);
      const r = await client.query(`SELECT ${cols.join(", ")}, seq FROM ${name} WHERE seq > $1 ORDER BY seq`, [since]);
      if (r.rows.length) {
        changes[name] = r.rows.map(({ seq, ...row }) => {
          cursor = Math.max(cursor, seq);
          return row as Row;
        });
      }
    }
    await client.query("COMMIT");
    return { cursor, changes };
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
      if (req.method === "GET" && path === "/v1/health") return send(200, { ok: true });
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
