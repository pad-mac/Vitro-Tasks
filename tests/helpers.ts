import initSqlJs from "sql.js";
import { wrapSqlJs, type Db } from "../src/db/driver";
import { migrate } from "../src/db/repo";

export async function memoryDb(): Promise<Db> {
  const SQL = await initSqlJs();
  const db = wrapSqlJs(new SQL.Database() as never);
  await migrate(db);
  return db;
}
