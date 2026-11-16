// Dates are plain "YYYY-MM-DD" strings in local time; times are "HH:mm".

export const pad = (n: number) => String(n).padStart(2, "0");

export function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(now = new Date()): string {
  return toKey(now);
}

export function addDays(key: string, n: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

/** Whole days from a to b (positive if b is later). */
export function diffDays(a: string, b: string): number {
  const ms = Date.UTC(...ymd(b)) - Date.UTC(...ymd(a));
  return Math.round(ms / 86400000);
}

function ymd(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m - 1, d];
}

/** Monday of the week containing the given day. */
export function startOfWeek(key: string): string {
  const d = fromKey(key);
  const dow = (d.getDay() + 6) % 7;
  return addDays(key, -dow);
}

export function startOfMonth(key: string): string {
  return key.slice(0, 8) + "01";
}

export function addMonths(key: string, n: number): string {
  const d = fromKey(startOfMonth(key));
  d.setMonth(d.getMonth() + n);
  return toKey(d);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Short human label: Today, Tomorrow, Yesterday, a weekday within a week, else a date. */
export function formatDate(key: string, today = todayKey()): string {
  const diff = diffDays(today, key);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = fromKey(key);
  if (diff > 1 && diff < 7) return WEEKDAYS[(d.getDay() + 6) % 7];
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return sameYear ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatDateTime(date: string, time: string | null, today = todayKey()): string {
  return time ? `${formatDate(date, today)} ${time}` : formatDate(date, today);
}

/** "3d left", "today", "2d over" for a deadline. */
export function deadlineCountdown(key: string, today = todayKey()): string {
  const diff = diffDays(today, key);
  if (diff === 0) return "today";
  if (diff > 0) return `${diff}d left`;
  return `${-diff}d over`;
}

export function isWeekend(key: string): boolean {
  const dow = fromKey(key).getDay();
  return dow === 0 || dow === 6;
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
