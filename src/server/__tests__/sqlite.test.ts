import { describe, expect, test } from "vitest"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { migratedDb } from "./sqlite"

describe("照合・テストの sqlite", () => {
  test("ファイルの sqlite は、当てたマイグレーションを覚え、まだ当てていないものだけを当てる", () => {
    const file = join(mkdtempSync(join(tmpdir(), "mig-")), "db.sqlite")
    const first = migratedDb(file)
    const journal = JSON.parse(readFileSync(new URL("../../../drizzle/csv/meta/_journal.json", import.meta.url), "utf8")) as { entries: { tag: string; when: number }[] }
    // 0008（認証用 D1 に移した認証の表を消す）を当てる前の状態にする（0008 とそのあとの記録を消し、消した表を作り直す）
    const authTables = ["account", "rate_limit", "session", "user", "verification"]
    const dropAuth = journal.entries.find((e) => e.tag === "0008_drop_auth_tables")!
    first.sqlite.prepare("delete from __drizzle_migrations where created_at >= ?").run(dropAuth.when)
    for (const t of authTables) first.sqlite.exec(`create table \`${t}\` (id text primary key)`)
    first.sqlite.close()
    const again = migratedDb(file)
    const left = again.sqlite.prepare(`select name from sqlite_master where type = 'table' and name in (${authTables.map(() => "?").join(", ")})`).all(...authTables)
    expect(left).toEqual([])
    expect((again.sqlite.prepare("select count(*) as n from __drizzle_migrations").get() as { n: number }).n).toBe(journal.entries.length)
  })
})
