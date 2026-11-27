import Database from "better-sqlite3"
import { beforeEach, describe, expect, test } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { DEFAULT_GLOBAL_RULES, MAX_RULES_TOTAL, rulesTextSchema } from "@/lib/chat/rules"
import {
  appendRuleOnce,
  createCase,
  createCustomer,
  deleteCase,
  deleteCustomer,
  getRules,
  getSettings,
  rulesForAi,
  RulesTooLongError,
  saveRules,
  saveSettings,
  StaleRuleError,
  type Bucket,
  type Db,
  type RuleTarget,
} from "../case-store"
import { migratedDb } from "./sqlite"

const bucket: Bucket = {
  put: async () => ({ size: 0 }),
  delete: async () => {},
  list: async () => ({ objects: [], truncated: false }),
}

let db: Db
let sqlite: Database.Database
beforeEach(() => {
  ;({ db, sqlite } = migratedDb())
})

const GLOBAL: RuleTarget = { scope: "global" }
const appends = () => sqlite.prepare("select count(*) as n from csv_rule_appends").get()

describe("ルールの文章", () => {
  test("全体ルールの初期値はマイグレーションが入れる（コードの DEFAULT_GLOBAL_RULES と同じ）。事務所の設定も読み書きできる", async () => {
    expect(await getRules(db, GLOBAL)).toEqual({ text: DEFAULT_GLOBAL_RULES, version: 0 })
    expect(await getSettings(db)).toEqual({ rule7Tax: "excluded" })
    await saveSettings(db, { rule7Tax: "included" })
    expect(await getSettings(db)).toEqual({ rule7Tax: "included" })
    expect(await getRules(db, GLOBAL)).toEqual({ text: DEFAULT_GLOBAL_RULES, version: 0 })
  })

  test("保存すると版が上がる。読んだ版が古ければ書かずに、今の文章と版を付けて断る。顧客ごとに分かれ、AI には文章のまま渡す", async () => {
    const customer = await createCustomer(db, "合成建設")
    const other = await createCustomer(db, "合成工務店")
    const t: RuleTarget = { scope: "customer", customerId: customer.id }
    expect(await getRules(db, t)).toEqual({ text: "", version: 0 })
    expect(await saveRules(db, t, 0, "- A\n- B")).toEqual({ text: "- A\n- B", version: 1 })
    // 2つ目の画面は版 0 を読んだまま
    const stale = saveRules(db, t, 0, "- 別の画面")
    await expect(stale).rejects.toBeInstanceOf(StaleRuleError)
    await expect(stale).rejects.toMatchObject({ current: { text: "- A\n- B", version: 1 } })
    expect(await saveRules(db, t, 1, "- A2")).toEqual({ text: "- A2", version: 2 })
    expect(await getRules(db, { scope: "customer", customerId: other.id })).toEqual({ text: "", version: 0 })
    expect(await rulesForAi(db, customer.id)).toEqual({ global: DEFAULT_GLOBAL_RULES, customer: "- A2", rule7Tax: "excluded" })
    expect(await rulesForAi(db, null)).toMatchObject({ customer: "" })
  })

  test("文章は改行を LF にそろえて前後の空白を取る。字数は文字の数で数える（「𠮷」も1字。D1 の length と同じ）", () => {
    expect(rulesTextSchema.parse("  - A\r\n- B\r- C \n\n")).toBe("- A\n- B\n- C")
    expect(rulesTextSchema.safeParse("𠮷".repeat(MAX_RULES_TOTAL)).success).toBe(true)
    expect(rulesTextSchema.safeParse("𠮷".repeat(MAX_RULES_TOTAL + 1)).success).toBe(false)
  })

  test("チャットの承認は文章の最後に「- 」の1行として足し、同じ項目を二度足さない（開き直して承認し直しても、同時に押しても）", async () => {
    const customer = await createCustomer(db, "合成建設")
    const c = await createCase(db, customer.id, 2026)
    const t: RuleTarget = { scope: "customer", customerId: customer.id }
    const add = (item: number, text: string) => appendRuleOnce(db, t, { caseId: c.id, proposalId: "p1", item, text })
    expect(await add(0, "工事名の読点は取る")).toBe("added")
    expect(await add(0, "工事名の読点は取る")).toBe("already")
    expect((await Promise.all([add(1, "A"), add(1, "A")])).sort()).toEqual(["added", "already"])
    expect(await getRules(db, t)).toEqual({ text: "- 工事名の読点は取る\n- A", version: 2 })
    expect(appends()).toEqual({ n: 2 })

    expect(await appendRuleOnce(db, GLOBAL, { caseId: c.id, proposalId: "p1", item: 2, text: "注文者の株式会社は㈱" })).toBe("added")
    expect((await getRules(db, GLOBAL)).text).toBe(`${DEFAULT_GLOBAL_RULES}\n- 注文者の株式会社は㈱`)

    // 案件を消すと足した印は消え、ルールの文章は残る
    await deleteCase(db, bucket, c.id)
    expect(appends()).toEqual({ n: 0 })
    expect((await getRules(db, t)).text).toBe("- 工事名の読点は取る\n- A")
  })

  test("承認で上限を超えるなら、足さずに知らせる（印も付けない）", async () => {
    const customer = await createCustomer(db, "合成建設")
    const c = await createCase(db, customer.id, 2026)
    const t: RuleTarget = { scope: "customer", customerId: customer.id }
    await saveRules(db, t, 0, "𠮷".repeat(MAX_RULES_TOTAL - 4))
    await expect(appendRuleOnce(db, t, { caseId: c.id, proposalId: "p", item: 0, text: "長い追記" })).rejects.toBeInstanceOf(RulesTooLongError)
    expect(appends()).toEqual({ n: 0 })
    expect(await appendRuleOnce(db, t, { caseId: c.id, proposalId: "p", item: 0, text: "a" })).toBe("added")
    expect([...(await getRules(db, t)).text].length).toBe(MAX_RULES_TOTAL)
  })

  test("顧客を消すと顧客ルールも消え、もう足せない（全体ルールは残る）", async () => {
    const customer = await createCustomer(db, "合成建設")
    const c = await createCase(db, customer.id, 2026)
    const t: RuleTarget = { scope: "customer", customerId: customer.id }
    await saveRules(db, t, 0, "- A")
    await appendRuleOnce(db, GLOBAL, { caseId: c.id, proposalId: "p", item: 0, text: "全体へ" })
    await deleteCustomer(db, bucket, customer.id)
    await expect(getRules(db, t)).rejects.toThrow("顧客が見つかりません")
    expect((await getRules(db, GLOBAL)).text.endsWith("- 全体へ")).toBe(true)
    await expect(appendRuleOnce(db, t, { caseId: "x", proposalId: "q", item: 0, text: "B" })).rejects.toThrow("顧客が見つかりません")
  })
})

describe("項目から1つの文章にする（0014）", () => {
  test("項目を並びの順に「- 」の行にして1つの文章にし、項目の表を消す。項目の無い顧客は空", () => {
    const old = new Database(":memory:")
    const tags = readdirSync(new URL("../../../drizzle/csv/", import.meta.url)).filter((f) => f.endsWith(".sql")).map((f) => f.replace(/\.sql$/, "")).sort()
    const apply = (list: string[]) => {
      for (const tag of list) for (const statement of readFileSync(new URL(`../../../drizzle/csv/${tag}.sql`, import.meta.url), "utf8").split("--> statement-breakpoint")) old.exec(statement)
    }
    apply(tags.filter((t) => t < "0014"))
    old.exec("insert into csv_customers (id, name) values ('c1', '合成建設'), ('c2', '合成工務店')")
    old.exec("insert into csv_rule_items (id, scope, customer_id, text, position, source) values ('b', 'customer', 'c1', 'B', 2, 'chat'), ('a', 'customer', 'c1', 'A', 1, 'staff')")
    apply(tags.filter((t) => t >= "0014"))
    expect(old.prepare("select id, rules, rules_version as v from csv_customers order by id").all()).toEqual([
      { id: "c1", rules: "- A\n- B", v: 0 },
      { id: "c2", rules: "", v: 0 },
    ])
    expect(old.prepare("select rules from csv_settings").get()).toEqual({ rules: DEFAULT_GLOBAL_RULES })
    expect(old.prepare("select name from sqlite_master where name = 'csv_rule_items'").all()).toEqual([])
  })
})
