import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import * as casesSchema from "@/db/cases-schema"
import type { Db } from "../case-store"

/** 文として流せる drizzle のクエリ（insert・update・select など） */
type Query = { all: () => unknown; run: () => unknown; toSQL: () => { sql: string } }

/**
 * 本番と同じマイグレーションを当てた sqlite（better-sqlite3。D1 と同じく外部キーを効かせる）。file を渡すとそのファイルに置く（照合スクリプトが覚えた結果を回をまたいで持つ）。
 * 当てたマイグレーションは drizzle の記録の表に残し、まだ当てていないものだけを当てる（あとから足したマイグレーションも当たる）
 */
export function migratedSqlite<S extends Record<string, unknown>>(schema: S, migrations: string, file = ":memory:") {
  const sqlite = new Database(file)
  sqlite.pragma("foreign_keys = ON")
  const base = drizzle(sqlite, { schema })
  migrate(base, { migrationsFolder: migrations })
  // D1 の batch と同じく、渡した書き込みを1つのトランザクションで流し、それぞれの結果を返す。
  // 行を返す文（select・returning つき）は行を、返さない文は実行の結果を返す（better-sqlite3 は返さない文に all を使えない）
  const batch = async (queries: readonly Query[]) => sqlite.transaction(() => queries.map((q) => (sqlite.prepare(q.toSQL().sql).reader ? q.all() : q.run())))()
  return { db: Object.assign(base, { batch }), sqlite }
}

const CSV_MIGRATIONS = new URL("../../../drizzle/csv/", import.meta.url).pathname

/** 工事経歴書 CSV の D1 と同じ sqlite */
export function migratedDb(file = ":memory:"): { db: Db; sqlite: Database.Database } {
  const { db, sqlite } = migratedSqlite(casesSchema, CSV_MIGRATIONS, file)
  return { db: db as unknown as Db, sqlite }
}
