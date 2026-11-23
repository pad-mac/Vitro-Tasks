// Several sync servers: every row lives on one server (its local `origin`),
// is sent only there, and keeps its server when written or synced again.
// The two-server round trip needs TEST_DATABASE_URL and TEST_DATABASE_URL_2.
import http from "node:http";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyRemote, assignOrigin, collectDirty, getMeta, loadAll, purgeOrigin, put, remove, setMeta } from "../src/db/repo";
import { getDefaultServer, getServers, hostName, resetServer, syncOnce, type SyncServer } from "../src/db/sync";
import type { Db } from "../src/db/driver";
import type { List, Task } from "../src/shared/schema";
import { createServer, migrate } from "../server/src/index";
import { memoryDb } from "./helpers";

const origins = async (db: Db) => (await loadAll<Task>(db, "tasks")).map((t) => `${t.id}@${t.origin}`).sort().join(",");

describe("origin (which server a row lives on)", () => {
  it("is set when a row is created and kept by later writes", async () => {
    const db = await memoryDb();
    await put(db, "tasks", { id: "a", title: "A", origin: "s1" });
    await put(db, "tasks", { id: "a", title: "A2", origin: "s2" });
    await put(db, "tasks", { id: "a", title: "A3" });
    const [t] = await loadAll<Task>(db, "tasks");
    expect([t.title, t.origin]).toEqual(["A3", "s1"]);
  });

  it("only goes to its own server, and is never sent itself", async () => {
    const db = await memoryDb();
    await put(db, "tasks", { id: "a", title: "A", origin: "s1" });
    await put(db, "tasks", { id: "b", title: "B", origin: "s2" });
    const one = await collectDirty(db, "s1");
    expect(one.tasks?.map((r) => r.id)).toEqual(["a"]);
    expect(Object.keys(one.tasks![0])).not.toContain("origin");
    expect(Object.keys(one.tasks![0])).not.toContain("dirty");
    expect((await collectDirty(db, "s2")).tasks?.map((r) => r.id)).toEqual(["b"]);
  });

  it("comes from the server a new row arrived from; a known row keeps its own", async () => {
    const db = await memoryDb();
    await put(db, "tasks", { id: "a", title: "A", origin: "s1", updated_at: 1 });
    await applyRemote(db, { tasks: [{ id: "a", title: "A newer", updated_at: Date.now() + 1000 }, { id: "b", title: "B", updated_at: 5 }] }, "s2");
    expect(await origins(db)).toBe("a@s1,b@s2");
    expect((await loadAll<Task>(db, "tasks")).find((t) => t.id === "a")!.title).toBe("A newer");
  });

  it("can be handed over (first server) or forgotten (server removed)", async () => {
    const db = await memoryDb();
    await put(db, "tasks", { id: "a", title: "A" });
    await put(db, "tasks", { id: "b", title: "B", origin: "s2" });
    await assignOrigin(db, "", "s1");
    expect(await origins(db)).toBe("a@s1,b@s2");
    await purgeOrigin(db, "s2");
    expect(await origins(db)).toBe("a@s1");
  });

  it("turns the one server of an older version into the first entry, keeping its place", async () => {
    const db = await memoryDb();
    await put(db, "tasks", { id: "a", title: "A" });
    await setMeta(db, "sync_url", "https://tasks.example.org/");
    await setMeta(db, "sync_token", "secret");
    await setMeta(db, "sync_cursor", "42");
    const [s] = await getServers(db);
    expect([s.name, s.url, s.token, s.enabled]).toEqual(["tasks.example.org", "https://tasks.example.org", "secret", true]);
    expect(await getMeta(db, `sync_cursor:${s.id}`)).toBe("42");
    expect(await getDefaultServer(db)).toBe(s.id);
    expect(await origins(db)).toBe(`a@${s.id}`);
    // Only once.
    expect((await getServers(db)).map((x) => x.id)).toEqual([s.id]);
  });

  it("is migrated the same way by two windows starting at once", async () => {
    const db = await memoryDb();
    await put(db, "tasks", { id: "a", title: "A" });
    await setMeta(db, "sync_url", "https://tasks.example.org");
    const [one, two] = await Promise.all([getServers(db), getServers(db)]);
    expect(one.map((x) => x.id)).toEqual(two.map((x) => x.id));
    expect((await getServers(db)).length).toBe(1);
    expect(await origins(db)).toBe(`a@${one[0].id}`);
  });

  it("names a server by its host", () => {
    expect(hostName("https://tasks.example.org:8787/x")).toBe("tasks.example.org");
    expect(hostName("192.168.1.5:8787")).toBe("192.168.1.5");
  });
});

const TOKEN = "test-token-0123456789";
const env = process.env;

/**
 * Two databases of their own (sync.test.ts uses TEST_DATABASE_URL at the same
 * time): TEST_DATABASE_URL_2 and _3, or two databases made next to TEST_DATABASE_URL.
 */
async function databases(): Promise<string[]> {
  if (env.TEST_DATABASE_URL_2 && env.TEST_DATABASE_URL_3) return [env.TEST_DATABASE_URL_2, env.TEST_DATABASE_URL_3];
  const admin = new pg.Client({ connectionString: env.TEST_DATABASE_URL });
  await admin.connect();
  const names = ["vitro_servers_a", "vitro_servers_b"];
  for (const n of names) if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [n])).rowCount) await admin.query(`CREATE DATABASE ${n}`);
  await admin.end();
  return names.map((n) => {
    const u = new URL(env.TEST_DATABASE_URL!);
    u.pathname = `/${n}`;
    return u.toString();
  });
}

describe.skipIf(!(env.TEST_DATABASE_URL_2 && env.TEST_DATABASE_URL_3) && !env.TEST_DATABASE_URL)("two servers", () => {
  const pools: pg.Pool[] = [];
  const servers: http.Server[] = [];
  const cfg: SyncServer[] = [];

  beforeAll(async () => {
    for (const [i, url] of (await databases()).entries()) {
      const pool = new pg.Pool({ connectionString: url, max: 1 });
      await pool.query("DROP TABLE IF EXISTS lists, sections, tasks, settings; DROP SEQUENCE IF EXISTS vitro_seq");
      await migrate(pool);
      const server = createServer(pool, TOKEN);
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      pools.push(pool);
      servers.push(server);
      cfg.push({ id: `s${i + 1}`, name: `S${i + 1}`, url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: TOKEN, enabled: true });
    }
  });

  afterAll(async () => {
    for (const s of servers) await new Promise((r) => s.close(r));
    for (const p of pools) await p.end();
  });

  const onServer = async (i: number, table = "tasks") =>
    (await pools[i].query(`SELECT id, deleted FROM ${table} ORDER BY id`)).rows.map((r) => `${r.id}${r.deleted ? "×" : ""}`).join(",");

  it("keeps each server's rows on it, and a second device sees both", async () => {
    const a = await memoryDb();
    await put(a, "lists", { id: "work", name: "Work", origin: "s1" } as never);
    await put(a, "tasks", { id: "w1", title: "Report", list_id: "work", origin: "s1" });
    await put(a, "lists", { id: "home", name: "Home", origin: "s2" } as never);
    await put(a, "tasks", { id: "h1", title: "Plants", list_id: "home", origin: "s2" });
    await syncOnce(a, cfg[0]);
    await syncOnce(a, cfg[1]);
    expect(await onServer(0)).toBe("w1");
    expect(await onServer(1)).toBe("h1");
    expect(await onServer(0, "lists")).toBe("work");
    expect(await onServer(1, "lists")).toBe("home");
    const b = await memoryDb();
    await syncOnce(b, cfg[0]);
    await syncOnce(b, cfg[1]);
    expect(await origins(b)).toBe("h1@s2,w1@s1");
    expect((await loadAll<List>(b, "lists")).map((l) => `${l.id}@${l.origin}`).sort().join(",")).toBe("home@s2,work@s1");
    // An edit on the second device goes back to that row's server only.
    await put(b, "tasks", { id: "h1", title: "Water plants", list_id: "home" });
    await syncOnce(b, cfg[0]);
    await syncOnce(b, cfg[1]);
    expect((await pools[1].query("SELECT title FROM tasks WHERE id = 'h1'")).rows[0].title).toBe("Water plants");
    expect(await onServer(0)).toBe("w1");
  });

  it("a task moved to the other server: copied there, deleted on the first", async () => {
    const a = await memoryDb();
    await syncOnce(a, cfg[0]);
    await syncOnce(a, cfg[1]);
    // (What the store does when a task goes into a list on another server.)
    await put(a, "tasks", { id: "w1-moved", title: "Report", list_id: "home", origin: "s2" });
    await remove(a, "tasks", "w1");
    await syncOnce(a, cfg[0]);
    await syncOnce(a, cfg[1]);
    expect(await onServer(0)).toBe("w1×");
    expect(await onServer(1)).toBe("h1,w1-moved");
    const b = await memoryDb();
    await syncOnce(b, cfg[0]);
    await syncOnce(b, cfg[1]);
    expect(await origins(b)).toBe("h1@s2,w1-moved@s2");
  });

  it("a server with a new address gets everything of its own again", async () => {
    const a = await memoryDb();
    await syncOnce(a, cfg[1]);
    await pools[1].query("DELETE FROM tasks");
    await resetServer(a, "s2");
    expect((await syncOnce(a, cfg[1])).pushed).toBeGreaterThanOrEqual(2);
    expect(await onServer(1)).toBe("h1,w1-moved");
  });
});
