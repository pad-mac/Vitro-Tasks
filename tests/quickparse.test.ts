import { describe, expect, it } from "vitest";
import { matchList, parseQuick, repeatSuggestions } from "../src/lib/quickparse";

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

describe("repeats in quick add", () => {
  // TODAY is Monday 2026-11-16.
  const rep = (text: string) => {
    const r = parseQuick(text, TODAY);
    return { title: r.title, repeat: r.repeat, start: r.start_date };
  };
  it("reads English phrases", () => {
    expect(rep("Standup daily")).toEqual({ title: "Standup", repeat: "FREQ=DAILY;INTERVAL=1", start: TODAY });
    expect(rep("Water plants every day")).toMatchObject({ title: "Water plants", repeat: "FREQ=DAILY;INTERVAL=1" });
    expect(rep("Review every week")).toMatchObject({ repeat: "FREQ=WEEKLY;INTERVAL=1", start: TODAY });
    expect(rep("Pay rent every month")).toMatchObject({ repeat: "FREQ=MONTHLY;INTERVAL=1" });
    expect(rep("Taxes yearly")).toMatchObject({ repeat: "FREQ=YEARLY;INTERVAL=1" });
    expect(rep("Sheets every other week")).toMatchObject({ title: "Sheets", repeat: "FREQ=WEEKLY;INTERVAL=2" });
    expect(rep("Backup every second day")).toMatchObject({ repeat: "FREQ=DAILY;INTERVAL=2" });
    expect(rep("Filter every 3 months")).toMatchObject({ repeat: "FREQ=MONTHLY;INTERVAL=3" });
    expect(rep("Check every third week")).toMatchObject({ repeat: "FREQ=WEEKLY;INTERVAL=3" });
    expect(rep("Gym every mon and thu")).toEqual({ title: "Gym", repeat: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH", start: TODAY });
    expect(rep("Yoga every tuesday")).toEqual({ title: "Yoga", repeat: "FREQ=WEEKLY;INTERVAL=1;BYDAY=TU", start: "2026-11-17" });
    expect(rep("Team call every 2 weeks on mon, wed")).toMatchObject({ title: "Team call", repeat: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE" });
    expect(rep("Mail every weekday")).toMatchObject({ repeat: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR" });
    expect(rep("Hike every weekend")).toMatchObject({ repeat: "FREQ=WEEKLY;INTERVAL=1;BYDAY=SA,SU", start: "2026-11-21" });
    expect(rep("Invoice every 15th")).toMatchObject({ title: "Invoice", repeat: "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15", start: "2026-12-15" });
    expect(rep("Jour fixe every first monday")).toMatchObject({ title: "Jour fixe", repeat: "FREQ=MONTHLY;INTERVAL=1;BYDAY=1MO", start: "2026-12-07" });
    expect(rep("Report every last friday")).toMatchObject({ repeat: "FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR", start: "2026-11-27" });
    expect(rep("Cleaning every other saturday")).toMatchObject({ repeat: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA" });
  });

  it("reads German phrases", () => {
    expect(rep("Müll montags")).toMatchObject({ title: "Müll", repeat: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO", start: TODAY });
    expect(rep("Lesen täglich")).toMatchObject({ repeat: "FREQ=DAILY;INTERVAL=1" });
    expect(rep("Sport jeden Montag und Donnerstag")).toMatchObject({ title: "Sport", repeat: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH" });
    expect(rep("Putzen jede zweite Woche")).toMatchObject({ title: "Putzen", repeat: "FREQ=WEEKLY;INTERVAL=2" });
    expect(rep("Gießen alle 3 Tage")).toMatchObject({ title: "Gießen", repeat: "FREQ=DAILY;INTERVAL=3" });
    expect(rep("Miete jeden Monat")).toMatchObject({ repeat: "FREQ=MONTHLY;INTERVAL=1" });
    expect(rep("Abrechnung jeden 15.")).toMatchObject({ repeat: "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15" });
    expect(rep("Mails werktags")).toMatchObject({ repeat: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR" });
    expect(rep("Treffen jeden do")).toMatchObject({ title: "Treffen", repeat: "FREQ=WEEKLY;INTERVAL=1;BYDAY=TH", start: "2026-11-19" });
  });

  it("takes a typed date and time along, and leaves ordinary words alone", () => {
    expect(rep("Review weekly fri")).toMatchObject({ repeat: "FREQ=WEEKLY;INTERVAL=1", start: "2026-11-20" });
    const r = parseQuick("Call every monday 9:00 !high", TODAY);
    expect(r).toMatchObject({ title: "Call", start_date: TODAY, start_time: "09:00", priority: 3, repeat: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO" });
    expect(rep("Read every book")).toEqual({ title: "Read every book", repeat: null, start: null });
    expect(rep("Rechnungen für alle")).toEqual({ title: "Rechnungen für alle", repeat: null, start: null });
    expect(rep("Termine alle verschieben")).toMatchObject({ repeat: null });
  });

  it("suggests phrases while one is typed", () => {
    expect(repeatSuggestions("Gym every ", TODAY)?.items.map((x) => x.phrase).slice(0, 3)).toEqual(["every day", "every weekday", "every week"]);
    expect(repeatSuggestions("Gym every w", TODAY)?.items.map((x) => `${x.phrase}: ${x.label}`)).toEqual([
      "every weekday: Every weekday", "every week: Weekly on Mo", "every weekend: Every weekend", "every wednesday: Weekly on We",
    ]);
    expect(repeatSuggestions("Putzen alle 2", TODAY)?.items.map((x) => x.phrase)).toEqual(["alle 2 Tage", "alle 2 Wochen", "alle 2 Monate", "alle 2 Jahre"]);
    expect(repeatSuggestions("Sport jeden m", TODAY)?.items.map((x) => x.phrase)).toEqual(["jeden Monat", "jeden Montag", "jeden Mittwoch"]);
    expect(repeatSuggestions("Gym every", TODAY)).toBeNull();
    expect(repeatSuggestions("für alle ", TODAY)).toBeNull();
    expect(repeatSuggestions("Read every book", TODAY)).toBeNull();
  });
});

describe("priority shorthands", () => {
  it("reads ! !! !!! and p1 p2 p3 as low, medium, high", () => {
    expect(parseQuick("Call ! ", "2026-11-16")).toMatchObject({ title: "Call", priority: 1 });
    expect(parseQuick("Call !!", "2026-11-16")).toMatchObject({ title: "Call", priority: 2 });
    expect(parseQuick("Call !!! tomorrow", "2026-11-16")).toMatchObject({ title: "Call", priority: 3, start_date: "2026-11-17" });
    expect(parseQuick("Call p1", "2026-11-16").priority).toBe(1);
    expect(parseQuick("Call P2", "2026-11-16").priority).toBe(2);
    expect(parseQuick("p3 Call", "2026-11-16")).toMatchObject({ title: "Call", priority: 3 });
    expect(parseQuick("Wow!! great", "2026-11-16")).toMatchObject({ title: "Wow!! great", priority: 0 });
    expect(parseQuick("Read p4 and p12", "2026-11-16")).toMatchObject({ title: "Read p4 and p12", priority: 0 });
  });
});
