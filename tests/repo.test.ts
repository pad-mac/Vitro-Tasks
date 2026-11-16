import { describe, expect, it } from "vitest";
import { collectDirty, getMeta, loadAll, migrate, put, remove, setMeta } from "../src/db/repo";
import type { Task } from "../src/shared/schema";
import { memoryDb } from "./helpers";

describe("repo", () => {
  it("migrates repeatedly, stores rows with defaults and soft-deletes", async () => {
    const db = await memoryDb();
    await migrate(db);
    await put(db, "tasks", { id: "a", title: "one" }, 10);
    const [t] = await loadAll<Task>(db, "tasks");
    expect(t).toMatchObject({ id: "a", title: "one", priority: 0, status: 0, deadline_date: null, updated_at: 10 });
    await put(db, "tasks", { ...t, title: "two" }, 5); // clock went backwards
    expect((await loadAll<Task>(db, "tasks"))[0]).toMatchObject({ title: "two", updated_at: 11 });
    await remove(db, "tasks", "a", 20);
    expect(await loadAll(db, "tasks")).toEqual([]);
    expect((await collectDirty(db)).tasks?.[0]).toMatchObject({ id: "a", deleted: 1 });
  });

  it("adds columns that a newer version introduces", async () => {
    const db = await memoryDb();
    await db.exec("DROP TABLE tasks");
    await db.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '')");
    await db.exec("INSERT INTO tasks (id, title) VALUES ('old', 'kept')");
    await migrate(db);
    expect((await loadAll<Task>(db, "tasks"))[0]).toMatchObject({ id: "old", title: "kept", deadline_date: null, deleted: 0 });
  });

  it("stores meta values", async () => {
    const db = await memoryDb();
    expect(await getMeta(db, "k")).toBeNull();
    await setMeta(db, "k", "1");
    await setMeta(db, "k", "2");
    expect(await getMeta(db, "k")).toBe("2");
  });
});
