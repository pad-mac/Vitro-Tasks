// Import and export: Vitro's own CSV (round-trips everything) and TickTick backups.
import { ENTITIES, SYNC_COLS, colNames, entity, type EntityName, type List, type Row, type Section, type Task } from "../shared/schema";

// ---------- CSV ----------

/** RFC 4180 parser: quoted fields, doubled quotes, newlines inside quotes, BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvField(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsvLine(values: unknown[]): string {
  return values.map(csvField).join(",");
}

// ---------- Vitro CSV ----------

const RECORD: Record<EntityName, string> = { lists: "list", sections: "section", tasks: "task", settings: "setting" };
const ORDER: EntityName[] = ["lists", "sections", "tasks", "settings"];

/** One header for every record type: record, id, then all columns in schema order. */
function exportColumns(): string[] {
  const cols: string[] = [];
  for (const e of ENTITIES) for (const c of e.cols) if (!cols.includes(c.name)) cols.push(c.name);
  return ["record", "id", ...cols, ...SYNC_COLS.map((c) => c.name).filter((c) => c !== "deleted")];
}

export type ExportData = Partial<Record<EntityName, Row[]>>;

/** Every list, section, task and synced setting as one CSV that `readVitroCsv` reads back. */
export function writeVitroCsv(data: ExportData): string {
  const cols = exportColumns();
  const lines = [toCsvLine(cols)];
  for (const name of ORDER) {
    const own = new Set(colNames(name));
    for (const row of data[name] ?? []) {
      if (row.deleted) continue;
      lines.push(toCsvLine(cols.map((c) => (c === "record" ? RECORD[name] : own.has(c) ? row[c] : ""))));
    }
  }
  return lines.join("\r\n") + "\r\n";
}

export function isVitroCsv(text: string): boolean {
  const first = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0];
  return first.startsWith("record,id,");
}

/** Rows by entity, typed back from text using the schema (empty nullable fields become null). */
export function readVitroCsv(text: string): ExportData {
  const [header, ...rows] = parseCsv(text).filter((r) => r.length > 1 || r[0] !== "");
  if (!header || header[0] !== "record" || header[1] !== "id") throw new Error("This is not a Vitro Tasks export.");
  const out: ExportData = {};
  const byRecord = Object.fromEntries(Object.entries(RECORD).map(([k, v]) => [v, k as EntityName]));
  for (const cells of rows) {
    const name = byRecord[cells[0]];
    if (!name || !cells[1]) continue;
    const row: Row = { id: cells[1] };
    for (const col of [...entity(name).cols, ...SYNC_COLS]) {
      const i = header.indexOf(col.name);
      if (i < 0) continue;
      const raw = cells[i] ?? "";
      if (raw === "" && col.def === undefined) row[col.name] = null;
      else if (col.type === "text") row[col.name] = raw;
      else row[col.name] = raw === "" ? Number(col.def ?? 0) : Number(raw);
    }
    row.deleted = 0;
    (out[name] ??= []).push(row);
  }
  return out;
}

// ---------- TickTick backup ----------

export function isTickTickBackup(text: string): boolean {
  return /"Folder Name","List Name","Title"/.test(text.slice(0, 2000));
}

/** Stable short id from text, so importing the same backup twice finds the same rows. */
function hashId(prefix: string, ...parts: string[]): string {
  const str = parts.join("\u0001");
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${prefix}-${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

/** Local calendar date and time of a UTC instant in a time zone. */
function localParts(iso: string, timeZone: string): { date: string; time: string } | null {
  const ms = Date.parse(iso.replace(/\+0000$/, "Z"));
  if (Number.isNaN(ms)) return null;
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** TickTick stores markdown with escapes ("\\(1988\\)"); this app shows the text as is. */
const unescapeMd = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!<>|~=])/g, "$1");

function prevDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface TickTickImport {
  lists: List[];
  sections: Section[];
  tasks: Task[];
  /** Things that do not carry over, for the summary. */
  notes: { repeating: number; tags: string[]; reminders: number };
}

export interface ExistingLists {
  lists: { id: string; name: string; parent_id: string | null }[];
}

/**
 * Turns a TickTick backup into Vitro rows.
 * Folders become top-level lists with the lists inside them as sublists;
 * columns become sections; checklists become subtasks; all-day ranges, which
 * TickTick ends at midnight after the last day, keep their real last day.
 * Lists that already exist with the same name and parent are reused.
 */
export function readTickTick(text: string, existing: ExistingLists, opts: { includeCompleted: boolean; colors: string[]; now?: number }): TickTickImport {
  const all = parseCsv(text);
  const at = all.findIndex((r) => r[0] === "Folder Name" && r.includes("taskId"));
  if (at < 0) throw new Error("This does not look like a TickTick backup (the header row is missing).");
  const head = all[at];
  const col = (name: string) => head.indexOf(name);
  const C = {
    folder: col("Folder Name"), list: col("List Name"), title: col("Title"), kind: col("Kind"), tags: col("Tags"),
    content: col("Content"), start: col("Start Date"), due: col("Due Date"), repeat: col("Repeat"), reminder: col("Reminder"),
    priority: col("Priority"), status: col("Status"), created: col("Created Time"), completed: col("Completed Time"),
    order: col("Order"), tz: col("Timezone"), allDay: col("Is All Day"), column: col("Column Name"), columnOrder: col("Column Order"),
    taskId: col("taskId"), parentId: col("parentId"),
  };
  const rows = all.slice(at + 1).filter((r) => r.length >= head.length - 2 && r[C.title] !== undefined);
  const now = opts.now ?? Date.now();
  const lists: List[] = [];
  const sections: Section[] = [];
  const tasks: Task[] = [];
  const notes = { repeating: 0, tags: [] as string[], reminders: 0 };

  const known = [...existing.lists];
  const findList = (name: string, parent: string | null) =>
    known.find((l) => l.name.trim().toLowerCase() === name.trim().toLowerCase() && (l.parent_id ?? null) === parent);
  const newList = (id: string, name: string, parent: string | null): string => {
    const found = findList(name, parent);
    if (found) return found.id;
    const list: List = {
      id, name, color: opts.colors[(lists.length + known.length) % opts.colors.length], parent_id: parent,
      position: lists.length + known.length + 1, view_mode: "list", group_by: "section", sort_by: "manual", collapsed: 0,
      updated_at: now, deleted: 0,
    };
    lists.push(list);
    known.push(list);
    return id;
  };
  const listIdFor = (folder: string, name: string): string | null => {
    if (!folder && name === "Inbox") return null;
    const parent = folder ? newList(hashId("tt-f", folder), folder, null) : null;
    return newList(hashId("tt-l", folder, name), name, parent);
  };
  const sectionIds = new Map<string, string>();
  const sectionFor = (listId: string | null, name: string, order: string): string | null => {
    if (!listId || !name || name === "Not Sectioned") return null;
    const key = `${listId}\u0001${name}`;
    let id = sectionIds.get(key);
    if (!id) {
      id = hashId("tt-s", listId, name);
      sectionIds.set(key, id);
      const pos = Number(order);
      sections.push({ id, list_id: listId, name, position: Number.isFinite(pos) ? pos : sections.length, updated_at: now, deleted: 0 });
    }
    return id;
  };

  const PRIORITY: Record<string, number> = { "0": 0, "1": 1, "3": 2, "5": 3 };
  // Completed occurrences of repeating tasks share title and creation time, so
  // their dates (and their parent's dates) are part of the id too.
  const rawById = new Map(rows.map((r) => [r[C.taskId], r]));
  const used = new Set<string>();
  const uniqueId = (base: string) => {
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
  const byTickTickId = new Map<string, Task>();
  const parentOf = new Map<string, string>();
  for (const r of rows) {
    const status = r[C.status] === "2" ? 1 : r[C.status] === "-1" ? 2 : 0;
    if (status && !opts.includeCompleted) continue;
    const listId = listIdFor(r[C.folder] ?? "", r[C.list] || "Inbox");
    const tz = r[C.tz] || "UTC";
    const allDay = r[C.allDay] === "true";
    const start = r[C.start] ? localParts(r[C.start], tz) : null;
    const due = r[C.due] ? localParts(r[C.due], tz) : null;
    const created = Date.parse((r[C.created] || "").replace(/\+0000$/, "Z")) || now;
    const tags = (r[C.tags] || "").split(",").map((t) => t.trim()).filter(Boolean);
    if (r[C.repeat]) notes.repeating++;
    if (r[C.reminder]) notes.reminders++;
    for (const t of tags) if (t !== "deadline" && !notes.tags.includes(t)) notes.tags.push(t);

    const task: Task = {
      id: uniqueId(
        hashId(
          "tt-t", r[C.folder] ?? "", r[C.list] ?? "", r[C.title], String(created), r[C.start] ?? "", r[C.completed] ?? "",
          rawById.get(r[C.parentId] ?? "")?.[C.start] ?? "", rawById.get(r[C.parentId] ?? "")?.[C.completed] ?? "",
        ),
      ),
      list_id: listId, section_id: sectionFor(listId, r[C.column] ?? "", r[C.columnOrder] ?? ""), parent_id: null,
      title: unescapeMd(r[C.title]).trim(), notes: "", priority: PRIORITY[r[C.priority]] ?? 0, status,
      start_date: null, start_time: null, end_date: null, end_time: null, deadline_date: null, deadline_time: null,
      completed_at: status ? Date.parse((r[C.completed] || "").replace(/\+0000$/, "Z")) || now : null,
      position: Number(r[C.order]) || 0, pinned: 0, created_at: created, updated_at: now, deleted: 0,
    };
    const first = start ?? due;
    if (first) {
      task.start_date = first.date;
      if (!allDay) task.start_time = first.time;
      if (start && due && r[C.start] !== r[C.due]) {
        if (allDay) {
          // TickTick ends all-day ranges at midnight after the last day.
          const last = prevDay(due.date);
          if (last > first.date) task.end_date = last;
        } else {
          if (due.date !== first.date) task.end_date = due.date;
          task.end_time = due.time;
        }
      }
    }
    // A "deadline" tag marks the date as a hard deadline (the planned date stays).
    if (tags.includes("deadline") && first) {
      task.deadline_date = task.end_date ?? task.start_date;
      task.deadline_time = allDay ? null : (task.end_time ?? task.start_time);
    }

    // Checklists: ▫ open item, ▪ done item; any other line stays in the notes.
    // TickTick separates lines inside a field with \n or a bare \r.
    const content = unescapeMd((r[C.content] ?? "").replace(/\r\n?/g, "\n"));
    if (r[C.kind] === "CHECKLIST") {
      const keep: string[] = [];
      let i = 0;
      for (const line of content.split("\n")) {
        const m = /^([▫▪])\s*(.*)$/.exec(line);
        if (!m) {
          keep.push(line);
          continue;
        }
        if (!m[2].trim()) continue;
        tasks.push({
          ...task, id: hashId("tt-c", task.id, String(i++), m[2]), parent_id: task.id, section_id: task.section_id,
          title: m[2].trim(), notes: "", priority: 0, status: m[1] === "▪" ? 1 : 0, completed_at: m[1] === "▪" ? task.completed_at ?? now : null,
          start_date: null, start_time: null, end_date: null, end_time: null, deadline_date: null, deadline_time: null, position: i,
        });
      }
      task.notes = keep.join("\n").trim();
    } else task.notes = content.trim();

    tasks.push(task);
    if (r[C.taskId]) byTickTickId.set(r[C.taskId], task);
    if (r[C.parentId]) parentOf.set(task.id, r[C.parentId]);
  }
  // Subtasks: link to the parent and move into its list.
  for (const t of tasks) {
    const parentTt = parentOf.get(t.id);
    if (!parentTt) continue;
    const parent = byTickTickId.get(parentTt);
    if (parent) {
      t.parent_id = parent.id;
      t.list_id = parent.list_id;
      t.section_id = parent.section_id;
    }
  }
  return { lists, sections, tasks, notes };
}
