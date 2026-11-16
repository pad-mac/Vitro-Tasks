import { describe, expect, it } from "vitest";
import { entriesForDay, groupTasks, listWithDescendants, tasksForView, type Data } from "../src/lib/views";
import type { List, Section, Task } from "../src/shared/schema";

const TODAY = "2026-11-16";
let n = 0;
const task = (p: Partial<Task>): Task => ({
  id: `t${++n}`, list_id: null, section_id: null, parent_id: null, title: `task ${n}`, notes: "",
  priority: 0, status: 0, start_date: null, start_time: null, end_date: null, end_time: null,
  deadline_date: null, deadline_time: null, completed_at: null, position: n, pinned: 0,
  created_at: n, updated_at: n, deleted: 0, ...p,
});
const list = (id: string, parent: string | null = null): List => ({
  id, name: id, color: "", parent_id: parent, position: 0, view_mode: "list", group_by: "section",
  sort_by: "manual", collapsed: 0, updated_at: 0, deleted: 0,
});

const lists = [list("studies"), list("research", "studies"), list("uni", "studies"), list("home")];
const sections: Section[] = [
  { id: "s1", list_id: "research", name: "General", position: 1, updated_at: 0, deleted: 0 },
  { id: "s2", list_id: "research", name: "CFP", position: 2, updated_at: 0, deleted: 0 },
];
const tasks = [
  task({ id: "a", list_id: "research", section_id: "s1", start_date: "2026-11-10", priority: 2 }),
  task({ id: "b", list_id: "research", section_id: "s2", start_date: "2026-11-16" }),
  task({ id: "c", list_id: "uni", start_date: "2026-11-20", deadline_date: "2026-11-25", priority: 3 }),
  task({ id: "d", list_id: "home", deadline_date: "2026-11-16" }),
  task({ id: "e" }),
  task({ id: "f", list_id: "home", status: 1, completed_at: 5, start_date: "2026-11-16" }),
  task({ id: "g", parent_id: "a", list_id: "research" }),
  task({ id: "h", list_id: "home", start_date: "2026-12-30" }),
];
const data: Data = { lists, sections, tasks };
const ids = (ts: Task[]) => ts.map((t) => t.id).sort().join("");

describe("tasksForView", () => {
  it("a parent list includes its sublists", () => {
    expect(listWithDescendants(lists, "studies")).toEqual(["studies", "research", "uni"]);
    expect(ids(tasksForView({ kind: "list", id: "studies" }, data, false, TODAY))).toBe("abc");
  });
  it("hides subtasks and completed tasks by default", () => {
    expect(ids(tasksForView({ kind: "smart", id: "all" }, data, false, TODAY))).toBe("abcdeh");
    expect(ids(tasksForView({ kind: "smart", id: "all" }, data, true, TODAY))).toBe("abcdefh");
  });
  it("today covers overdue work and deadlines due today", () => {
    expect(ids(tasksForView({ kind: "smart", id: "today" }, data, false, TODAY))).toBe("abd");
  });
  it("next 7 days, inbox, deadlines, completed", () => {
    expect(ids(tasksForView({ kind: "smart", id: "next7" }, data, false, TODAY))).toBe("abcd");
    expect(ids(tasksForView({ kind: "smart", id: "inbox" }, data, false, TODAY))).toBe("e");
    expect(ids(tasksForView({ kind: "smart", id: "deadlines" }, data, false, TODAY))).toBe("cd");
    expect(ids(tasksForView({ kind: "smart", id: "completed" }, data, false, TODAY))).toBe("f");
  });
});

describe("groupTasks", () => {
  it("groups a list by its sections, in order", () => {
    const view = { kind: "list", id: "research" } as const;
    const g = groupTasks(tasksForView(view, data, false, TODAY), { group_by: "section", sort_by: "manual" }, view, data, TODAY);
    expect(g.map((x) => x.label)).toEqual(["General", "CFP"]);
    expect(g[1].patch).toMatchObject({ section_id: "s2" });
  });
  it("groups by date buckets and keeps drop targets", () => {
    const view = { kind: "smart", id: "all" } as const;
    const g = groupTasks(tasksForView(view, data, false, TODAY), { group_by: "date", sort_by: "priority" }, view, data, TODAY);
    expect(g.map((x) => `${x.key}:${ids(x.tasks)}`)).toEqual(["overdue:a", "today:b", "tomorrow:", "week:c", "later:h", "none:de"]);
    expect(g[2].patch).toEqual({ start_date: "2026-11-17" });
  });
  it("groups by deadline", () => {
    const view = { kind: "smart", id: "deadlines" } as const;
    const g = groupTasks(tasksForView(view, data, false, TODAY), { group_by: "deadline", sort_by: "deadline" }, view, data, TODAY);
    expect(g.filter((x) => x.tasks.length).map((x) => `${x.key}:${ids(x.tasks)}`)).toEqual(["today:d", "later:c"]);
  });
  it("priority columns always exist, highest first", () => {
    const view = { kind: "smart", id: "all" } as const;
    const g = groupTasks(tasksForView(view, data, false, TODAY), { group_by: "priority", sort_by: "date" }, view, data, TODAY);
    expect(g.map((x) => x.label)).toEqual(["High", "Medium", "Low", "None"]);
    expect(ids(g[0].tasks)).toBe("c");
  });
});

describe("entriesForDay", () => {
  it("returns planned spans and deadlines as separate entries", () => {
    const span = task({ id: "s", start_date: "2026-11-16", end_date: "2026-11-18", deadline_date: "2026-11-18" });
    expect(entriesForDay([span], "2026-11-17").map((e) => e.kind)).toEqual(["planned"]);
    expect(entriesForDay([span], "2026-11-18").map((e) => e.kind).sort()).toEqual(["deadline", "planned"]);
    expect(entriesForDay([span], "2026-11-19")).toEqual([]);
  });
});
