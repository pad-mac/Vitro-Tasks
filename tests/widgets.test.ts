import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../src/lib/widgets";
import { SMART_DEFAULTS, type ViewRef } from "../src/lib/views";
import type { List, Task } from "../src/shared/schema";

const TODAY = "2026-11-24"; // a Tuesday
let n = 0;
const task = (p: Partial<Task>): Task => ({
  id: `t${++n}`, list_id: null, section_id: null, parent_id: null, title: `task ${n}`, notes: "",
  priority: 0, status: 0, start_date: null, start_time: null, end_date: null, end_time: null,
  deadline_date: null, deadline_time: null, completed_at: null, position: n, pinned: 0,
  created_at: n, updated_at: n, deleted: 0, repeat: null, ...p,
});
const list = (id: string, p: Partial<List> = {}): List =>
  ({ id, name: id, color: "#0088ff", parent_id: null, position: 1, view_mode: "list", group_by: "none", sort_by: "manual", updated_at: 0, deleted: 0, ...p }) as List;
const prefsOf = (lists: List[]) => (v: ViewRef) => {
  if (v.kind === "list") {
    const l = lists.find((x) => x.id === v.id)!;
    return { view_mode: l.view_mode, group_by: l.group_by, sort_by: l.sort_by };
  }
  return SMART_DEFAULTS[v.kind === "smart" ? v.id : "all"];
};

describe("widget snapshot", () => {
  it("lists every smart view and list in sidebar order, with counts and subtasks", () => {
    const lists = [list("work", { position: 1 }), list("home", { position: 2 }), list("sub", { parent_id: "work", position: 1 })];
    const a = task({ list_id: "work", title: "A", priority: 3 });
    const kid = task({ list_id: "work", parent_id: a.id, title: "A1" });
    const doneKid = task({ list_id: "work", parent_id: a.id, title: "A2", status: 1 });
    const b = task({ list_id: "sub", title: "B" });
    const snap = buildSnapshot({ lists, sections: [], tasks: [a, kid, doneKid, b], settings: {} }, prefsOf(lists), TODAY, 1);
    expect(snap.views.map((v) => v.id)).toEqual(["today", "next7", "all", "inbox", "deadlines", "work", "sub", "home"]);
    const work = snap.views.find((v) => v.id === "work")!;
    expect(work.depth).toBe(0);
    expect(snap.views.find((v) => v.id === "sub")!.depth).toBe(1);
    // The list holds its sublist's tasks too; open subtasks follow their parent.
    expect(work.count).toBe(2);
    expect(work.rows.map((r) => [r.title, r.parent ?? null])).toEqual([["A", null], ["A1", a.id], ["B", null]]);
    expect(work.rows[0].p).toBe(3);
  });

  it("Today carries tomorrow's newcomers for a widget drawn after midnight", () => {
    const lists: List[] = [];
    const overdue = task({ start_date: "2026-11-20", title: "late" });
    const today = task({ start_date: TODAY, start_time: "09:30", title: "now" });
    const tomorrow = task({ start_date: "2026-11-25", title: "next" });
    const later = task({ start_date: "2026-11-28", title: "later" });
    const snap = buildSnapshot({ lists, sections: [], tasks: [overdue, today, tomorrow, later], settings: {} }, prefsOf(lists), TODAY, 1);
    const view = snap.views.find((v) => v.id === "today")!;
    expect(view.filter).toBe("today");
    expect(view.count).toBe(2);
    expect(view.rows.map((r) => r.title)).toEqual(["late", "now", "next"]);
    expect(view.rows.find((r) => r.title === "next")!.first).toBe("2026-11-25");
    expect(view.rows.find((r) => r.title === "now")).toMatchObject({ date: TODAY, time: "09:30" });
    expect(snap.views.find((v) => v.id === "next7")!.rows.map((r) => r.title)).toEqual(["late", "now", "next", "later"]);
  });

  it("calendar days: timed entries in minutes, all-day ones without, deadlines apart, repeats projected", () => {
    const lists = [list("work", { color: "#ff383c" })];
    const meeting = task({ list_id: "work", start_date: TODAY, start_time: "14:00", end_time: "15:30", title: "meeting" });
    const allDay = task({ start_date: TODAY, title: "all day" });
    const due = task({ deadline_date: TODAY, deadline_time: "17:00", title: "due" });
    const span = task({ start_date: "2026-11-23", end_date: "2026-11-25", start_time: "10:00", title: "trip" });
    const weekly = task({ start_date: TODAY, repeat: "FREQ=WEEKLY", title: "weekly" });
    const snap = buildSnapshot({ lists, sections: [], tasks: [meeting, allDay, due, span, weekly], settings: {} }, prefsOf(lists), TODAY, 1);
    expect(snap.from).toBe("2026-11-16");
    expect(snap.to).toBe("2026-12-27");
    const day = snap.days[TODAY];
    const by = (t: string) => day.find((e) => e.title === t)!;
    expect(by("meeting")).toMatchObject({ start: 14 * 60, end: 15 * 60 + 30, color: "#ff383c", task: meeting.id });
    expect(by("all day")).toMatchObject({ start: null, end: null, color: null });
    expect(by("due")).toMatchObject({ id: `${due.id}:d`, deadline: 1, start: 17 * 60, end: 17 * 60 + 30 });
    // A span over several days is all day on each of them.
    expect(by("trip").start).toBeNull();
    expect(snap.days["2026-11-25"].some((e) => e.title === "trip")).toBe(true);
    // The repeat's later dates open the real task.
    const next = snap.days["2026-12-01"].find((e) => e.title === "weekly")!;
    expect(next.task).toBe(weekly.id);
    expect(next.id).toBe(`${weekly.id}~2026-12-01`);
  });

  it("leaves out lists hidden from the calendar and completed tasks", () => {
    const lists = [list("quiet")];
    const hidden = task({ list_id: "quiet", start_date: TODAY, title: "hidden" });
    const done = task({ start_date: TODAY, status: 1, title: "done" });
    const snap = buildSnapshot(
      { lists, sections: [], tasks: [hidden, done], settings: { "listvis:quiet": JSON.stringify({ calendar: false }) } },
      prefsOf(lists), TODAY, 1,
    );
    expect(snap.days[TODAY]).toBeUndefined();
    expect(snap.views.find((v) => v.id === "quiet")!.rows.map((r) => r.title)).toEqual(["hidden"]);
  });
});
