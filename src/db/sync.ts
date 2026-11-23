import type { Db } from "./driver";
import { applyRemote, assignOrigin, collectDirty, getMeta, markClean, markOriginDirty, markRepeatsDirty, setMeta } from "./repo";
import type { SyncRequest, SyncResponse } from "../shared/schema";

/** Where to sync. `id` names the server in the app's list (rows carry it as their `origin`). */
export interface SyncConfig {
  url: string;
  token: string;
  id?: string;
}

/** A sync server as set up in the app: its own name, on or off (off: its lists are hidden and it is not synced). */
export interface SyncServer {
  id: string;
  name: string;
  url: string;
  token: string;
  enabled: boolean;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  cursor: number;
  /** The server is older than this app and refused fields it does not know (repeat rules): they stay on this device. */
  outdated?: boolean;
}

/** Fields added after the first server versions; an older server refuses rows that carry them. */
const NEWER_TASK_FIELDS = ["repeat"];

const cleanUrl = (url: string) => url.trim().replace(/\/+$/, "");
const cursorKey = (id?: string) => (id ? `sync_cursor:${id}` : "sync_cursor");

/** A short name from the address, for a server nobody named. */
export function hostName(url: string): string {
  try {
    return new URL(cleanUrl(url)).hostname || url;
  } catch {
    return cleanUrl(url).replace(/^\w+:\/\//, "").split(/[/:]/)[0] || "Server";
  }
}

/**
 * The servers set up on this device. The first time, a server set up by an
 * older version (one address and token) becomes the first entry: everything
 * on the device lives on it, and its sync position is kept.
 */
export async function getServers(db: Db): Promise<SyncServer[]> {
  const raw = await getMeta(db, "sync_servers");
  if (raw !== null) {
    try {
      const list = JSON.parse(raw) as SyncServer[];
      return Array.isArray(list) ? list.filter((s) => s && typeof s.id === "string" && typeof s.url === "string") : [];
    } catch {
      return [];
    }
  }
  const url = (await getMeta(db, "sync_url")) ?? "";
  const token = (await getMeta(db, "sync_token")) ?? "";
  const servers: SyncServer[] = [];
  if (url) {
    // A fixed id: every window of the app may do this at the same first start, and all must agree.
    const server: SyncServer = { id: "first", name: hostName(url), url: cleanUrl(url), token, enabled: true };
    servers.push(server);
    await setMeta(db, cursorKey(server.id), (await getMeta(db, "sync_cursor")) ?? "0");
    await assignOrigin(db, "", server.id);
    await setMeta(db, "sync_default", server.id);
  }
  await setMeta(db, "sync_servers", JSON.stringify(servers));
  return servers;
}

export async function setServers(db: Db, servers: SyncServer[]): Promise<void> {
  await setMeta(db, "sync_servers", JSON.stringify(servers.map((s) => ({ ...s, url: cleanUrl(s.url), token: s.token.trim(), name: s.name.trim() }))));
}

/** The server new lists (and Inbox tasks) go to. */
export async function getDefaultServer(db: Db): Promise<string> {
  return (await getMeta(db, "sync_default")) ?? "";
}

export async function setDefaultServer(db: Db, id: string): Promise<void> {
  await setMeta(db, "sync_default", id);
}

/** A server that has not seen this device's rows of it (new, or a new address): start over and send them all. */
export async function resetServer(db: Db, id: string): Promise<void> {
  await setMeta(db, cursorKey(id), "0");
  await markOriginDirty(db, id);
}

/** One push+pull round trip with one server. Safe to repeat: every step is idempotent. */
export async function syncOnce(db: Db, cfg: SyncConfig, fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  const origin = cfg.id ?? "";
  const since = Number((await getMeta(db, cursorKey(cfg.id))) ?? "0") || 0;
  const changes = await collectDirty(db, origin);
  const post = (body: SyncRequest) =>
    fetchImpl(`${cleanUrl(cfg.url)}/v1/sync`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify(body),
    });
  let res = await post({ since, changes });
  let outdated = false;
  if (res.status === 400 && changes.tasks?.length) {
    // A server from before repeats refuses task rows with fields it does not
    // know: send them without, so everything else still syncs.
    const text = await res.clone().text().catch(() => "");
    if (/invalid tasks row/.test(text)) {
      const tasks = changes.tasks.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !NEWER_TASK_FIELDS.includes(k))));
      res = await post({ since, changes: { ...changes, tasks } });
      outdated = res.ok;
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sync server answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json()) as SyncResponse;
  await markClean(db, changes);
  const known = await getMeta(db, outdatedKey(cfg.id));
  if (outdated) await setMeta(db, outdatedKey(cfg.id), "1");
  else if (known === "1" && changes.tasks?.length) {
    // Updated since: the repeat rules it missed go up with the next round.
    await setMeta(db, outdatedKey(cfg.id), "");
    await markRepeatsDirty(db, origin);
  }
  const pulled = await applyRemote(db, data.changes, origin);
  await setMeta(db, cursorKey(cfg.id), String(data.cursor));
  const pushed = Object.values(changes).reduce((n, rows) => n + (rows?.length ?? 0), 0);
  return { pushed, pulled, cursor: data.cursor, outdated: outdated || (known === "1" && !changes.tasks?.length) };
}

const outdatedKey = (id?: string) => (id ? `sync_outdated:${id}` : "sync_outdated");
