// Repeating tasks. A rule is stored on the task in the iCalendar RRULE form
// TickTick uses ("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH"), plus X-FROM=DONE for
// rules that count from the day the task was done instead of its date.
//
// The task's own date is the first occurrence. A rule without days of its own
// ("FREQ=WEEKLY;INTERVAL=1") takes them from that date, so moving the task
// moves the whole series.
//
// All arithmetic is on whole day numbers (days since 1970-01-01), so finding
// the occurrences in a calendar's few weeks never walks the series from its
// start.
import { MONTHS_LONG, pad } from "./dates";

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
/** Two-letter weekday names, Monday first (as TickTick shows them). */
export const DAY_SHORT = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
export const DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface Rule {
  freq: Freq;
  interval: number;
  /** Weekdays, 0 = Monday … 6 = Sunday. WEEKLY: the days (none: the date's own). MONTHLY/YEARLY with `nth`: the one weekday. */
  days: number[];
  /** MONTHLY/YEARLY: which of the month's weekdays, 1–5 or -1 for the last. */
  nth: number | null;
  /** MONTHLY/YEARLY: days of the month, -1 for the last (none: the date's own day). */
  monthDays: number[];
  /** YEARLY: the month, 1–12 (null: the date's own). */
  month: number | null;
  /** Last possible date, inclusive. */
  until: string | null;
  /** Occurrences left, this one included. */
  count: number | null;
  /** The next date counts from the day the task was done. */
  fromDone: boolean;
}

const FREQS: Freq[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

export function newRule(freq: Freq, interval = 1): Rule {
  return { freq, interval, days: [], nth: null, monthDays: [], month: null, until: null, count: null, fromDone: false };
}

// ---------- Day numbers ----------

const DAY_MS = 86400000;
const num = (key: string) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / DAY_MS;
const ymd = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / DAY_MS;
function keyOf(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
/** 0 = Monday. */
const weekday = (n: number) => (((n + 3) % 7) + 7) % 7;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function parts(n: number): [number, number, number] {
  const d = new Date(n * DAY_MS);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

/** The nth (or last, -1) given weekday of a month; null when the month has no such day. */
function nthWeekday(y: number, m: number, nth: number, wd: number): number | null {
  if (nth < 0) {
    const last = ymd(y, m, daysIn(y, m));
    return last - ((weekday(last) - wd + 7) % 7);
  }
  const first = ymd(y, m, 1);
  const n = first + ((wd - weekday(first) + 7) % 7) + 7 * (nth - 1);
  return n <= ymd(y, m, daysIn(y, m)) ? n : null;
}

// ---------- Text form ----------

const cache = new Map<string, Rule | null>();

/** Reads a stored rule (with or without "RRULE:"); null for none or one this app cannot follow. */
export function parseRule(text: string | null | undefined): Rule | null {
  if (!text) return null;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const rule = readRule(text);
  if (cache.size > 1000) cache.clear();
  cache.set(text, rule);
  return rule;
}

function readRule(text: string): Rule | null {
  const kv = new Map<string, string>();
  for (const part of text.trim().replace(/^RRULE:/i, "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) kv.set(part.slice(0, i).trim().toUpperCase(), part.slice(i + 1).trim().toUpperCase());
  }
  let freq = kv.get("FREQ") as Freq;
  if (!FREQS.includes(freq)) return null;
  const interval = Math.max(1, Math.min(999, parseInt(kv.get("INTERVAL") ?? "1", 10) || 1));
  const days: number[] = [];
  let nth: number | null = null;
  for (const d of (kv.get("BYDAY") ?? "").split(",")) {
    const m = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(d.trim());
    if (!m) continue;
    const i = DAY_CODES.indexOf(m[2] as (typeof DAY_CODES)[number]);
    if (!days.includes(i)) days.push(i);
    if (m[1]) nth = ordinal(+m[1]);
  }
  const setpos = parseInt(kv.get("BYSETPOS") ?? "", 10);
  if (Number.isFinite(setpos) && days.length) nth = ordinal(setpos);
  const monthDays = [
    ...new Set(
      (kv.get("BYMONTHDAY") ?? "")
        .split(",")
        .map((x) => parseInt(x, 10))
        .filter((x) => x === -1 || (x >= 1 && x <= 31)),
    ),
  ].sort((a, b) => (a === -1 ? 1 : b === -1 ? -1 : a - b));
  const month = parseInt(kv.get("BYMONTH") ?? "", 10);
  const until = /^(\d{4})(\d{2})(\d{2})/.exec(kv.get("UNTIL") ?? "");
  const count = parseInt(kv.get("COUNT") ?? "", 10);
  // "Every weekday" is sometimes written as a daily rule on some days.
  if (freq === "DAILY" && days.length && interval === 1) freq = "WEEKLY";
  const rule: Rule = {
    freq,
    interval,
    days: freq === "DAILY" ? [] : days.sort((a, b) => a - b),
    nth: freq === "MONTHLY" || freq === "YEARLY" ? nth : null,
    monthDays: freq === "MONTHLY" || freq === "YEARLY" ? monthDays : [],
    month: freq === "YEARLY" && month >= 1 && month <= 12 ? month : null,
    until: until ? `${until[1]}-${until[2]}-${until[3]}` : null,
    count: count >= 1 ? count : null,
    fromDone: kv.get("X-FROM") === "DONE",
  };
  // The nth weekday of a month is one weekday.
  if (rule.nth !== null) {
    rule.days = rule.days.slice(0, 1);
    rule.monthDays = [];
  } else if (rule.freq !== "WEEKLY") rule.days = [];
  return rule;
}

const ordinal = (n: number) => (n < 0 ? -1 : Math.max(1, Math.min(5, n)));

/** The stored form of a rule. */
export function formatRule(r: Rule): string {
  const out = [`FREQ=${r.freq}`, `INTERVAL=${r.interval}`];
  if (r.freq === "YEARLY" && r.month) out.push(`BYMONTH=${r.month}`);
  if ((r.freq === "MONTHLY" || r.freq === "YEARLY") && r.nth === null && r.monthDays.length) out.push(`BYMONTHDAY=${r.monthDays.join(",")}`);
  if (r.days.length && (r.freq === "WEEKLY" || r.nth !== null)) {
    out.push(`BYDAY=${r.days.map((d) => `${r.freq !== "WEEKLY" && r.nth !== null ? r.nth : ""}${DAY_CODES[d]}`).join(",")}`);
  }
  if (r.until) out.push(`UNTIL=${r.until.replace(/-/g, "")}`);
  if (r.count) out.push(`COUNT=${r.count}`);
  if (r.fromDone) out.push("X-FROM=DONE");
  return out.join(";");
}

// ---------- Occurrences ----------

/** The occurrences in the `p`th period (day, week, month or year) after the base's, in order. */
function candidates(r: Rule, b: number, p: number): number[] {
  const [by, bm, bd] = parts(b);
  if (r.freq === "DAILY") return [b + p * r.interval];
  if (r.freq === "WEEKLY") {
    const monday = b - weekday(b) + 7 * r.interval * p;
    return (r.days.length ? r.days : [weekday(b)]).map((d) => monday + d);
  }
  let y: number;
  let m: number;
  if (r.freq === "MONTHLY") {
    const total = bm - 1 + r.interval * p;
    y = by + Math.floor(total / 12);
    m = (total % 12) + 1;
  } else {
    y = by + r.interval * p;
    m = r.month ?? bm;
  }
  if (r.nth !== null) {
    const n = nthWeekday(y, m, r.nth, r.days[0] ?? weekday(b));
    return n === null ? [] : [n];
  }
  const len = daysIn(y, m);
  const out: number[] = [];
  // A day the month does not have (the 31st, February 29th) is skipped, as in iCalendar.
  for (const d of r.monthDays.length ? r.monthDays : [bd]) {
    const day = d === -1 ? len : d;
    if (day <= len) out.push(ymd(y, m, day));
  }
  return [...new Set(out)].sort((a, c) => a - c);
}

/** The period (counted from the base's) a day falls in. */
function periodOf(r: Rule, b: number, n: number): number {
  if (r.freq === "DAILY") return Math.floor((n - b) / r.interval);
  if (r.freq === "WEEKLY") return Math.floor((n - weekday(n) - (b - weekday(b))) / 7 / r.interval);
  const [by, bm] = parts(b);
  const [y, m] = parts(n);
  if (r.freq === "MONTHLY") return Math.floor(((y - by) * 12 + m - bm) / r.interval);
  return Math.floor((y - by) / r.interval);
}

/**
 * Occurrences on or after `from` (day numbers), in order. The base is the
 * first; COUNT and UNTIL end the series.
 */
function* series(r: Rule, b: number, from: number): Generator<number> {
  const until = r.until ? num(r.until) : Infinity;
  let left = r.count ?? Infinity;
  if (b >= from) yield b;
  if (--left <= 0) return;
  // Without a count nothing before `from` matters, so start in its period.
  let p = r.count === null && from > b ? Math.max(0, periodOf(r, b, from) - 1) : 0;
  // Some periods hold nothing (a 31st in a short month); give up after many in a row.
  for (let empty = 0; empty < 400; p++) {
    let any = false;
    for (const n of candidates(r, b, p)) {
      if (n <= b) continue;
      if (n > until) return;
      any = true;
      if (n >= from) yield n;
      if (--left <= 0) return;
    }
    empty = any ? 0 : empty + 1;
  }
}

/** Occurrence dates from `from` to `to` (inclusive); the base's own date counts when in range. */
export function occurrences(rule: Rule, base: string, from: string, to: string, max = 400): string[] {
  const end = num(to);
  const out: string[] = [];
  for (const n of series(rule, num(base), num(from))) {
    if (n > end || out.length >= max) break;
    out.push(keyOf(n));
  }
  return out;
}

/** The first occurrence after `after`; null once the series has ended. */
export function nextOccurrence(rule: Rule, base: string, after: string): string | null {
  for (const n of series(rule, num(base), num(after) + 1)) return keyOf(n);
  return null;
}

/** A date moved on by the rule's interval (a month on the 31st lands on the month's last day). */
function addInterval(r: Rule, key: string): string {
  const n = num(key);
  if (r.freq === "DAILY") return keyOf(n + r.interval);
  if (r.freq === "WEEKLY") return keyOf(n + 7 * r.interval);
  const [y, m, d] = parts(n);
  const total = m - 1 + (r.freq === "MONTHLY" ? r.interval : 12 * r.interval);
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return keyOf(ymd(ny, nm, Math.min(d, daysIn(ny, nm))));
}

/**
 * Where a repeating task goes when it is done on `today`: its next date and
 * its rule (one fewer when counted). Null when the series is over. By due
 * date, the next occurrence after its date, or after today when it was
 * overdue (missed ones are not owed); by completion, today plus the interval.
 */
export function advance(text: string, base: string, today: string): { date: string; repeat: string } | null {
  const rule = parseRule(text);
  if (!rule) return null;
  if (rule.count !== null && rule.count <= 1) return null;
  let date: string | null;
  if (rule.fromDone) {
    date = addInterval(rule, today);
    if (rule.until && date > rule.until) date = null;
  } else date = nextOccurrence(rule, base, base > today ? base : today);
  if (!date) return null;
  return { date, repeat: rule.count !== null ? formatRule({ ...rule, count: rule.count - 1 }) : text };
}

/**
 * The first day on or after `from` that the rule's own days allow, for a task
 * that gets a rule and has no date yet ("every Monday" starts on a Monday).
 */
export function firstDate(rule: Rule, from: string): string {
  const f = num(from);
  const r = { ...rule, interval: 1 };
  for (let p = 0; p < 400; p++) for (const n of candidates(r, f, p)) if (n >= f) return keyOf(n);
  return from;
}

// ---------- Words ----------

const th = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? `${n}th` : `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`);
export const ordinalWord = (n: number) => (n === -1 ? "last" : th(n));
const MONTH_SHORT = MONTHS_LONG.map((m) => m.slice(0, 3));
const WORKDAYS = "0,1,2,3,4";

/** The days a rule falls on, in words, for its base date: "on Tu", "on the 24th", "on Nov 24". */
function onWords(r: Rule, base: string | null): string {
  const b = base ? num(base) : null;
  const [, bm, bd] = b !== null ? parts(b) : [0, 0, 0];
  if (r.freq === "WEEKLY") {
    const days = r.days.length ? r.days : b !== null ? [weekday(b)] : [];
    return days.length ? `on ${days.map((d) => DAY_SHORT[d]).join(", ")}` : "";
  }
  if (r.freq === "DAILY") return "";
  const nthPart = () => `on the ${ordinalWord(r.nth!)} ${DAY_SHORT[r.days[0] ?? (b !== null ? weekday(b) : 0)]}`;
  const dayPart = () => {
    const days = r.monthDays.length ? r.monthDays : bd ? [bd] : [];
    return days.length ? days.map((d) => (d === -1 ? "last day" : th(d))).join(", ") : "";
  };
  if (r.freq === "MONTHLY") {
    if (r.nth !== null) return nthPart();
    const d = dayPart();
    return d ? `on the ${d}` : "";
  }
  const month = r.month ?? bm;
  if (r.nth !== null) return month ? `${nthPart()} of ${MONTH_SHORT[month - 1]}` : nthPart();
  const days = r.monthDays.length ? r.monthDays : bd ? [bd] : [];
  if (!month || !days.length) return "";
  return `on ${MONTH_SHORT[month - 1]} ${days.map((d) => (d === -1 ? "last" : d)).join(", ")}`;
}

const UNIT = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" } as const;
const PLAIN = { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly" } as const;

/**
 * A rule in words, the way it reads on the task: "Daily", "Weekly on Tu",
 * "Every 2 weeks on Mo, Th", "Monthly on the last day", "Every weekday".
 * `full` adds how it ends and whether it counts from completion.
 */
export function describeRule(r: Rule, base: string | null, full = false): string {
  let text: string;
  if (r.fromDone) {
    text = r.interval === 1 ? `A ${UNIT[r.freq]} after done` : `${r.interval} ${UNIT[r.freq]}s after done`;
  } else if (r.freq === "WEEKLY" && r.interval === 1 && r.days.join(",") === WORKDAYS) {
    text = "Every weekday";
  } else if (r.freq === "WEEKLY" && r.interval === 1 && r.days.join(",") === "5,6") {
    text = "Every weekend";
  } else {
    const on = onWords(r, base);
    const head = r.interval === 1 ? PLAIN[r.freq] : `Every ${r.interval} ${UNIT[r.freq]}s`;
    text = on ? `${head} ${on}` : head;
  }
  if (full) {
    if (r.count) text += r.count === 1 ? ", last one" : `, ${r.count} left`;
    else if (r.until) {
      const [y, m, d] = parts(num(r.until));
      text += `, until ${MONTH_SHORT[m - 1]} ${d}${base && base.slice(0, 4) === String(y) ? "" : ` ${y}`}`;
    }
  }
  return text;
}

/** The stored rule in words (empty when there is none). */
export function describeRepeat(text: string | null | undefined, base: string | null, full = false): string {
  const r = parseRule(text);
  return r ? describeRule(r, base, full) : "";
}

/** The quick choices, as in TickTick: their stored rules take the day from the task's date. */
export function repeatPresets(base: string): { label: string; detail: string; repeat: string }[] {
  const b = num(base);
  const [, m, d] = parts(b);
  return [
    { label: "Daily", detail: "", repeat: "FREQ=DAILY;INTERVAL=1" },
    { label: "Weekly", detail: DAY_LONG[weekday(b)], repeat: "FREQ=WEEKLY;INTERVAL=1" },
    { label: "Monthly", detail: th(d), repeat: "FREQ=MONTHLY;INTERVAL=1" },
    { label: "Yearly", detail: `${MONTH_SHORT[m - 1]} ${th(d)}`, repeat: "FREQ=YEARLY;INTERVAL=1" },
    { label: "Every weekday", detail: "Mon – Fri", repeat: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR" },
  ];
}

/** A rule without the days its base date gives anyway ("weekly on Tu" for a Tuesday is plain weekly). */
function bare(r: Rule, base: string | null): Rule {
  const out = { ...r, until: null, count: null };
  if (!base) return out;
  const n = num(base);
  const [, m, d] = parts(n);
  if (out.freq === "WEEKLY" && out.days.length === 1 && out.days[0] === weekday(n)) out.days = [];
  if ((out.freq === "MONTHLY" || out.freq === "YEARLY") && out.nth === null && out.monthDays.length === 1 && out.monthDays[0] === d) out.monthDays = [];
  if (out.freq === "YEARLY" && out.month === m) out.month = null;
  return out;
}

/** Two stored rules that mean the same for a task on `base` (the ending aside), e.g. to mark the active preset. */
export function sameRule(a: string | null | undefined, b: string | null | undefined, base: string | null = null): boolean {
  const x = parseRule(a);
  const y = parseRule(b);
  if (!x || !y) return !x && !y;
  return formatRule(bare(x, base)) === formatRule(bare(y, base));
}

/** A date's weekday, day of the month, month and which of its weekdays it is, for the custom editor. */
export function dateParts(key: string): { weekday: number; day: number; month: number; nth: number } {
  const n = num(key);
  const [, m, d] = parts(n);
  return { weekday: weekday(n), day: d, month: m, nth: d > 28 ? -1 : Math.ceil(d / 7) };
}
