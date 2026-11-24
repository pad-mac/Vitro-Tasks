// The widgets' own sync engine (src/widget/core.ts): ticks, round trips,
// snapshots from the app's state with what the widget pulled on top. Also run
// as the bundle the widget loads, in a bare JavaScript context (as in
// JavaScriptCore: no crypto, no fetch, no console). The round trip against the
// real server needs TEST_DATABASE_URL.
import http from "node:http";
import { buildSync } from "esbuild";
import pg from "pg";
import vm from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as core from "../src/widget/core";
import type { WidgetState } from "../src/widget/core";
import type { WidgetSnapshot } from "../src/lib/widgets";
import { loadAll, put } from "../src/db/repo";
import { syncOnce } from "../src/db/sync";
import type { List, Task } from "../src/shared/schema";
import { createServer, migrate } from "../server/src/index";
import { memoryDb } from "./helpers";

const TODAY = "2026-11-24";
const NOW = Date.parse("2026-11-24T10:00:00");
let n = 0;
const task = (p: Partial<Task> & { origin?: string }): Task & { origin?: string } => ({
  id: `t${++n}`, list_id: "work", section_id: null, parent_id: null, title: `task ${n}`, notes: "",
  priority: 0, status: 0, start_date: null, start_time: null, end_date: null, end_time: null,
  deadline_date: null, deadline_time: null, completed_at: null, position: n, pinned: 0,
  created_at: n, updated_at: 100, deleted: 0, repeat: null, origin: "s1", ...p,
});
const work = { id: "work", name: "Work", color: "#0088ff", parent_id: null, position: 1, view_mode: "list", group_by: "none", sort_by: "manual", updated_at: 100, deleted: 0, origin: "s1" } as List & { origin: string };

function state(tasks: Task[], extra: Partial<WidgetState> = {}): string {
  return JSON.stringify({ v: 1, at: 1, synced: NOW - 60_000, servers: [{ id: "s1", url: "http://x/", token: "tok", cursor: 7 }], lists: [work], sections: [], tasks, settings: {}, ...extra });
}
const snap = (s: string, p = "", c = ""): WidgetSnapshot => JSON.parse(core.snapshot(s, p, c, TODAY, NOW));
const rowsOf = (sn: WidgetSnapshot, id: string) => sn.views.find((v) => v.id === id)!.rows.map((r) => r.title);
/** core.received, with the two files it returns read back. */
const receive = (...args: Parameters<typeof core.received>) => {
  const out = JSON.parse(core.received(...args)) as { pulled: string; changes: string };
  return { pulled: JSON.parse(out.pulled), changes: JSON.parse(out.changes) as core.Change[] };
};

describe("widget core", () => {
  it("draws the app's state as the app would", () => {
    const s = state([task({ title: "A", start_date: TODAY }), task({ title: "B" })]);
    const sn = snap(s);
    expect(rowsOf(sn, "work")).toEqual(["A", "B"]);
    expect(rowsOf(sn, "today")).toEqual(["A"]);
  });

  it("ticks a task off with its open subtasks, and hides them", () => {
    const a = task({ title: "A" });
    const kid = task({ title: "A1", parent_id: a.id });
    const s = state([a, kid]);
    const changes = core.complete(s, "", "", a.id, NOW, TODAY);
    const list = JSON.parse(changes) as core.Change[];
    expect(list.map((c) => [c.row.id, c.row.status, c.origin, c.pushed])).toEqual([[a.id, 1, "s1", false], [kid.id, 1, "s1", false]]);
    expect(list[0].row.updated_at).toBe(NOW);
    expect(list[0].row).not.toHaveProperty("origin");
    expect(rowsOf(snap(s, "", changes), "work")).toEqual([]);
    // Twice changes nothing more.
    expect(JSON.parse(core.complete(s, "", changes, a.id, NOW, TODAY))).toHaveLength(2);
  });

  it("moves a repeating task on, with a done copy", () => {
    const r = task({ title: "Weekly", start_date: TODAY, repeat: "FREQ=WEEKLY" });
    const s = state([r]);
    const changes = JSON.parse(core.complete(s, "", "", r.id, NOW, TODAY)) as core.Change[];
    const moved = changes.find((c) => c.row.id === r.id)!.row;
    const copy = changes.find((c) => c.row.id !== r.id)!.row;
    expect([moved.status, moved.start_date, moved.repeat]).toEqual([0, "2026-12-01", "FREQ=WEEKLY"]);
    expect([copy.status, copy.start_date, copy.repeat]).toEqual([1, TODAY, null]);
    expect(rowsOf(snap(s, "", JSON.stringify(changes)), "today")).toEqual([]);
  });

  it("sends what is unsent to its own server, from the app's position, then keeps what came back", () => {
    const a = task({ title: "A" });
    const b = task({ title: "B" });
    const other = task({ title: "Elsewhere", origin: "s2" });
    const s = state([a, b, other], { servers: [{ id: "s1", url: "http://x/", token: "tok", cursor: 7 }, { id: "s2", url: "http://y", token: "t2", cursor: 3 }] });
    let changes = core.complete(s, "", "", a.id, NOW, TODAY);
    changes = core.complete(s, "", changes, other.id, NOW, TODAY);
    const reqs = JSON.parse(core.requests(s, "", changes)) as { server: string; url: string; body: string }[];
    expect(reqs.map((r) => [r.server, r.url])).toEqual([["s1", "http://x/v1/sync"], ["s2", "http://y/v1/sync"]]);
    const body = JSON.parse(reqs[0].body);
    expect(body.since).toBe(7);
    expect(body.changes.tasks.map((r: Task) => r.id)).toEqual([a.id]);
    // The server took it and has a rename of B from elsewhere.
    const answer = JSON.stringify({ cursor: 12, changes: { tasks: [{ ...JSON.parse(reqs[0].body).changes.tasks[0] }, { ...b, title: "B renamed", updated_at: 500 }] } });
    const out = receive(s, "", changes, "s1", reqs[0].body, answer, NOW + 1);
    const pulled = JSON.stringify(out.pulled);
    const after = JSON.stringify(out.changes);
    expect((out.changes as core.Change[]).map((c) => [c.origin, c.pushed])).toEqual([["s1", true], ["s2", false]]);
    expect(rowsOf(snap(s, pulled, after), "work")).toEqual(["B renamed"]);
    // The next round goes on from there; only s2 still has something to send.
    const next = JSON.parse(core.requests(s, pulled, after));
    expect(JSON.parse(next[0].body)).toEqual({ since: 12, changes: {} });
    expect(core.needsSync(s, pulled, after, NOW + 2)).toBe(true);
  });

  it("starts over from a newer state of the app, and forgets ticks the app already has", () => {
    const a = task({ title: "A" });
    const s = state([a]);
    const changes = core.complete(s, "", "", a.id, NOW, TODAY);
    const reqs = JSON.parse(core.requests(s, "", changes));
    const out = receive(s, "", changes, "s1", reqs[0].body, JSON.stringify({ cursor: 9, changes: {} }), NOW);
    // The app took the tick and wrote its state again, without the task.
    const s2 = state([], { at: 2 });
    expect(JSON.parse(core.requests(s2, JSON.stringify(out.pulled), JSON.stringify(out.changes)))[0].body).toBe(JSON.stringify({ since: 7, changes: {} }));
    const kept = receive(s2, JSON.stringify(out.pulled), JSON.stringify(out.changes), "s1", "{}", JSON.stringify({ cursor: 9, changes: {} }), NOW);
    // Pushed and not in the app's state yet: kept (it shows as done until the app has it).
    expect(kept.changes).toHaveLength(1);
    const s3 = state([{ ...a, status: 1, updated_at: NOW + 5 } as Task], { at: 3 });
    expect(receive(s3, "", JSON.stringify(out.changes), "s1", "{}", JSON.stringify({ cursor: 9, changes: {} }), NOW).changes).toHaveLength(0);
  });

  it("pulls after a while, not on every refresh, and not without servers", () => {
    const s = state([task({})]);
    expect(core.needsSync(s, "", "", NOW)).toBe(false);
    expect(core.needsSync(s, "", "", NOW + 11 * 60_000)).toBe(true);
    expect(core.needsSync(state([], { servers: [] }), "", "", NOW + 99 * 60_000)).toBe(false);
  });

  it("runs as the bundle the widget loads, in a bare context", () => {
    const js = buildSync({ entryPoints: ["src/widget/core.ts"], bundle: true, format: "iife", globalName: "VitroCore", target: "es2020", write: false }).outputFiles[0].text;
    const ctx = vm.createContext({});
    vm.runInContext(js, ctx);
    const Core = (ctx as unknown as { VitroCore: typeof core }).VitroCore;
    const r = task({ title: "Weekly", start_date: TODAY, repeat: "FREQ=WEEKLY" });
    const s = state([r]);
    const changes = Core.complete(s, "", "", r.id, NOW, TODAY);
    const copy = (JSON.parse(changes) as core.Change[]).find((c) => c.row.id !== r.id)!;
    expect(copy.row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((JSON.parse(Core.snapshot(s, "", changes, TODAY, NOW)) as WidgetSnapshot).days["2026-12-01"].map((e) => e.title)).toEqual(["Weekly"]);
  });
});

const dbUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("widget core against the server", () => {
  let pool: pg.Pool;
  let server: http.Server;
  let base: string;
  const TOKEN = "test-token-widget";

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: dbUrl });
    await admin.connect();
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = 'vitro_widgetcore'")).rowCount) await admin.query("CREATE DATABASE vitro_widgetcore");
    await admin.end();
    const u = new URL(dbUrl!);
    u.pathname = "/vitro_widgetcore";
    pool = new pg.Pool({ connectionString: u.toString(), max: 1 });
    await pool.query("DROP TABLE IF EXISTS lists, sections, tasks, settings; DROP SEQUENCE IF EXISTS vitro_seq");
    await migrate(pool);
    server = createServer(pool, TOKEN);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await pool.end();
  });

  it("a tick in the widget reaches the app through the server, once", async () => {
    // The app: a repeating task with notes and a plain one, synced.
    const app = await memoryDb();
    const cfg = { id: "s1", url: base, token: TOKEN };
    await put(app, "lists", { ...work, origin: "s1" } as never);
    await put(app, "tasks", { ...task({ id: "rep", title: "Weekly", notes: "keep me", start_date: TODAY, repeat: "FREQ=WEEKLY" }) } as never);
    await put(app, "tasks", { ...task({ id: "one", title: "Once" }) } as never);
    const first = await syncOnce(app, cfg);
    const tasks = await loadAll<Task & { origin: string }>(app, "tasks");
    const s = state(tasks, { servers: [{ id: "s1", url: base, token: TOKEN, cursor: first.cursor }], lists: [{ ...work, origin: "s1" }] });

    // The widget ticks both and sends them.
    let changes = core.complete(s, "", "", "rep", NOW, TODAY);
    changes = core.complete(s, "", changes, "one", NOW, TODAY);
    const [req] = JSON.parse(core.requests(s, "", changes));
    const res = await fetch(req.url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${req.token}` }, body: req.body });
    expect(res.status).toBe(200);
    const out = receive(s, "", changes, "s1", req.body, await res.text(), NOW);
    expect((out.changes as core.Change[]).every((c) => c.pushed)).toBe(true);

    // The app takes the widget's rows (as it does when it comes forward), then syncs: nothing doubles.
    const { adoptRows } = await import("../src/db/repo");
    await adoptRows(app, out.changes);
    await syncOnce(app, cfg);
    const after = await loadAll<Task>(app, "tasks");
    const rep = after.find((t) => t.id === "rep")!;
    expect([rep.status, rep.start_date, rep.notes]).toEqual([0, "2026-12-01", "keep me"]);
    expect(after.filter((t) => t.title === "Weekly" && t.status === 1).map((t) => t.start_date)).toEqual([TODAY]);
    expect(after.find((t) => t.id === "one")!.status).toBe(1);
  });
});
