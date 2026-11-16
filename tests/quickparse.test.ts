import { describe, expect, it } from "vitest";
import { matchList, parseQuick } from "../src/lib/quickparse";

// Monday
const TODAY = "2026-11-16";

describe("parseQuick", () => {
  it("keeps a plain title untouched", () => {
    const r = parseQuick("Write abstract for the volume", TODAY);
    expect(r.title).toBe("Write abstract for the volume");
    expect(r.start_date).toBeNull();
    expect(r.deadline_date).toBeNull();
    expect(r.priority).toBe(0);
  });

  it("reads planned date, time, priority and list", () => {
    const r = parseQuick("Call printer tomorrow 14:30 !high #kassung", TODAY);
    expect(r).toMatchObject({
      title: "Call printer",
      start_date: "2026-11-17",
      start_time: "14:30",
      priority: 3,
      listQuery: "kassung",
    });
  });

  it("reads a deadline separately from the planned date", () => {
    const r = parseQuick("Draft chapter wed ^30.11.", TODAY);
    expect(r.title).toBe("Draft chapter");
    expect(r.start_date).toBe("2026-11-18");
    expect(r.deadline_date).toBe("2026-11-30");
  });

  it("attaches a time to the deadline when it follows the deadline", () => {
    const r = parseQuick("Submit form ^fri 12:00", TODAY);
    expect(r.deadline_date).toBe("2026-11-20");
    expect(r.deadline_time).toBe("12:00");
    expect(r.start_date).toBeNull();
  });

  it("treats a weekday equal to today as next week", () => {
    expect(parseQuick("Review mon", TODAY).start_date).toBe("2026-11-23");
  });

  it("rolls a past day.month into next year", () => {
    expect(parseQuick("Taxes 01.03.", TODAY).start_date).toBe("2027-03-01");
  });

  it("supports ISO dates, relative spans and German words", () => {
    expect(parseQuick("A 2026-12-24", TODAY).start_date).toBe("2026-12-24");
    expect(parseQuick("B in 3 days", TODAY).start_date).toBe("2026-11-19");
    expect(parseQuick("C in 2 weeks", TODAY).start_date).toBe("2026-11-30");
    expect(parseQuick("D morgen", TODAY).start_date).toBe("2026-11-17");
  });

  it("does not eat German two-letter words in the middle of a title", () => {
    const r = parseQuick("so do it", TODAY);
    expect(r.title).toBe("so do it");
    expect(r.start_date).toBeNull();
  });

  it("ignores invalid dates and times", () => {
    const r = parseQuick("Meeting 31.02. 25:00", TODAY);
    expect(r.title).toBe("Meeting 31.02. 25:00");
    expect(r.start_date).toBeNull();
  });

  it("a bare time implies today", () => {
    expect(parseQuick("Standup 09:00", TODAY)).toMatchObject({ start_date: TODAY, start_time: "09:00", dateImplied: true });
    expect(parseQuick("Standup 09:00 fri", TODAY)).toMatchObject({ start_date: "2026-11-20", dateImplied: false });
  });
});

describe("matchList", () => {
  const lists = [
    { id: "1", name: "Research" },
    { id: "2", name: "Seminars - Add" },
    { id: "3", name: "Seminars" },
  ];
  it("prefers exact, then prefix, then substring", () => {
    expect(matchList("seminars", lists)?.id).toBe("3");
    expect(matchList("res", lists)?.id).toBe("1");
    expect(matchList("add", lists)?.id).toBe("2");
    expect(matchList("nope", lists)).toBeNull();
  });
});
