// Minimal database interface with two drivers:
//  - Tauri: SQLite file in the app data folder (tauri-plugin-sql)
//  - sql.js: in-browser / in-test SQLite, used for `npm run dev` and vitest
// SQL uses $1..$n placeholders, each once and in order, which both accept.

export type Param = string | number | null;

export interface Db {
  exec(sql: string, params?: Param[]): Promise<void>;
  all<T = Record<string, Param>>(sql: string, params?: Param[]): Promise<T[]>;
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function openTauriDb(): Promise<Db> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const db = await Database.load("sqlite:vitro.db");
  return {
    async exec(sql, params = []) {
      await db.execute(sql, params);
    },
    async all<T>(sql: string, params: Param[] = []) {
      return (await db.select(sql, params)) as T[];
    },
  };
}

interface SqlJsDatabase {
  run(sql: string, params?: Param[]): unknown;
  prepare(sql: string): {
    bind(params?: Param[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
  };
  export(): Uint8Array;
}

/** Wraps a sql.js database. `onChange` fires after every write (for persistence). */
export function wrapSqlJs(raw: SqlJsDatabase, onChange?: () => void): Db {
  return {
    async exec(sql, params = []) {
      raw.run(sql, params);
      onChange?.();
    },
    async all<T>(sql: string, params: Param[] = []) {
      const stmt = raw.prepare(sql);
      const rows: T[] = [];
      try {
        stmt.bind(params);
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
      } finally {
        stmt.free();
      }
      return rows;
    },
  };
}

const LS_KEY = "vitro.db.v1";

/** Browser fallback: SQLite in WebAssembly, persisted to localStorage. */
export async function openBrowserDb(): Promise<Db> {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import("sql.js"),
    import("sql.js/dist/sql-wasm.wasm?url"),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let raw: SqlJsDatabase;
  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    const bytes = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0));
    raw = new SQL.Database(bytes) as unknown as SqlJsDatabase;
  } else {
    raw = new SQL.Database() as unknown as SqlJsDatabase;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const bytes = raw.export();
        let s = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        localStorage.setItem(LS_KEY, btoa(s));
      } catch {
        /* storage full or unavailable: keep working in memory */
      }
    }, 300);
  };
  return wrapSqlJs(raw, persist);
}

export async function openDb(): Promise<Db> {
  return isTauri() ? openTauriDb() : openBrowserDb();
}
