// Parser for the quick add bar. Recognised tokens are removed from the title:
//   today / tomorrow / mon..sun / 24.12. / 2026-12-24 / in 3 days   -> planned date
//   14:30                                                            -> planned time
//   ^fri  ^24.12.  ^2026-12-24  (any date token with a ^ prefix)     -> hard deadline
//   !1 !2 !3  or  !low !med !high                                    -> priority
//   #listname                                                        -> list (prefix match)
// German day words (heute, morgen, mo..so) work too.
import { addDays, pad, startOfWeek, todayKey, toKey } from "./dates";

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
  };
  const words = input.trim().split(/\s+/).filter(Boolean);
  const keep: string[] = [];
  let lastDateTarget: "start" | "deadline" | null = null;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

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
  return out;
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
