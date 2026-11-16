import type { Db } from "./driver";
import { applyRemote, collectDirty, getMeta, markClean, setMeta } from "./repo";
import type { SyncRequest, SyncResponse } from "../shared/schema";

export interface SyncConfig {
  url: string;
  token: string;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  cursor: number;
}

export async function getSyncConfig(db: Db): Promise<SyncConfig | null> {
  const url = (await getMeta(db, "sync_url")) ?? "";
  const token = (await getMeta(db, "sync_token")) ?? "";
  return url ? { url, token } : null;
}

export async function setSyncConfig(db: Db, cfg: SyncConfig): Promise<void> {
  const prev = await getMeta(db, "sync_url");
  await setMeta(db, "sync_url", cfg.url.trim().replace(/\/+$/, ""));
  await setMeta(db, "sync_token", cfg.token.trim());
  // A different server has not seen our data: start over and send everything.
  if (prev !== cfg.url.trim().replace(/\/+$/, "")) await resetSyncState(db);
}

export async function resetSyncState(db: Db): Promise<void> {
  await setMeta(db, "sync_cursor", "0");
  for (const t of ["lists", "sections", "tasks", "settings"]) await db.exec(`UPDATE ${t} SET dirty = 1`);
}

/** One push+pull round trip. Safe to repeat: every step is idempotent. */
export async function syncOnce(
  db: Db,
  cfg: SyncConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<SyncResult> {
  const since = Number((await getMeta(db, "sync_cursor")) ?? "0") || 0;
  const changes = await collectDirty(db);
  const body: SyncRequest = { since, changes };
  const res = await fetchImpl(`${cfg.url}/v1/sync`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sync server answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json()) as SyncResponse;
  await markClean(db, changes);
  const pulled = await applyRemote(db, data.changes);
  await setMeta(db, "sync_cursor", String(data.cursor));
  const pushed = Object.values(changes).reduce((n, rows) => n + (rows?.length ?? 0), 0);
  return { pushed, pulled, cursor: data.cursor };
}
