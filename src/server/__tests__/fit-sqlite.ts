import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import * as schema from "@/db/fit-schema"
import type { Db } from "../fit-store"

const MIGRATIONS = new URL("../../../drizzle/fit/", import.meta.url).pathname

/** FIT の本番と同じマイグレーションを当てたメモリの sqlite（D1 と同じく外部キーを効かせ、batch は1つのトランザクションで流す） */
export function migratedFitDb(): { db: Db; sqlite: Database } {
  const sqlite = new Database(":memory:")
  sqlite.run("PRAGMA foreign_keys = ON")
  const base = drizzle(sqlite, { schema })
  migrate(base, { migrationsFolder: MIGRATIONS })
  const batch = async (queries: readonly { all: () => unknown }[]) => sqlite.transaction(() => queries.map((q) => q.all()))()
  return { db: Object.assign(base, { batch }) as unknown as Db, sqlite }
}
