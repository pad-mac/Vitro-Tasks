// End-to-end sync: two devices (sql.js) against the real server code and Postgres.
// Needs TEST_DATABASE_URL; skipped otherwise.
import http from "node:http";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAll, put, remove } from "../src/db/repo";
import { syncOnce, type SyncConfig } from "../src/db/sync";
import type { Db } from "../src/db/driver";
import type { Task } from "../src/shared/schema";
import { createServer, migrate } from "../server/src/index";
import { memoryDb } from "./helpers";

const url = process.env.TEST_DATABASE_URL;
const TOKEN = "test-token-0123456789";

describe.skipIf(!url)("sync", () => {
  let pool: pg.Pool;
  let server: http.Server;
  let cfg: SyncConfig;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query("DROP TABLE IF EXISTS lists, sections, tasks, settings; DROP SEQUENCE IF EXISTS vitro_seq");
    await migrate(pool);
    await migrate(pool); // must be repeatable
    server = createServer(pool, TOKEN);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    cfg = { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: TOKEN };
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await pool.end();
  });

  const task = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, ...extra });
  const titles = async (db: Db) =>
    (await loadAll<Task>(db, "tasks")).map((t) => `${t.id}=${t.title}`).sort().join(",");

  it("rejects a wrong token and answers health checks", async () => {
    const a = await memoryDb();
    await expect(syncOnce(a, { ...cfg, token: "wrong" })).rejects.toThrow(/401/);
    expect((await fetch(`${cfg.url}/v1/health`)).status).toBe(200);
  });

  it("carries creates, edits and deletes between two devices", async () => {
    const a = await memoryDb();
    const b = await memoryDb();

    await put(a, "tasks", task("t1", "from A", { deadline_date: "2026-12-01", priority: 3 }), 1000);
    await put(a, "lists", { id: "l1", name: "Research" }, 1000);
    expect(await syncOnce(a, cfg)).toMatchObject({ pushed: 2 });

    expect((await syncOnce(b, cfg)).pulled).toBe(2);
    const onB = (await loadAll<Task>(b, "tasks"))[0];
    expect(onB).toMatchObject({ id: "t1", title: "from A", deadline_date: "2026-12-01", priority: 3 });

    // B edits, A receives.
    await put(b, "tasks", { ...onB, title: "edited on B" }, 2000);
    await syncOnce(b, cfg);
    await syncOnce(a, cfg);
    expect(await titles(a)).toBe("t1=edited on B");

    // A deletes, B loses it.
    await remove(a, "tasks", "t1", 3000);
    await syncOnce(a, cfg);
    await syncOnce(b, cfg);
    expect(await titles(b)).toBe("");

    // Nothing left to send, nothing echoed back as a change.
    expect(await syncOnce(a, cfg)).toMatchObject({ pushed: 0, pulled: 0 });
    expect(await syncOnce(b, cfg)).toMatchObject({ pushed: 0, pulled: 0 });
  });

  it("resolves concurrent edits by last write and converges", async () => {
    const a = await memoryDb();
    const b = await memoryDb();
    await put(a, "tasks", task("c1", "base"), 5000);
    await syncOnce(a, cfg);
    await syncOnce(b, cfg);

    const row = (await loadAll<Task>(b, "tasks")).find((t) => t.id === "c1")!;
    await put(a, "tasks", { ...row, title: "A older" }, 6000);
    await put(b, "tasks", { ...row, title: "B newer" }, 7000);
    await syncOnce(b, cfg); // newer edit reaches the server first
    await syncOnce(a, cfg); // older edit is refused, A receives B's version
    await syncOnce(b, cfg);
    const find = async (db: Db) => (await loadAll<Task>(db, "tasks")).find((t) => t.id === "c1")!.title;
    expect(await find(a)).toBe("B newer");
    expect(await find(b)).toBe("B newer");
  });

  it("keeps a local edit made while offline that is newer than the server copy", async () => {
    const a = await memoryDb();
    const b = await memoryDb();
    await put(a, "tasks", task("o1", "v1"), 8000);
    await syncOnce(a, cfg);
    await syncOnce(b, cfg);
    const row = (await loadAll<Task>(b, "tasks")).find((t) => t.id === "o1")!;
    await put(a, "tasks", { ...row, title: "A v2" }, 8500);
    await syncOnce(a, cfg);
    await put(b, "tasks", { ...row, title: "B v3 offline" }, 9000);
    await syncOnce(b, cfg);
    await syncOnce(a, cfg);
    const find = async (db: Db) => (await loadAll<Task>(db, "tasks")).find((t) => t.id === "o1")!.title;
    expect(await find(a)).toBe("B v3 offline");
    expect(await find(b)).toBe("B v3 offline");
  });

  it("a device with a slow clock still wins when it edits last", async () => {
    const a = await memoryDb();
    const b = await memoryDb();
    await put(a, "tasks", task("k1", "from fast clock"), 50_000);
    await syncOnce(a, cfg);
    await syncOnce(b, cfg);
    const row = (await loadAll<Task>(b, "tasks")).find((t) => t.id === "k1")!;
    await put(b, "tasks", { ...row, title: "from slow clock" }, 10_000); // clock far behind
    await syncOnce(b, cfg);
    await syncOnce(a, cfg);
    expect((await loadAll<Task>(a, "tasks")).find((t) => t.id === "k1")!.title).toBe("from slow clock");
  });

  it("refuses rows with unknown columns", async () => {
    const res = await fetch(`${cfg.url}/v1/sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ since: 0, changes: { tasks: [{ id: "x", updated_at: 1, "title; DROP TABLE tasks": 1 }] } }),
    });
    expect(res.status).toBe(400);
  });
});
