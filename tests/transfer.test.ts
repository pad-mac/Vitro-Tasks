import { describe, expect, it } from "vitest";
import { isTickTickBackup, isVitroCsv, parseCsv, readTickTick, readVitroCsv, writeVitroCsv } from "../src/lib/transfer";
import { memoryDb } from "./helpers";
import { loadAll, put } from "../src/db/repo";
import type { List, Task } from "../src/shared/schema";

const HEAD = `"Folder Name","List Name","Title","Kind","Tags","Content","Is Check list","Start Date","Due Date","Reminder","Repeat","Priority","Status","Created Time","Completed Time","Order","Timezone","Is All Day","Is Floating","Column Name","Column Order","View Mode","taskId","parentId","projectKind"`;
const BACKUP = [
  `﻿"Date: 2026-11-17+0000"`,
  `"Version: 7.2"`,
  `"Status: \n0 Normal\n-1 Abandoned \n2 Completed"`,
  HEAD,
  // all-day range Mon 16 – Sun 22 (TickTick ends it at midnight on the 23rd)
  `"Studies","Seminars","Lektürewoche","TEXT","","","N","2026-11-15T23:00:00+0000","2026-11-22T23:00:00+0000","","","0","0","2026-11-01T10:00:00+0000","","-5","Europe/Berlin","true","false","WS 26-27","2","list","1","","TASK"`,
  // timed, with a link in the notes and a quoted comma
  `"Home","Health","blutabnahme, nüchtern","TEXT","","[Praxis](https://example.org)\nZweite Zeile \\(Labor\\)","N","2026-11-17T07:30:00+0000","2026-11-17T08:15:00+0000","PT0S","FREQ=WEEKLY;INTERVAL=1","5","0","2026-11-02T10:00:00+0000","","-4","Europe/Berlin","false","false","Org","1","list","2","","TASK"`,
  // checklist with open and done items, completed; lines split by bare CR as in real backups
  `"","Kochen","Einkauf","CHECKLIST","gift","Für Sonntag\r▫Oregano\r▪Rosemary\r","Y","","","","","3","2","2026-11-03T10:00:00+0000","2026-11-04T09:00:00+0000","-3","Europe/Berlin","","false","Not Sectioned","","list","3","","TASK"`,
  // subtask of task 2, inbox task, deadline tag
  `"Home","Health","Überweisung holen","TEXT","","","N","","","","","0","0","2026-11-05T10:00:00+0000","","-2","Europe/Berlin","","false","Org","1","list","4","2","TASK"`,
  `"","Inbox","Abgabe Hausarbeit","TEXT","deadline","","N","2026-11-30T23:00:00+0000","2026-11-30T23:00:00+0000","","","5","0","2026-11-06T10:00:00+0000","","-1","Europe/Berlin","true","false","Not Sectioned","","list","5","","TASK"`,
].join("\n");

const COLORS = ["#111111", "#222222"];

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, newlines and CRLF", () => {
    expect(parseCsv('a,"b ""x"", c","multi\nline"\r\n1,2,3\r\n')).toEqual([
      ["a", 'b "x", c', "multi\nline"],
      ["1", "2", "3"],
    ]);
  });
});

describe("TickTick import", () => {
  const r = readTickTick(BACKUP, { lists: [] }, { includeCompleted: true, colors: COLORS, now: 1 });
  const byTitle = (t: string) => r.tasks.find((x) => x.title === t)!;

  it("recognises the file", () => expect(isTickTickBackup(BACKUP)).toBe(true));

  it("turns folders into parent lists and columns into sections", () => {
    const names = r.lists.map((l) => `${l.name}<${r.lists.find((p) => p.id === l.parent_id)?.name ?? ""}`).sort();
    expect(names).toEqual(["Health<Home", "Home<", "Kochen<", "Seminars<Studies", "Studies<"]);
    expect(r.sections.map((s) => s.name).sort()).toEqual(["Org", "WS 26-27"]);
    expect(byTitle("Abgabe Hausarbeit").list_id).toBeNull();
  });

  it("keeps the real last day of all-day ranges", () => {
    expect(byTitle("Lektürewoche")).toMatchObject({ start_date: "2026-11-16", end_date: "2026-11-22", start_time: null });
  });

  it("converts timed tasks to local time and keeps priority", () => {
    expect(byTitle("blutabnahme, nüchtern")).toMatchObject({ start_date: "2026-11-17", start_time: "08:30", end_time: "09:15", end_date: null, priority: 3, notes: "[Praxis](https://example.org)\nZweite Zeile (Labor)" });
  });

  it("makes checklist items subtasks and keeps other lines as notes", () => {
    const list = byTitle("Einkauf");
    expect(list).toMatchObject({ status: 1, notes: "Für Sonntag", priority: 2 });
    const subs = r.tasks.filter((t) => t.parent_id === list.id).map((t) => `${t.title}:${t.status}`);
    expect(subs).toEqual(["Oregano:0", "Rosemary:1"]);
  });

  it("links subtasks and moves them to the parent's list", () => {
    const sub = byTitle("Überweisung holen");
    expect(sub.parent_id).toBe(byTitle("blutabnahme, nüchtern").id);
  });

  it("maps the deadline tag to a deadline and reports what does not carry over", () => {
    expect(byTitle("Abgabe Hausarbeit")).toMatchObject({ start_date: "2026-12-01", deadline_date: "2026-12-01" });
    expect(r.notes).toEqual({ repeating: 1, tags: ["gift"], reminders: 1 });
  });

  it("can leave completed tasks out, and reuses existing lists by name", () => {
    const existing = { lists: [{ id: "mine", name: "studies", parent_id: null }] };
    const r2 = readTickTick(BACKUP, existing, { includeCompleted: false, colors: COLORS, now: 1 });
    expect(r2.tasks.some((t) => t.title === "Einkauf" || t.title === "Oregano")).toBe(false);
    expect(r2.lists.find((l) => l.name === "Seminars")?.parent_id).toBe("mine");
    expect(r2.lists.some((l) => l.name === "Studies")).toBe(false);
  });

  it("gives the same ids on a second import", () => {
    const again = readTickTick(BACKUP, { lists: [] }, { includeCompleted: true, colors: COLORS, now: 2 });
    expect(again.tasks.map((t) => t.id)).toEqual(r.tasks.map((t) => t.id));
  });
});

describe("Vitro CSV", () => {
  it("round-trips lists, sections, tasks and settings through the database", async () => {
    const a = await memoryDb();
    await put(a, "lists", { id: "l1", name: "Research, notes", color: "#5b8def", parent_id: null });
    await put(a, "lists", { id: "l2", name: "Sub", parent_id: "l1" });
    await put(a, "sections", { id: "s1", list_id: "l1", name: "CFP" });
    await put(a, "tasks", { id: "t1", title: 'Say "hi"\nsecond line', list_id: "l1", section_id: "s1", priority: 3, start_date: "2026-11-20", start_time: "14:30", deadline_date: "2026-11-30", created_at: 5 });
    await put(a, "tasks", { id: "t2", title: "child", parent_id: "t1", list_id: "l1", status: 1, completed_at: 9 });
    await put(a, "settings", { id: "listvis:l2", value: '{"all":false}' });
    const data = {
      lists: await loadAll(a, "lists"), sections: await loadAll(a, "sections"),
      tasks: await loadAll(a, "tasks"), settings: await loadAll(a, "settings"),
    } as never;
    const csv = writeVitroCsv(data);
    expect(isVitroCsv(csv)).toBe(true);
    const back = readVitroCsv(csv);
    const t1 = back.tasks!.find((t) => t.id === "t1")!;
    expect(t1).toMatchObject({ title: 'Say "hi"\nsecond line', priority: 3, start_time: "14:30", end_date: null, deadline_date: "2026-11-30", section_id: "s1", created_at: 5 });
    expect(back.tasks!.find((t) => t.id === "t2")).toMatchObject({ parent_id: "t1", status: 1, completed_at: 9 });
    expect((back.lists as unknown as List[]).map((l) => l.name).sort()).toEqual(["Research, notes", "Sub"]);
    expect(back.settings![0]).toMatchObject({ id: "listvis:l2", value: '{"all":false}' });
    // and into a second database
    const b = await memoryDb();
    for (const name of ["lists", "sections", "tasks", "settings"] as const) for (const row of back[name] ?? []) await put(b, name, row);
    expect((await loadAll<Task>(b, "tasks")).length).toBe(2);
  });
  it("refuses other files", () => {
    expect(() => readVitroCsv("a,b\n1,2")).toThrow(/not a Vitro Tasks export/);
  });
});
