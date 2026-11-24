// Parser for the quick add bar. Recognised tokens are removed from the title:
//   today / tomorrow / mon..sun / 24.12. / 2026-12-24 / in 3 days   -> planned date
//   14:30                                                            -> planned time
//   ^fri  ^24.12.  ^2026-12-24  (any date token with a ^ prefix)     -> hard deadline
//   !1 !2 !3  or  !low !med !high  or  ! !! !!!  or  p1 p2 p3       -> priority (low … high)
//   #listname                                                        -> list (prefix match)
//   daily / weekly / every day / every other week / every 2 months /
//   every mon and thu / every weekday / every 15th / every last fri  -> repeat
// German words work too (heute, morgen, mo..so, täglich, jeden Montag,
// jede zweite Woche, alle 3 Monate, werktags, montags).
import { addDays, pad, startOfWeek, todayKey, toKey } from "./dates";
import { describeRepeat, firstDate, formatRule, newRule, parseRule, type Freq, type Rule } from "./repeat";

export interface QuickParse {
  title: string;
  start_date: string | null;
  start_time: string | null;
  /** True when only a time was typed and today was assumed as the date. */
  dateImplied: boolean;
  deadline_date: string | null;
  deadline_time: string | null;
  priority: number;
  /** Text after '#', to be matched against list names by the caller. */
  listQuery: string | null;
  /** Repeat rule (see lib/repeat); the planned date is then its first day (implied when none was typed). */
  repeat: string | null;
}

const WEEKDAY_WORDS: Record<string, number> = {
  mon: 0, monday: 0, mo: 0, montag: 0,
  tue: 1, tuesday: 1, di: 1, dienstag: 1,
  wed: 2, wednesday: 2, mi: 2, mittwoch: 2,
  thu: 3, thursday: 3, do: 3, donnerstag: 3,
  fri: 4, friday: 4, fr: 4, freitag: 4,
  sat: 5, saturday: 5, sa: 5, samstag: 5,
  sun: 6, sunday: 6, so: 6, sonntag: 6,
};

const PRIORITY_WORDS: Record<string, number> = {
  "1": 1, low: 1, "2": 2, med: 2, medium: 2, "3": 3, high: 3,
};

function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return toKey(dt);
}

/** Resolves a single date word; returns null if the word is not a date. */
export function parseDateWord(word: string, today: string): string | null {
  const w = word.toLowerCase();
  if (w === "today" || w === "heute" || w === "tod") return today;
  if (w === "tomorrow" || w === "morgen" || w === "tmr" || w === "tom") return addDays(today, 1);
  if (w in WEEKDAY_WORDS) {
    // Next occurrence of that weekday, never today.
    const target = addDays(startOfWeek(today), WEEKDAY_WORDS[w]);
    return target > today ? target : addDays(target, 7);
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(w);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?$/.exec(w);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : +today.slice(0, 4);
    const key = validDate(year, +m[2], +m[1]);
    // A day.month without a year that already passed means next year.
    if (key && !m[3] && key < today) return validDate(year + 1, +m[2], +m[1]);
    return key;
  }
  return null;
}

function parseTimeWord(word: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(word);
  if (!m) return null;
  const h = +m[1];
  const min = +m[2];
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

export function parseQuick(input: string, today = todayKey()): QuickParse {
  const out: QuickParse = {
    title: "",
    start_date: null,
    start_time: null,
    dateImplied: false,
    deadline_date: null,
    deadline_time: null,
    priority: 0,
    listQuery: null,
    repeat: null,
  };
  const words = input.trim().split(/\s+/).filter(Boolean);
  const keep: string[] = [];
  let lastDateTarget: "start" | "deadline" | null = null;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    // !1 !2 !3, !low !med !high, ! !! !!!, p1 p2 p3: low, medium, high.
    if (/^!{1,3}$/.test(word)) {
      out.priority = word.length;
      continue;
    }
    const pn = /^p([1-3])$/i.exec(word);
    if (pn) {
      out.priority = +pn[1];
      continue;
    }
    if (word.startsWith("!") && word.length > 1) {
      const p = PRIORITY_WORDS[word.slice(1).toLowerCase()];
      if (p !== undefined) {
        out.priority = p;
        continue;
      }
    }
    if (word.startsWith("#") && word.length > 1) {
      out.listQuery = word.slice(1);
      continue;
    }
    if (word.startsWith("^") && word.length > 1) {
      const d = parseDateWord(word.slice(1), today);
      if (d) {
        out.deadline_date = d;
        lastDateTarget = "deadline";
        continue;
      }
    }
    const rep = matchRepeat(words, i);
    if (rep) {
      out.repeat = formatRule(rep.rule);
      i += rep.used - 1;
      lastDateTarget = "start";
      continue;
    }
    // "in 3 days" / "in 2 weeks"
    if (word.toLowerCase() === "in" && i + 2 < words.length && /^\d+$/.test(words[i + 1] ?? "")) {
      const unit = (words[i + 2] ?? "").toLowerCase();
      const n = +words[i + 1];
      const days = /^(d|day|days|tag|tage|tagen)$/.test(unit) ? n : /^(w|week|weeks|woche|wochen)$/.test(unit) ? n * 7 : null;
      if (days !== null) {
        out.start_date = addDays(today, days);
        lastDateTarget = "start";
        i += 2;
        continue;
      }
    }
    const time = parseTimeWord(word);
    if (time) {
      // A time belongs to the date token right before it, else to the planned date.
      if (lastDateTarget === "deadline") out.deadline_time = time;
      else {
        out.start_time = time;
        if (!out.start_date) {
          out.start_date = today;
          out.dateImplied = true;
        }
      }
      continue;
    }
    const date = parseDateWord(word, today);
    // Two-letter German weekday shorthands collide with real words ("do", "so", "mi"):
    // only accept them as the very last word.
    const ambiguous = /^(mo|di|mi|do|fr|sa|so)$/i.test(word) && i !== words.length - 1;
    if (date && !ambiguous) {
      out.start_date = date;
      out.dateImplied = false;
      lastDateTarget = "start";
      continue;
    }
    lastDateTarget = null;
    keep.push(word);
  }
  out.title = keep.join(" ");
  if (out.repeat) {
    // The series starts on the typed date, or on the first day its rule allows.
    const rule = parseRule(out.repeat)!;
    const own = rule.days.length || rule.monthDays.length || rule.nth !== null;
    if (!out.start_date) {
      out.start_date = firstDate(rule, today);
      out.dateImplied = true;
    } else if (own) out.start_date = firstDate(rule, out.start_date);
  }
  return out;
}

// ---------- Repeats ----------

const lower = (w: string | undefined) => (w ?? "").toLowerCase().replace(/[,;]+$/, "");
const UNIT_WORDS: Record<string, Freq> = {
  day: "DAILY", days: "DAILY", tag: "DAILY", tage: "DAILY", tagen: "DAILY",
  week: "WEEKLY", weeks: "WEEKLY", woche: "WEEKLY", wochen: "WEEKLY",
  month: "MONTHLY", months: "MONTHLY", monat: "MONTHLY", monate: "MONTHLY", monaten: "MONTHLY",
  year: "YEARLY", years: "YEARLY", jahr: "YEARLY", jahre: "YEARLY", jahren: "YEARLY",
};
const ADVERBS: Record<string, [Freq, number, number[]?]> = {
  daily: ["DAILY", 1], täglich: ["DAILY", 1], taeglich: ["DAILY", 1],
  weekly: ["WEEKLY", 1], wöchentlich: ["WEEKLY", 1], woechentlich: ["WEEKLY", 1],
  biweekly: ["WEEKLY", 2], fortnightly: ["WEEKLY", 2], zweiwöchentlich: ["WEEKLY", 2],
  monthly: ["MONTHLY", 1], monatlich: ["MONTHLY", 1],
  yearly: ["YEARLY", 1], annually: ["YEARLY", 1], jährlich: ["YEARLY", 1], jaehrlich: ["YEARLY", 1],
  werktags: ["WEEKLY", 1, [0, 1, 2, 3, 4]], weekdays: ["WEEKLY", 1, [0, 1, 2, 3, 4]],
};
/** "other", "second", "3rd", "zweiten": how many; ordinals also name the nth weekday of a month. */
const ORDINALS: Record<string, number> = {
  first: 1, "1st": 1, erste: 1, ersten: 1, erstes: 1,
  other: 2, second: 2, "2nd": 2, zweite: 2, zweiten: 2, zweites: 2, anderen: 2,
  third: 3, "3rd": 3, dritte: 3, dritten: 3, drittes: 3,
  fourth: 4, "4th": 4, vierte: 4, vierten: 4, viertes: 4,
  fifth: 5, "5th": 5, fünfte: 5, fünften: 5, fünftes: 5,
  last: -1, letzte: -1, letzten: -1, letztes: -1,
};
const COUNTS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6 };
const WORKDAY_WORDS = new Set(["weekday", "weekdays", "workday", "workdays", "werktag", "werktage"]);
const WEEKEND_WORDS = new Set(["weekend", "weekends", "wochenende", "wochenenden"]);
const EVERY = new Set(["every", "jeden", "jede", "jedes", "alle"]);

/** A weekday word, also plural ("mondays", "montags"); two-letter German ones count here (after "every"). */
function weekdayOf(word: string | undefined): number | null {
  const w = lower(word);
  if (w in WEEKDAY_WORDS) return WEEKDAY_WORDS[w];
  if (w.length > 4 && w.endsWith("s") && w.slice(0, -1) in WEEKDAY_WORDS) return WEEKDAY_WORDS[w.slice(0, -1)];
  return null;
}

/** Weekdays from `j` on: "mon wed", "mon, wed and fri", "Montag und Donnerstag". */
function readDays(words: string[], j: number): { days: number[]; next: number } {
  const days: number[] = [];
  let k = j;
  while (k < words.length) {
    const d = weekdayOf(words[k]);
    if (d === null) break;
    if (!days.includes(d)) days.push(d);
    k++;
    const sep = lower(words[k]);
    if ((sep === "and" || sep === "und" || sep === "&") && weekdayOf(words[k + 1]) !== null) k++;
  }
  return { days: days.sort((a, b) => a - b), next: k };
}

/** A repeat phrase starting at word `i`, and how many words it takes. */
export function matchRepeat(words: string[], i: number): { rule: Rule; used: number } | null {
  const w = lower(words[i]);
  const adverb = ADVERBS[w];
  if (adverb) return { rule: { ...newRule(adverb[0], adverb[1]), days: adverb[2] ?? [] }, used: 1 };
  // "montags", "mondays": every week on that day.
  if (w.length > 4 && w.endsWith("s") && weekdayOf(w) !== null && !(w in WEEKDAY_WORDS)) {
    const { days, next } = readDays(words, i);
    return { rule: { ...newRule("WEEKLY"), days }, used: next - i };
  }
  if (!EVERY.has(w)) return null;
  let j = i + 1;
  let interval = 1;
  let nth: number | null = null;
  const n = lower(words[j]);
  // "every 15th", "jeden 15.": a day of the month.
  const dayOfMonth = /^(\d{1,2})(st|nd|rd|th|\.)$/.exec(n);
  if (dayOfMonth && +dayOfMonth[1] >= 1 && +dayOfMonth[1] <= 31 && !(lower(words[j + 1]) in UNIT_WORDS) && weekdayOf(words[j + 1]) === null) {
    return { rule: { ...newRule("MONTHLY"), monthDays: [+dayOfMonth[1]] }, used: 2 };
  }
  if (/^\d{1,3}$/.test(n) && +n >= 1) {
    interval = +n;
    j++;
  } else if (n in COUNTS) {
    interval = COUNTS[n];
    j++;
  } else if (n in ORDINALS || /^\d{1,2}(st|nd|rd|th)$/.test(n)) {
    const o = ORDINALS[n] ?? parseInt(n, 10);
    j++;
    // "every third week": how many. "every other/second Monday" is every two weeks;
    // "every first/third/last Monday" one of the month's.
    if (lower(words[j]) in UNIT_WORDS) {
      if (o < 1) return null;
      interval = o;
    } else if (o === 2) interval = 2;
    else nth = o;
  }
  // "alle" needs its number: "alle 2 Wochen" (on its own it is just "all").
  if (w === "alle" && j === i + 1) return null;
  const unitWord = lower(words[j]);
  if (unitWord in UNIT_WORDS && nth === null) {
    const freq = UNIT_WORDS[unitWord];
    j++;
    // "every 2 weeks on mon, thu"
    if (freq === "WEEKLY" && (lower(words[j]) === "on" || lower(words[j]) === "am")) {
      const { days, next } = readDays(words, j + 1);
      if (days.length) return { rule: { ...newRule(freq, interval), days }, used: next - i };
    }
    return { rule: newRule(freq, interval), used: j - i };
  }
  if (WORKDAY_WORDS.has(unitWord) && interval === 1 && nth === null) return { rule: { ...newRule("WEEKLY"), days: [0, 1, 2, 3, 4] }, used: j + 1 - i };
  if (WEEKEND_WORDS.has(unitWord) && nth === null) return { rule: { ...newRule("WEEKLY", interval), days: [5, 6] }, used: j + 1 - i };
  const { days, next } = readDays(words, j);
  if (!days.length) return null;
  if (nth !== null) return { rule: { ...newRule("MONTHLY"), nth, days: [days[0]] }, used: j + 1 - i };
  return { rule: { ...newRule("WEEKLY", interval), days }, used: next - i };
}

/** Phrases offered while a repeat is being typed, with what each means. */
export interface RepeatSuggestion {
  phrase: string;
  label: string;
}

const EN_PHRASES = [
  "every day", "every weekday", "every week", "every other week", "every month", "every year", "every other day", "every weekend",
  "every monday", "every tuesday", "every wednesday", "every thursday", "every friday", "every saturday", "every sunday",
];
const DE_PHRASES = [
  "jeden Tag", "jeden Werktag", "jede Woche", "jede zweite Woche", "jeden Monat", "jedes Jahr", "jeden zweiten Tag", "jedes Wochenende",
  "jeden Montag", "jeden Dienstag", "jeden Mittwoch", "jeden Donnerstag", "jeden Freitag", "jeden Samstag", "jeden Sonntag",
];

/**
 * Repeat phrases that complete what is typed before the caret: after
 * "every " / "jeden " / "jede " / "jedes ", or "alle 2". `typed` is the part
 * the chosen phrase replaces.
 */
export function repeatSuggestions(before: string, today = todayKey()): { typed: string; items: RepeatSuggestion[] } | null {
  const m = /(?:^|\s)((?:every|jeden|jede|jedes)\s+(?:\S+\s*){0,2}|alle\s+\d+\s*\S*)$/i.exec(before);
  if (!m) return null;
  const typed = m[1];
  const t = typed.toLowerCase().replace(/\s+/g, " ");
  const head = t.split(" ")[0];
  const num = /^(every|alle) (\d+)/.exec(t)?.[2];
  let pool: string[];
  if (head === "every") pool = num ? [`every ${num} days`, `every ${num} weeks`, `every ${num} months`, `every ${num} years`] : EN_PHRASES;
  else if (head === "alle") pool = [`alle ${num} Tage`, `alle ${num} Wochen`, `alle ${num} Monate`, `alle ${num} Jahre`];
  else pool = DE_PHRASES.filter((p) => p.toLowerCase().startsWith(head + " "));
  const items = pool
    .filter((p) => p.toLowerCase().startsWith(t.trimEnd()) && p.toLowerCase() !== t.trimEnd())
    .slice(0, 6)
    .map((phrase) => {
      const r = parseQuick(phrase, today);
      return { phrase, label: describeRepeat(r.repeat, r.start_date) };
    })
    .filter((x) => x.label);
  return items.length ? { typed, items } : null;
}

/** Picks the list whose name best matches the '#query' (prefix first, then substring). */
export function matchList<T extends { id: string; name: string }>(query: string | null, lists: T[]): T | null {
  if (!query) return null;
  const q = query.toLowerCase();
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  return (
    lists.find((l) => norm(l.name) === q) ??
    lists.find((l) => norm(l.name).startsWith(q)) ??
    lists.find((l) => norm(l.name).includes(q)) ??
    null
  );
}
