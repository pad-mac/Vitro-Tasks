import { describe, expect, it } from "vitest";
import { dueThisWeek, horizonLabel, horizonOverdue, separateWhen, thisWeek } from "../src/lib/horizon";
import { defaultsForView, groupTasks, subgroupTasks, tasksForView, type Data } from "../src/lib/views";
import type { Task } from "../src/shared/schema";

// A Thursday: its week starts on Monday 2026-11-23.
const TODAY = "2026-11-26";
let n = 0;
const task = (p: Partial<Task>): Task => ({
  id: `t${++n}`, list_id: null, section_id: null, parent_id: null, title: `task ${n}`, notes: "",
  priority: 0, status: 0, start_date: null, start_time: null, end_date: null, end_time: null,
  deadline_date: null, deadline_time: null, completed_at: null, position: n, pinned: 0,
  created_at: n, updated_at: n, deleted: 0, repeat: null, horizon: null, ...p,
});

describe("This Week", () => {
  it("is the week from Monday, whatever the day", () => {
    expect(thisWeek(TODAY)).toBe("week:2026-11-23");
    expect(thisWeek("2026-11-23")).toBe("week:2026-11-23");
    expect(thisWeek("2026-11-29")).toBe("week:2026-11-23");
    expect(thisWeek("2026-11-30")).toBe("week:2026-11-30");
  });

  it("says how far a week is, and is overdue once its week has passed", () => {
    expect(horizonLabel("week:2026-11-23", TODAY)).toBe("This week");
    expect(horizonLabel("week:2026-11-16", TODAY)).toBe("Last week");
    expect(horizonLabel("week:2026-11-09", TODAY)).toBe("2 weeks ago");
    expect(horizonLabel("week:2026-11-30", TODAY)).toBe("Next week");
    expect(horizonLabel("week:2026-12-14", TODAY)).toBe("In 3 weeks");
    // Over a year's end.
    expect(horizonLabel("week:2025-12-29", "2026-01-05")).toBe("Last week");
    expect(horizonOverdue("week:2026-11-23", TODAY)).toBe(false);
    expect(horizonOverdue("week:2026-11-16", TODAY)).toBe(true);
    // Sunday is still this week; Monday is the next one.
    expect(horizonOverdue("week:2026-11-23", "2026-11-29")).toBe(false);
    expect(horizonLabel("week:2026-11-23", "2026-11-30")).toBe("Last week");
    expect(horizonLabel(null, TODAY)).toBe("");
    expect(horizonLabel("garbage", TODAY)).toBe("");
  });

  it("is a date setting of its own: a day replaces it, it replaces a day and its end", () => {
    expect(separateWhen({ horizon: "week:2026-11-23" })).toEqual({ horizon: "week:2026-11-23", start_date: null, start_time: null, end_date: null, end_time: null });
    expect(separateWhen({ start_date: TODAY })).toEqual({ start_date: TODAY, horizon: null });
    // Taking the date away leaves a horizon as it is; other changes too.
    expect(separateWhen({ start_date: null })).toEqual({ start_date: null });
    expect(separateWhen({ priority: 2 })).toEqual({ priority: 2 });
  });

  it("shows this week's tasks and overdue ones, grouped with the overdue first", () => {
    const now = task({ id: "now", horizon: "week:2026-11-23" });
    const old = task({ id: "old", horizon: "week:2026-11-09" });
    const next = task({ id: "next", horizon: "week:2026-11-30" });
    const dated = task({ id: "dated", start_date: TODAY });
    const done = task({ id: "done", horizon: "week:2026-11-23", status: 1 });
    const data: Data = { lists: [], sections: [], tasks: [now, old, next, dated, done] };
    const view = { kind: "smart", id: "thisweek" } as const;
    const shown = tasksForView(view, data, false, TODAY);
    expect(shown.map((t) => t.id).sort()).toEqual(["now", "old"]);
    expect(dueThisWeek(next, TODAY)).toBe(false);
    const groups = groupTasks(shown, { group_by: "date", sort_by: "priority" }, view, data, TODAY);
    expect(groups.map((g) => [g.key, g.tasks.map((t) => t.id)])).toEqual([["overdue", ["old"]], ["thisweek", ["now"]]]);
    expect(groups.find((g) => g.key === "thisweek")!.patch).toEqual({ horizon: "week:2026-11-23" });
    // An empty This Week keeps its group to drop into.
    expect(groupTasks([], { group_by: "date", sort_by: "priority" }, view, data, TODAY).map((g) => g.key)).toEqual(["thisweek"]);
    // Not in Today or the calendar: it has no day.
    expect(tasksForView({ kind: "smart", id: "today" }, data, false, TODAY).map((t) => t.id)).toEqual(["dated"]);
    // A task added in This Week gets it.
    expect(defaultsForView(view, TODAY)).toEqual({ horizon: "week:2026-11-23" });
  });

  it("has its own group in other views by date, and a day group takes it away", () => {
    const now = task({ id: "w", horizon: "week:2026-11-23" });
    const data: Data = { lists: [], sections: [], tasks: [now] };
    const groups = groupTasks([now], { group_by: "date", sort_by: "manual" }, { kind: "smart", id: "all" }, data, TODAY);
    expect(groups.find((g) => g.tasks.includes(now))!.key).toBe("thisweek");
    expect(groups.find((g) => g.key === "today")!.patch).toEqual({ start_date: TODAY, horizon: null });
    // Grouped by deadline it has none.
    const byDeadline = groupTasks([now], { group_by: "deadline", sort_by: "manual" }, { kind: "smart", id: "all" }, data, TODAY);
    expect(byDeadline.find((g) => g.tasks.includes(now))!.key).toBe("none");
    expect(subgroupTasks([now], "date", TODAY).map((g) => g.key)).toEqual(["thisweek"]);
  });
});
