import { describe, expect, it } from "vitest";
import { advance, describeRepeat, firstDate, formatRule, nextOccurrence, occurrences, parseRule, repeatPresets, sameRule } from "../src/lib/repeat";

const occ = (rule: string, base: string, from: string, to: string) => occurrences(parseRule(rule)!, base, from, to);

describe("repeat rules", () => {
  it("reads TickTick's rules and writes them back the same way", () => {
    for (const text of [
      "FREQ=DAILY;INTERVAL=1",
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH",
      "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=24",
      "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1",
      "FREQ=MONTHLY;INTERVAL=1;BYDAY=2TU",
      "FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR",
      "FREQ=YEARLY;INTERVAL=1;BYMONTH=11;BYMONTHDAY=24",
      "FREQ=WEEKLY;INTERVAL=1;BYDAY=WE;UNTIL=20261020",
      "FREQ=DAILY;INTERVAL=3;COUNT=5;X-FROM=DONE",
    ]) {
      expect(formatRule(parseRule(text)!)).toBe(text);
    }
    expect(parseRule("RRULE:FREQ=WEEKLY;WKST=MO;INTERVAL=1;BYDAY=WE;UNTIL=20261020T000000Z")).toMatchObject({ freq: "WEEKLY", days: [2], until: "2026-10-20" });
    expect(parseRule("FREQ=MONTHLY;BYDAY=TU;BYSETPOS=-1")).toMatchObject({ nth: -1, days: [1] });
    expect(parseRule("FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR")).toMatchObject({ freq: "WEEKLY", days: [0, 1, 2, 3, 4] });
    expect(parseRule("FREQ=HOURLY")).toBeNull();
    expect(parseRule("")).toBeNull();
    expect(parseRule(null)).toBeNull();
  });

  it("finds daily and weekly occurrences, the task's own date first", () => {
    expect(occ("FREQ=DAILY;INTERVAL=2", "2026-11-23", "2026-11-23", "2026-11-30")).toEqual(["2026-11-23", "2026-11-25", "2026-11-27", "2026-11-29"]);
    // Weekly without days: the date's weekday (Monday).
    expect(occ("FREQ=WEEKLY;INTERVAL=1", "2026-11-23", "2026-11-24", "2026-12-14")).toEqual(["2026-11-30", "2026-12-07", "2026-12-14"]);
    // Every second week on Monday and Thursday, from a Thursday.
    expect(occ("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH", "2026-11-26", "2026-11-26", "2026-12-24")).toEqual(["2026-11-26", "2026-12-07", "2026-12-10", "2026-12-21", "2026-12-24"]);
    // Far ahead: found without walking the years between.
    expect(occ("FREQ=DAILY;INTERVAL=1", "2026-01-01", "2036-06-01", "2036-06-03")).toEqual(["2036-06-01", "2036-06-02", "2036-06-03"]);
  });

  it("finds monthly and yearly occurrences", () => {
    // The 31st: months without one are skipped, as in iCalendar.
    expect(occ("FREQ=MONTHLY;INTERVAL=1", "2026-01-31", "2026-01-01", "2026-05-31")).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
    expect(occ("FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1", "2026-01-31", "2026-02-01", "2026-04-30")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
    // Second Tuesday, last Friday.
    expect(occ("FREQ=MONTHLY;INTERVAL=1;BYDAY=2TU", "2026-11-10", "2026-11-11", "2027-01-31")).toEqual(["2026-12-08", "2027-01-12"]);
    expect(occ("FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR", "2026-11-27", "2026-11-28", "2027-01-31")).toEqual(["2026-12-25", "2027-01-29"]);
    expect(occ("FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1,15", "2026-11-15", "2026-11-15", "2026-12-31")).toEqual(["2026-11-15", "2026-12-01", "2026-12-15"]);
    expect(occ("FREQ=YEARLY;INTERVAL=1", "2024-02-29", "2024-03-01", "2032-12-31")).toEqual(["2028-02-29", "2032-02-29"]);
    expect(occ("FREQ=YEARLY;INTERVAL=2", "2026-11-24", "2026-11-25", "2031-01-01")).toEqual(["2028-11-24", "2030-11-24"]);
  });

  it("ends with UNTIL and COUNT", () => {
    expect(occ("FREQ=WEEKLY;INTERVAL=1;UNTIL=20261207", "2026-11-23", "2026-11-01", "2027-01-01")).toEqual(["2026-11-23", "2026-11-30", "2026-12-07"]);
    expect(occ("FREQ=DAILY;INTERVAL=1;COUNT=3", "2026-11-23", "2026-11-24", "2026-12-31")).toEqual(["2026-11-24", "2026-11-25"]);
    expect(nextOccurrence(parseRule("FREQ=DAILY;INTERVAL=1;UNTIL=20261123")!, "2026-11-23", "2026-11-23")).toBeNull();
  });

  it("moves a done task on: after its date, or after today when it was overdue", () => {
    expect(advance("FREQ=WEEKLY;INTERVAL=1", "2026-11-24", "2026-11-23")).toEqual({ date: "2026-12-01", repeat: "FREQ=WEEKLY;INTERVAL=1" });
    // Overdue daily task done today: tomorrow, not the days it missed.
    expect(advance("FREQ=DAILY;INTERVAL=1", "2026-11-20", "2026-11-23")?.date).toBe("2026-11-24");
    // Overdue weekly (Tuesday) done on Thursday: next Tuesday.
    expect(advance("FREQ=WEEKLY;INTERVAL=1", "2026-11-17", "2026-11-19")?.date).toBe("2026-11-24");
    // From completion: today plus the interval; a month from the 31st lands on the 30th.
    expect(advance("FREQ=DAILY;INTERVAL=3;X-FROM=DONE", "2026-11-10", "2026-11-23")?.date).toBe("2026-11-26");
    expect(advance("FREQ=MONTHLY;INTERVAL=1;X-FROM=DONE", "2026-10-01", "2026-10-31")?.date).toBe("2026-11-30");
    // Counted: one fewer each time, over after the last.
    expect(advance("FREQ=DAILY;INTERVAL=1;COUNT=3", "2026-11-23", "2026-11-23")).toEqual({ date: "2026-11-24", repeat: "FREQ=DAILY;INTERVAL=1;COUNT=2" });
    expect(advance("FREQ=DAILY;INTERVAL=1;COUNT=1", "2026-11-23", "2026-11-23")).toBeNull();
    expect(advance("FREQ=DAILY;INTERVAL=1;UNTIL=20261123", "2026-11-23", "2026-11-23")).toBeNull();
    expect(advance("nonsense", "2026-11-23", "2026-11-23")).toBeNull();
  });

  it("starts a dateless task on the first day the rule allows", () => {
    // 2026-11-23 is a Monday.
    expect(firstDate(parseRule("FREQ=WEEKLY;INTERVAL=1;BYDAY=TH")!, "2026-11-23")).toBe("2026-11-26");
    expect(firstDate(parseRule("FREQ=WEEKLY;INTERVAL=1")!, "2026-11-23")).toBe("2026-11-23");
    expect(firstDate(parseRule("FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15")!, "2026-11-23")).toBe("2026-12-15");
    expect(firstDate(parseRule("FREQ=MONTHLY;INTERVAL=1;BYDAY=1MO")!, "2026-11-23")).toBe("2026-12-07");
    expect(firstDate(parseRule("FREQ=WEEKLY;INTERVAL=1;BYDAY=SA,SU")!, "2026-11-23")).toBe("2026-11-28");
  });

  it("describes rules the way TickTick shows them", () => {
    const d = (r: string, base = "2026-11-24", full = false) => describeRepeat(r, base, full);
    expect(d("FREQ=DAILY;INTERVAL=1")).toBe("Daily");
    expect(d("FREQ=DAILY;INTERVAL=2")).toBe("Every 2 days");
    expect(d("FREQ=WEEKLY;INTERVAL=1")).toBe("Weekly on Tu");
    expect(d("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH")).toBe("Every 2 weeks on Mo, Th");
    expect(d("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR")).toBe("Every weekday");
    expect(d("FREQ=MONTHLY;INTERVAL=1")).toBe("Monthly on the 24th");
    expect(d("FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1")).toBe("Monthly on the last day");
    expect(d("FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR")).toBe("Monthly on the last Fr");
    expect(d("FREQ=MONTHLY;INTERVAL=3;BYDAY=2TU")).toBe("Every 3 months on the 2nd Tu");
    expect(d("FREQ=YEARLY;INTERVAL=1")).toBe("Yearly on Nov 24");
    expect(d("FREQ=DAILY;INTERVAL=3;X-FROM=DONE")).toBe("3 days after done");
    expect(d("FREQ=WEEKLY;INTERVAL=1;COUNT=4", "2026-11-24", true)).toBe("Weekly on Tu, 4 left");
    expect(d("FREQ=WEEKLY;INTERVAL=1;UNTIL=20270105", "2026-11-24", true)).toBe("Weekly on Tu, until Jan 5 2027");
    expect(d("")).toBe("");
  });

  it("offers presets from the task's date and spots them again", () => {
    const p = repeatPresets("2026-11-24");
    expect(p.map((x) => `${x.label} ${x.detail}`.trim())).toEqual(["Daily", "Weekly Tuesday", "Monthly 24th", "Yearly Nov 24th", "Every weekday Mon – Fri"]);
    expect(sameRule("FREQ=WEEKLY;INTERVAL=1;COUNT=3", "FREQ=WEEKLY;INTERVAL=1")).toBe(true);
    expect(sameRule("FREQ=WEEKLY;INTERVAL=2", "FREQ=WEEKLY;INTERVAL=1")).toBe(false);
  });
});
