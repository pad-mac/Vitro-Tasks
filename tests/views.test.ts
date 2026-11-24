import { describe, expect, it } from "vitest";
import { compareTasks, entriesForDay, groupTasks, listWithDescendants, subgroupTasks, tasksForView, type Data } from "../src/lib/views";
import type { List, Section, Task } from "../src/shared/schema";

const TODAY = "2026-11-16";
let n = 0;
const task = (p: Partial<Task>): Task => ({
  id: `t${++n}`, list_id: null, section_id: null, parent_id: null, title: `task ${n}`, notes: "",
  priority: 0, status: 0, start_date: null, start_time: null, end_date: null, end_time: null,
  deadline_date: null, deadline_time: null, completed_at: null, position: n, pinned: 0,
  created_at: n, updated_at: n, deleted: 0, repeat: null, ...p,
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

describe("subgroupTasks", () => {
  it("splits a lane by date buckets with pinned tasks first", () => {
    const lane = [
      task({ id: "p", pinned: 1, start_date: "2026-12-01" }),
      task({ id: "o", start_date: "2026-11-01" }),
      task({ id: "l", start_date: "2026-12-24" }),
      task({ id: "n" }),
    ];
    expect(subgroupTasks(lane, "date", TODAY).map((g) => `${g.label}:${ids(g.tasks)}`)).toEqual([
      "Pinned:p", "Overdue:o", "Later:l", "No Date:n",
    ]);
  });
  it("splits by priority, or not at all for manual order", () => {
    const lane = [task({ id: "h", priority: 3 }), task({ id: "x" })];
    expect(subgroupTasks(lane, "priority", TODAY).map((g) => g.label)).toEqual(["High", "None"]);
    expect(subgroupTasks(lane, "manual", TODAY).map((g) => g.label)).toEqual([""]);
  });
  it("treats won't-do tasks as closed", () => {
    const d: Data = { lists: [], sections: [], tasks: [task({ id: "w", status: 2 }), task({ id: "q" })] };
    expect(ids(tasksForView({ kind: "smart", id: "all" }, d, false, TODAY))).toBe("q");
    expect(ids(tasksForView({ kind: "smart", id: "completed" }, d, false, TODAY))).toBe("w");
  });
});

describe("list visibility", () => {
  it("hides a list from All, Today/Next 7 Days and the calendar separately, never from Deadlines", async () => {
    const { hiddenLists } = await import("../src/lib/views");
    const settings = {
      "listvis:home": JSON.stringify({ all: false, today: false }),
      "listvis:uni": JSON.stringify({ calendar: false }),
    };
    const hidden = hiddenLists(settings);
    const d: Data = { ...data, hidden };
    expect(ids(tasksForView({ kind: "smart", id: "all" }, d, false, TODAY))).toBe("abce");
    expect(ids(tasksForView({ kind: "smart", id: "today" }, d, false, TODAY))).toBe("ab");
    expect(ids(tasksForView({ kind: "smart", id: "deadlines" }, d, false, TODAY))).toBe("cd");
    expect(ids(tasksForView({ kind: "calendar" }, d, false, TODAY))).toBe("abdeh");
    expect(ids(tasksForView({ kind: "list", id: "home" }, d, false, TODAY))).toBe("dh");
  });
});

describe("completed tasks", () => {
  const open1 = task({ id: "o1", start_date: "2026-11-20" });
  const open2 = task({ id: "o2", start_date: "2026-11-18" });
  const pinnedDone = task({ id: "pd", pinned: 1, status: 1, completed_at: 100, start_date: "2026-11-01" });
  const doneOld = task({ id: "d1", status: 1, completed_at: 50, priority: 3, start_date: "2026-11-02" });
  const doneNew = task({ id: "d2", status: 2, completed_at: 300, start_date: "2026-12-01" });
  const all = [doneOld, open1, pinnedDone, doneNew, open2];
  const order = (sort: Parameters<typeof compareTasks>[0]) => [...all].sort(compareTasks(sort)).map((t) => t.id);

  it("always come last, newest completion first, whatever the sort", () => {
    for (const sort of ["date", "priority", "title", "manual", "created", "deadline", "datedeadline"] as const) {
      expect(order(sort).slice(2)).toEqual(["d2", "pd", "d1"]);
    }
    expect(order("date").slice(0, 2)).toEqual(["o2", "o1"]);
  });

  it("a completed pinned task is not pinned to the top of a board lane", () => {
    const lane = [...all].sort(compareTasks("priority"));
    expect(subgroupTasks(lane, "priority", TODAY).map((g) => g.key)).not.toContain("pinned");
  });
});

describe("order within a calendar day", () => {
  it("spans, then deadlines, then untimed by position, then timed by time — whatever order they come in", () => {
    const D = "2026-12-09";
    const timed = task({ id: "elena", start_date: D, start_time: "18:00", position: 5 });
    const deadline = task({ id: "referat", deadline_date: D, position: 3 });
    const a = task({ id: "goett", start_date: D, position: 1 });
    const b = task({ id: "tyr", start_date: D, position: 2 });
    const span = task({ id: "span", start_date: "2026-12-08", end_date: "2026-12-10", position: 9 });
    const early = task({ id: "early", start_date: D, start_time: "09:00", position: 0 });
    const want = ["span", "referat", "goett", "tyr", "early", "elena"];
    const all = [timed, deadline, a, b, span, early];
    for (let i = 0; i < all.length; i++) {
      const rot = [...all.slice(i), ...all.slice(0, i)];
      expect(entriesForDay(rot, D).map((e) => e.task.id)).toEqual(want);
      expect(entriesForDay([...rot].reverse(), D).map((e) => e.task.id)).toEqual(want);
    }
  });
});
