// The widgets' own engine. The widget extension runs it in JavaScriptCore
// (bundled to core.js by scripts/ios-widgets.mjs), so that with the app
// closed the widgets still sync with the servers, tick tasks off there, and
// draw from the result, with the app's own view logic. Pure functions on JSON
// strings; Swift does the network and the files (ios/widgets/Live.swift).
//
// state.json   the app's data, written by the app (WidgetState)
// pulled.json  rows the widget pulled since that state (Pulled)
// changes.json rows changed in the widget (Change[]): sent to their server,
//              and taken over by the app when it comes forward. Both sides
//              apply rows by version (last write wins), so a row that reaches
//              the app twice, from here and from the server, lands once.
import { completionRows } from "../lib/complete";
import { computePrefs } from "../lib/views";
import { buildSnapshot } from "../lib/widgets";
import { ENTITY_NAMES, colNames, roundInts, withDefaults, type ChangeSet, type EntityName, type List, type Row, type Section, type SyncRequest, type SyncResponse, type Task } from "../shared/schema";

export interface WidgetServer {
  id: string;
  url: string;
  token: string;
  /** The app's sync position with it. */
  cursor: number;
}

type Origin = { origin?: string };

export interface WidgetState {
  v: 1;
  /** When the app wrote it: what the widget pulls afterwards builds on it. */
  at: number;
  /** The app's last complete sync: its data is that fresh. */
  synced: number;
  servers: WidgetServer[];
  lists: (List & Origin)[];
  sections: (Section & Origin)[];
  /** Open tasks, and every subtask of them. */
  tasks: (Task & Origin)[];
  settings: Record<string, string>;
}

interface Pulled {
  /** The state it builds on (its `at`); another state starts over. */
  base: number;
  /** Last successful round trip. */
  at: number;
  cursors: Record<string, number>;
  rows: Partial<Record<EntityName, Record<string, Row>>>;
}

export interface Change {
  entity: EntityName;
  row: Row;
  origin: string;
  pushed: boolean;
}

/** Pull at most this often on its own (iOS spaces widget refreshes out anyway). */
const PULL_EVERY = 10 * 60 * 1000;

const parse = <T>(json: string | undefined | null): T | null => {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
};
const cleanUrl = (url: string) => url.trim().replace(/\/+$/, "");
const uid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
const pick = (name: EntityName, row: Row): Row => roundInts(name, Object.fromEntries(colNames(name).map((c) => [c, row[c] ?? null])));

/** The app's state with what the widget pulled and changed on top, newest version of each row winning. */
function load(stateJson: string, pulledJson: string, changesJson: string) {
  const state = parse<WidgetState>(stateJson);
  if (!state) throw new Error("no state");
  let pulled = parse<Pulled>(pulledJson);
  if (!pulled || pulled.base !== state.at) pulled = { base: state.at, at: 0, cursors: {}, rows: {} };
  const rows = {
    lists: new Map<string, Row>(state.lists.map((r) => [r.id, r as unknown as Row])),
    sections: new Map<string, Row>(state.sections.map((r) => [r.id, r as unknown as Row])),
    tasks: new Map<string, Row>(state.tasks.map((r) => [r.id, r as unknown as Row])),
  };
  const settings = { ...state.settings };
  const settingsAt: Record<string, number> = {};
  const apply = (entity: EntityName, row: Row, origin: string): boolean => {
    if (entity === "settings") {
      const at = Number(row.updated_at);
      if ((settingsAt[row.id as string] ?? -1) >= at) return false;
      settingsAt[row.id as string] = at;
      if (row.deleted) delete settings[row.id as string];
      else settings[row.id as string] = String(row.value ?? "");
      return true;
    }
    const map = rows[entity as keyof typeof rows];
    if (!map) return false;
    const cur = map.get(row.id as string);
    if (cur && Number(cur.updated_at) >= Number(row.updated_at)) return false;
    if (row.deleted) map.delete(row.id as string);
    // A field the row does not carry (an older server has no column for it) keeps its value.
    else map.set(row.id as string, { ...(cur ? { ...cur, ...row } : withDefaults(entity, row)), origin: (cur?.origin as string | undefined) ?? origin });
    return true;
  };
  for (const name of ENTITY_NAMES) for (const row of Object.values(pulled.rows[name] ?? {})) apply(name, row, (row.origin as string) ?? "");
  // Changes the app's state already holds (as new or newer) are done with.
  const inState = (c: Change) => {
    const list = c.entity === "lists" ? state.lists : c.entity === "sections" ? state.sections : c.entity === "tasks" ? state.tasks : null;
    const have = list?.find((r) => r.id === c.row.id);
    return !!have && Number(have.updated_at) >= Number(c.row.updated_at);
  };
  // Whole-number times: widgets of 0.15.0 queued some with fractions of a millisecond, which servers refuse.
  const changes = (parse<Change[]>(changesJson) ?? [])
    .map((c) => (ENTITY_NAMES.includes(c.entity) && c.row ? { ...c, row: roundInts(c.entity, c.row) } : c))
    .filter((c) => !(c.pushed && inState(c)));
  for (const c of changes) apply(c.entity, c.row, c.origin);
  return { state, pulled, changes, rows, settings };
}

type Loaded = ReturnType<typeof load>;

function data(w: Loaded) {
  const lists = [...w.rows.lists.values()] as unknown as List[];
  return {
    lists,
    sections: [...w.rows.sections.values()] as unknown as Section[],
    tasks: [...w.rows.tasks.values()] as unknown as Task[],
    settings: w.settings,
  };
}

/** What the widgets show (the same as the app's own snapshot, src/lib/widgets.ts). */
export function snapshot(stateJson: string, pulledJson: string, changesJson: string, today: string, now: number): string {
  now = Math.round(now);
  const d = data(load(stateJson, pulledJson, changesJson));
  return JSON.stringify(buildSnapshot(d, (v) => computePrefs(v, d.lists, d.settings), today, now));
}

/** Ticks a task off (repeating: on to its next date, with a done copy). Returns the new changes. */
export function complete(stateJson: string, pulledJson: string, changesJson: string, id: string, now: number, today: string): string {
  now = Math.round(now);
  const w = load(stateJson, pulledJson, changesJson);
  const task = w.rows.tasks.get(id) as unknown as (Task & Origin) | undefined;
  if (!task || task.status !== 0) return JSON.stringify(w.changes);
  const all = [...w.rows.tasks.values()] as unknown as (Task & Origin)[];
  for (const r of completionRows(task, all, now, uid, today) as (Task & Origin)[]) {
    const prev = w.rows.tasks.get(r.id);
    // Never older than the version it replaces, whatever this phone's clock says.
    const updated_at = prev ? Math.max(now, Number(prev.updated_at) + 1) : now;
    w.changes.push({ entity: "tasks", row: pick("tasks", { ...(r as unknown as Row), updated_at }), origin: r.origin ?? task.origin ?? "", pushed: false });
  }
  return JSON.stringify(w.changes);
}

/** Whether a round trip is due: something to send, or nothing pulled for a while. */
export function needsSync(stateJson: string, pulledJson: string, changesJson: string, now: number): boolean {
  const w = load(stateJson, pulledJson, changesJson);
  if (!w.state.servers.length) return false;
  if (w.changes.some((c) => !c.pushed && w.state.servers.some((s) => s.id === c.origin))) return true;
  return now - Math.max(w.state.synced || 0, w.pulled.at || 0) >= PULL_EVERY;
}

/** One push + pull per server: what Swift sends. */
export function requests(stateJson: string, pulledJson: string, changesJson: string): string {
  const w = load(stateJson, pulledJson, changesJson);
  return JSON.stringify(
    w.state.servers.map((s) => {
      const changes: ChangeSet = {};
      for (const c of w.changes) if (!c.pushed && c.origin === s.id) (changes[c.entity] ??= []).push(c.row);
      const body: SyncRequest = { since: Math.max(s.cursor || 0, w.pulled.cursors[s.id] ?? 0), changes };
      return { server: s.id, url: `${cleanUrl(s.url)}/v1/sync`, token: s.token, body: JSON.stringify(body) };
    }),
  );
}

/** A server's answer: what was sent is there now, what came back is kept. Returns the new files' texts, { pulled, changes }, as JSON. */
export function received(stateJson: string, pulledJson: string, changesJson: string, server: string, body: string, response: string, now: number): string {
  const w = load(stateJson, pulledJson, changesJson);
  const sent = parse<SyncRequest>(body)?.changes ?? {};
  const res = parse<SyncResponse>(response);
  if (!res || typeof res.cursor !== "number") throw new Error("not a sync answer");
  for (const c of w.changes) {
    if (!c.pushed && c.origin === server && (sent[c.entity] ?? []).some((r) => r.id === c.row.id && Number(r.updated_at) === Number(c.row.updated_at))) c.pushed = true;
  }
  for (const name of ENTITY_NAMES) {
    for (const row of res.changes?.[name] ?? []) {
      const kept = ((w.pulled.rows[name] ??= {}) as Record<string, Row>);
      const have = kept[row.id as string];
      if (!have || Number(have.updated_at) < Number(row.updated_at)) kept[row.id as string] = { ...row, origin: server };
    }
  }
  w.pulled.cursors[server] = res.cursor;
  w.pulled.at = now;
  return JSON.stringify({ pulled: JSON.stringify(w.pulled), changes: JSON.stringify(w.changes) });
}
