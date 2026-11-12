import type Database from "better-sqlite3"
import * as schema from "@/db/fit-schema"
import type { Db } from "../fit-store"
import { migratedSqlite } from "./sqlite"

const MIGRATIONS = new URL("../../../drizzle/fit/", import.meta.url).pathname

/** FIT の D1 と同じマイグレーションを当てたメモリの sqlite */
export function migratedFitDb(): { db: Db; sqlite: Database.Database } {
  const { db, sqlite } = migratedSqlite(schema, MIGRATIONS)
  return { db: db as unknown as Db, sqlite }
}
