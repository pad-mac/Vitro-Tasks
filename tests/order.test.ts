import { describe, expect, it } from "vitest";
import { applyRanks, moveInOrder, parseRanks, positionsFor, ranksFor, subtaskPositions } from "../src/lib/order";
import { groupTasks, type Data } from "../src/lib/views";
import type { Task } from "../src/shared/schema";

let n = 0;
const task = (p: Partial<Task>): Task => ({
  id: `t${++n}`, list_id: null, section_id: null, parent_id: null, title: `task ${n}`, notes: "",
  priority: 0, status: 0, start_date: null, start_time: null, end_date: null, end_time: null,
  deadline_date: null, deadline_time: null, completed_at: null, position: n, pinned: 0,
  created_at: n, updated_at: n, deleted: 0, ...p,
});
const ids = (ts: Task[]) => ts.map((t) => t.id);

describe("custom order", () => {
  const a = task({ id: "a" });
  const b = task({ id: "b" });
  const c = task({ id: "c" });
  const d = task({ id: "d" });

  it("moves an id to a place counted without itself", () => {
    expect(moveInOrder(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveInOrder(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveInOrder(["a", "b"], "x", 9)).toEqual(["a", "b", "x"]);
  });

  it("lays ranks over the sorted order and keeps unranked tasks in place", () => {
    const ranks = ranksFor(["d", "a", "b", "c"], {});
    expect(ids(applyRanks([a, b, c, d], ranks))).toEqual(["d", "a", "b", "c"]);
    // A new task sorted between b and c keeps that slot.
    const e = task({ id: "e" });
    expect(ids(applyRanks([a, b, e, c, d], ranks))).toEqual(["d", "a", "e", "b", "c"]);
  });

  it("never mixes pinned or completed tasks into other tasks' places", () => {
    const p = task({ id: "p", pinned: 1 });
    const x = task({ id: "x", status: 1 });
    const ranks = ranksFor(["x", "c", "p", "a"], {});
    expect(ids(applyRanks([p, a, c, x], ranks))).toEqual(["p", "c", "a", "x"]);
  });

  it("keeps other groups' ranks and drops ones that are gone", () => {
    expect(ranksFor(["b", "a"], { z: 4, y: 1 }, new Set(["z", "a", "b"]))).toEqual({ z: 4, b: 1, a: 2 });
    expect(parseRanks("not json")).toEqual({});
    expect(parseRanks("[1]")).toEqual({});
  });

  it("gives only the moved task a new position when its neighbours allow it", () => {
    const t = (id: string, position: number) => task({ id, position });
    expect(positionsFor([t("m", 9), t("x", 1), t("y", 2)], "m")).toEqual([{ id: "m", position: 0 }]);
    expect(positionsFor([t("x", 1), t("m", 9), t("y", 2)], "m")).toEqual([{ id: "m", position: 1.5 }]);
    expect(positionsFor([t("x", 1), t("y", 2), t("m", 0)], "m")).toEqual([{ id: "m", position: 3 }]);
  });

  it("renumbers when the neighbours share a position", () => {
    const t = (id: string, position: number) => task({ id, position });
    const out = positionsFor([t("x", 5), t("m", 1), t("y", 5), t("z", 7)], "m");
    const pos = Object.fromEntries(out.map((p) => [p.id, p.position]));
    const order = ["x", "m", "y", "z"].map((id) => pos[id] ?? { x: 5, y: 5, z: 7 }[id as "x"]);
    expect([...order].sort((p, q) => p - q)).toEqual(order);
    expect(new Set(order).size).toBe(4);
  });

  it("applies a custom order inside each group, not with the Custom sort", () => {
    const data: Data = { lists: [], sections: [], tasks: [] };
    const ts = [task({ id: "h", priority: 3 }), task({ id: "l", priority: 1 })];
    const ranks = { l: 1, h: 2 };
    const sorted = groupTasks(ts, { group_by: "none", sort_by: "priority" }, { kind: "smart", id: "all" }, data, "2026-11-17", ranks);
    expect(ids(sorted[0].tasks)).toEqual(["l", "h"]);
    const manual = groupTasks(ts, { group_by: "none", sort_by: "manual" }, { kind: "smart", id: "all" }, data, "2026-11-17", ranks);
    expect(ids(manual[0].tasks)).toEqual(["h", "l"]);
  });
});

describe("subtask order", () => {
  const s = (id: string, position: number, status = 0) => task({ id, position, status, parent_id: "p" });
  const apply = (subs: Task[], moves: { id: string; position: number }[]) =>
    subs
      .map((t) => ({ ...t, position: moves.find((m) => m.id === t.id)?.position ?? t.position }))
      .sort((x, y) => x.position - y.position)
      .map((t) => t.id);

  it("places a moved subtask between its new neighbours, done ones included", () => {
    const subs = [s("a", 1), s("b", 2, 1), s("c", 3), s("d", 4)];
    expect(apply(subs, subtaskPositions(subs, "d", 1))).toEqual(["a", "d", "b", "c"]);
    expect(apply(subs, subtaskPositions(subs, "a", 3))).toEqual(["b", "c", "d", "a"]);
    expect(apply(subs, subtaskPositions(subs, "c", 0))).toEqual(["c", "a", "b", "d"]);
  });

  it("renumbers when neighbours share a position", () => {
    const subs = [s("a", 0), s("b", 0), s("c", 0)];
    const moves = subtaskPositions(subs, "c", 1);
    expect(apply(subs, moves)).toEqual(["a", "c", "b"]);
  });

  it("does nothing for a single subtask", () => {
    expect(subtaskPositions([s("a", 1)], "a", 0)).toEqual([]);
  });
});
