import { and, count, desc, eq, exists, inArray, lt, ne, sql, type SQL } from "drizzle-orm"
import type { BatchItem, BatchResponse } from "drizzle-orm/batch"
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core"
import { csvCaseAiCaches, csvCaseFiles, csvCases, csvCaseStates, csvCustomers, csvRuleAppends, csvSettings } from "@/db/cases-schema"
import type * as schema from "@/db/cases-schema"
import { charCount, MAX_RULES_TOTAL, type Rule7Tax, type Rules, type RuleTarget } from "@/lib/chat/rules"
import { deleteRunsOfCase } from "./location-store"
import { casePrefix, r2KeyOf, type Case, type CaseFile, type CaseStatus, type Customer, type CustomerSummary, type DeletionCounts, type FileKind } from "@/lib/cases/types"

/**
 * 顧客・案件・ファイルの読み書き（D1 と R2）。サーバー関数とファイルのルートから呼ぶ。
 * D1 でも better-sqlite3 でも動くよう、drizzle の sqlite の型で受ける（テストは better-sqlite3 と手元の R2 の代わりで回す）
 */
export type Db = BaseSQLiteDatabase<"sync" | "async", unknown, typeof schema> & Batchable

/** いくつかの書き込みを1つの処理（トランザクション）で流す（D1 の batch。テストの better-sqlite3 でも同じ形で持たせる） */
type Batchable = { batch<U extends BatchItem<"sqlite">, T extends Readonly<[U, ...U[]]>>(batch: T): Promise<BatchResponse<T>> }

/** R2Bucket のうち使うところ */
export type Bucket = {
  /** 置いたものの大きさを返す（R2 は条件付きの put でなければ null を返さない） */
  put(key: string, value: ReadableStream | ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string } }): Promise<{ size: number } | null>
  delete(keys: string[]): Promise<void>
  list(options: { prefix: string; cursor?: string }): Promise<{ objects: { key: string }[] } & ({ truncated: true; cursor: string } | { truncated: false })>
}

const ms = (d: Date) => d.getTime()
const toCustomer = (r: typeof csvCustomers.$inferSelect): Customer => ({ ...r, createdAt: ms(r.createdAt), updatedAt: ms(r.updatedAt) })
const toCase = (r: typeof csvCases.$inferSelect): Case => ({ ...r, createdAt: ms(r.createdAt), updatedAt: ms(r.updatedAt) })
const toFile = ({ r2Key: _, status: __, ...r }: typeof csvCaseFiles.$inferSelect): CaseFile => ({ ...r, createdAt: ms(r.createdAt) })

/** 案件があり、削除中でない（行を足す・保存するときの条件。削除を始めた案件には何も足さない） */
const isLive = (caseId: string) => and(eq(csvCases.id, caseId), eq(csvCases.deleting, false))
const liveCase = (db: Db, caseId: string) => exists(db.select({ one: sql`1` }).from(csvCases).where(isLive(caseId)))

// ---- 顧客 ----

export async function listCustomers(db: Db): Promise<CustomerSummary[]> {
  const rows = await db
    .select({ customer: csvCustomers, caseCount: count(csvCases.id) })
    .from(csvCustomers)
    .leftJoin(csvCases, eq(csvCases.customerId, csvCustomers.id))
    .groupBy(csvCustomers.id)
    .orderBy(csvCustomers.name)
  return rows.map((r) => ({ ...toCustomer(r.customer), caseCount: r.caseCount }))
}

/** ほかの顧客の名前（問い合わせのメールの下書きに入れない。lib/inquiry/text.ts の otherCustomerTest） */
export async function otherCustomerNames(db: Db, customerId: string): Promise<string[]> {
  const rows = await db.select({ name: csvCustomers.name }).from(csvCustomers).where(ne(csvCustomers.id, customerId))
  return rows.map((r) => r.name)
}

export async function getCustomer(db: Db, id: string): Promise<Customer | undefined> {
  const [row] = await db.select().from(csvCustomers).where(eq(csvCustomers.id, id))
  return row && toCustomer(row)
}

export async function createCustomer(db: Db, name: string): Promise<Customer> {
  const [row] = await db.insert(csvCustomers).values({ id: crypto.randomUUID(), name }).returning()
  return toCustomer(row!)
}

export async function updateCustomer(db: Db, id: string, patch: Partial<Pick<Customer, "name">>) {
  await db.update(csvCustomers).set({ ...patch, updatedAt: new Date() }).where(eq(csvCustomers.id, id))
}

// ---- ルール（全体ルール・顧客ルールの文章）と事務所の設定 ----

const SETTINGS_ID = "global"

/** 事務所の設定（行はマイグレーション 0004 が作る。読むだけで書かない） */
export async function getSettings(db: Db): Promise<{ rule7Tax: Rule7Tax }> {
  const [row] = await db.select({ rule7Tax: csvSettings.rule7Tax }).from(csvSettings).where(eq(csvSettings.id, SETTINGS_ID))
  return { rule7Tax: row?.rule7Tax ?? "excluded" }
}

export async function saveSettings(db: Db, patch: { rule7Tax: Rule7Tax }) {
  await db
    .insert(csvSettings)
    .values({ id: SETTINGS_ID, ...patch })
    .onConflictDoUpdate({ target: csvSettings.id, set: { ...patch, updatedAt: new Date() } })
}

export type { RuleTarget }

/** ルールの文章が上限を超える（チャットの案を足すと超える） */
export class RulesTooLongError extends Error {
  constructor() {
    super(`ルールは合計${MAX_RULES_TOTAL.toLocaleString("ja-JP")}字までなので足せません。ルールを短くしてから足してください`)
    this.name = "RulesTooLongError"
  }
}

/** ほかの画面でルールが保存されていた（読んだ版と違う）。current は今の文章と版 */
export class StaleRuleError extends Error {
  constructor(readonly current: Rules) {
    super("ほかの画面でルールが保存されました。今の文章を確かめてから保存し直してください")
    this.name = "StaleRuleError"
  }
}

/** ルールの文章と版（全体ルールは事務所の設定の行、顧客ルールは顧客の行。行が無ければ undefined） */
async function readRules(db: Db, target: RuleTarget): Promise<Rules | undefined> {
  const [row] =
    target.scope === "global"
      ? await db.select({ text: csvSettings.rules, version: csvSettings.rulesVersion }).from(csvSettings).where(eq(csvSettings.id, SETTINGS_ID))
      : await db.select({ text: csvCustomers.rules, version: csvCustomers.rulesVersion }).from(csvCustomers).where(eq(csvCustomers.id, target.customerId))
  return row
}

export async function getRules(db: Db, target: RuleTarget): Promise<Rules> {
  const rules = await readRules(db, target)
  if (!rules) throw new Error(target.scope === "global" ? "事務所の設定がありません" : "顧客が見つかりません")
  return rules
}

/** ルールを書き換える（版を1つ上げる）。条件 extra を足せる。書けたら行を返す */
function writeRules(db: Db, target: RuleTarget, rules: SQL | string, extra: SQL) {
  const set = { rules: sql`${rules}`, updatedAt: new Date() }
  return target.scope === "global"
    ? db
        .update(csvSettings)
        .set({ ...set, rulesVersion: sql`${csvSettings.rulesVersion} + 1` })
        .where(and(eq(csvSettings.id, SETTINGS_ID), extra))
        .returning({ text: csvSettings.rules, version: csvSettings.rulesVersion })
    : db
        .update(csvCustomers)
        .set({ ...set, rulesVersion: sql`${csvCustomers.rulesVersion} + 1` })
        .where(and(eq(csvCustomers.id, target.customerId), extra))
        .returning({ text: csvCustomers.rules, version: csvCustomers.rulesVersion })
}

const rulesColumns = (target: RuleTarget) =>
  target.scope === "global" ? { rules: csvSettings.rules, version: csvSettings.rulesVersion } : { rules: csvCustomers.rules, version: csvCustomers.rulesVersion }

/**
 * ルールの文章を保存する（text は確かめた文章）。version は読んだときの版で、ほかの画面が先に保存していたら書かずに StaleRuleError（黙って上書きしない）
 */
export async function saveRules(db: Db, target: RuleTarget, version: number, text: string): Promise<Rules> {
  const [saved] = await writeRules(db, target, text, eq(rulesColumns(target).version, version))
  if (saved) return saved
  throw new StaleRuleError(await getRules(db, target))
}

/**
 * 変更案の項目（proposalId・item）のルールの追記を、一度だけ文章の最後に「- 」の1行として足す（lib/chat/rules.ts の appendRule と同じ）。
 * 足した印と文章を1つの処理（D1 の batch）で書くので、同じ項目を二度承認しても（保存前に開き直しても、同時に押しても）二度足さない。
 * 上限を超えるなら足さずに RulesTooLongError。足したら "added"、もう足してあれば "already"
 */
export async function appendRuleOnce(
  db: Db,
  target: RuleTarget,
  add: { caseId: string; proposalId: string; item: number; text: string },
): Promise<"added" | "already"> {
  const col = rulesColumns(target)
  const owner = target.scope === "global" ? sql`${csvSettings} where ${csvSettings.id} = ${SETTINGS_ID}` : sql`${csvCustomers} where ${csvCustomers.id} = ${target.customerId}`
  // 足したあとの字数（「改行・- 」の3字を足す）が上限までなら足せる。行が無ければ足さない
  const fits = sql`(select length(${col.rules}) + 3 + ${charCount(add.text)} <= ${MAX_RULES_TOTAL} from ${owner})`
  const token = crypto.randomUUID()
  const mark = db
    .insert(csvRuleAppends)
    .select(
      db
        .select({
          proposalId: sql<string>`${add.proposalId}`.as("proposal_id"),
          item: sql<number>`${add.item}`.as("item"),
          caseId: sql<string>`${add.caseId}`.as("case_id"),
          token: sql<string>`${token}`.as("token"),
          createdAt: sql<Date>`${Date.now()}`.as("created_at"),
        })
        .from(sql`(select 1)`)
        .where(sql`coalesce(${fits}, 0)`),
    )
    .onConflictDoNothing()
  const marked = exists(
    db
      .select({ one: sql`1` })
      .from(csvRuleAppends)
      .where(and(eq(csvRuleAppends.proposalId, add.proposalId), eq(csvRuleAppends.item, add.item), eq(csvRuleAppends.token, token))),
  )
  const line = `- ${add.text}`
  const appended = sql`case when ${col.rules} = '' then ${line} else ${col.rules} || char(10) || ${line} end`
  const [, added] = await db.batch([mark, writeRules(db, target, appended, marked)])
  if (added.length) return "added"
  const [already] = await db
    .select({ one: sql`1` })
    .from(csvRuleAppends)
    .where(and(eq(csvRuleAppends.proposalId, add.proposalId), eq(csvRuleAppends.item, add.item)))
  if (already) return "already"
  throw (await readRules(db, target)) ? new RulesTooLongError() : new Error("顧客が見つかりません")
}

/** AI に渡すルールの文章（全体ルールと、顧客があればその顧客ルール）と事務所の設定 */
export async function rulesForAi(db: Db, customerId: string | null) {
  const [global, customer, settings] = await Promise.all([readRules(db, { scope: "global" }), customerId ? readRules(db, { scope: "customer", customerId }) : undefined, getSettings(db)])
  return { global: global?.text ?? "", customer: customer?.text ?? "", rule7Tax: settings.rule7Tax }
}

// ---- 案件 ----

export async function listCases(db: Db, customerId: string): Promise<(Case & { fileCount: number })[]> {
  const rows = await db
    .select({ kase: csvCases, fileCount: count(csvCaseFiles.id) })
    .from(csvCases)
    .leftJoin(csvCaseFiles, readyFileOf(csvCases.id))
    .where(eq(csvCases.customerId, customerId))
    .groupBy(csvCases.id)
    .orderBy(desc(csvCases.fiscalYear), desc(csvCases.createdAt))
  return rows.map((r) => ({ ...toCase(r.kase), fileCount: r.fileCount }))
}

export async function getCase(db: Db, id: string): Promise<Case | undefined> {
  const [row] = await db.select().from(csvCases).where(eq(csvCases.id, id))
  return row && toCase(row)
}

export async function createCase(db: Db, customerId: string, fiscalYear: number): Promise<Case> {
  const [row] = await db.insert(csvCases).values({ id: crypto.randomUUID(), customerId, fiscalYear }).returning()
  return toCase(row!)
}

/** 同じ顧客の前の年度の案件（いちばん近い年度。削除の途中のものは除く）。無ければ undefined */
export async function previousCase(db: Db, kase: Pick<Case, "customerId" | "fiscalYear">): Promise<Case | undefined> {
  const [row] = await db
    .select()
    .from(csvCases)
    .where(and(eq(csvCases.customerId, kase.customerId), lt(csvCases.fiscalYear, kase.fiscalYear), eq(csvCases.deleting, false)))
    .orderBy(desc(csvCases.fiscalYear), desc(csvCases.createdAt))
    .limit(1)
  return row && toCase(row)
}

/**
 * 消す前に、案件の会話を終える（AI に渡したファイルを消す）。先に削除の印を立てて新しい指示を始めさせず、全案件の会話を同時に終える。
 * どれかを終えられなければ（指示を処理している途中など）印を戻して投げる（案件は消さず、「削除の途中」のまま残さない）
 */
export async function endChatsBeforeDelete(db: Db, caseIds: readonly string[], endChat: (caseId: string) => Promise<unknown>) {
  if (!caseIds.length) return
  // 前の削除が途中で落ちた案件（もう R2 を消しかけている）は戻さない
  const fresh = (await db.select({ id: csvCases.id }).from(csvCases).where(and(inArray(csvCases.id, [...caseIds]), eq(csvCases.deleting, false)))).map((c) => c.id)
  if (fresh.length) await db.update(csvCases).set({ deleting: true }).where(inArray(csvCases.id, fresh))
  const ended = await Promise.allSettled(caseIds.map(endChat))
  const failed = ended.find((r) => r.status === "rejected")
  if (failed) {
    if (fresh.length) await db.update(csvCases).set({ deleting: false }).where(inArray(csvCases.id, fresh))
    throw failed.reason
  }
}

/** 使った費用を案件の合計に足す（同時に足しても失わないよう、SQL の中で足す） */
export async function addCaseCost(db: Db, id: string, usd: number) {
  await db.update(csvCases).set({ costUsd: sql`${csvCases.costUsd} + ${usd}` }).where(eq(csvCases.id, id))
}

export async function updateCaseStatus(db: Db, id: string, status: CaseStatus) {
  await db.update(csvCases).set({ status, updatedAt: new Date() }).where(eq(csvCases.id, id))
}

/** 置き終わったファイル（R2 に置いている途中の行は数えない・出さない） */
const readyFileOf = (caseId: typeof csvCases.id | string) => and(eq(csvCaseFiles.caseId, caseId), eq(csvCaseFiles.status, "ready"))

export async function listFiles(db: Db, caseId: string): Promise<CaseFile[]> {
  const rows = await db.select().from(csvCaseFiles).where(readyFileOf(caseId)).orderBy(csvCaseFiles.createdAt)
  return rows.map(toFile)
}

// ---- 案件の状態 ----

export async function getCaseState(db: Db, caseId: string): Promise<{ version: number; json: string; aiCache: string } | undefined> {
  const [row] = await db
    .select({ version: csvCaseStates.version, json: csvCaseStates.json, aiCache: csvCaseAiCaches.json })
    .from(csvCaseStates)
    .innerJoin(csvCaseAiCaches, eq(csvCaseAiCaches.id, csvCaseStates.aiCacheId))
    .where(eq(csvCaseStates.caseId, caseId))
  return row
}

/** 案件の作業の JSON だけ（AI の結果の大きい行は読まない） */
export async function getCaseWorkJson(db: Db, caseId: string): Promise<string | undefined> {
  const [row] = await db.select({ json: csvCaseStates.json }).from(csvCaseStates).where(eq(csvCaseStates.caseId, caseId))
  return row?.json
}

/**
 * 読んだ版のまま作業の JSON だけを書き直す（版は進めない）。読む人がだれでも同じに直すもの（記録の無い開いた変更案を閉じる）だけに使い、
 * ほかのタブの保存とぶつけない。読んだあとに版が進んでいたら書かない（次に読むときにまた直す）
 */
export async function normalizeCaseState(db: Db, caseId: string, version: number, json: string) {
  await db.update(csvCaseStates).set({ json }).where(and(eq(csvCaseStates.caseId, caseId), eq(csvCaseStates.version, version)))
}

export type SaveResult = { ok: true; version: number } | { ok: false; reason: "conflict" | "gone" }

const refusal = async (db: Db, caseId: string): Promise<SaveResult> => ({ ok: false, reason: (await getCase(db, caseId))?.deleting === false ? "conflict" : "gone" })

/**
 * 状態を保存する。version は読んだときの版（まだ保存が無ければ 0）。別の画面が先に保存していたら conflict（上書きしない）。
 * 案件が無いか削除中なら gone（削除の後に行を残さない）。
 * aiCache は変わったときだけ渡す（最初の保存では必ず）。新しい行で足してから状態の行に指させ、保存できたら前の行を、できなければ足した行を消す
 */
export async function saveCaseState(db: Db, caseId: string, version: number, parts: { json: string; aiCache?: string }): Promise<SaveResult> {
  const next = version + 1
  const aiCacheId = parts.aiCache === undefined ? undefined : crypto.randomUUID()
  if (aiCacheId === undefined && version === 0) throw new Error("最初の保存には AI の結果も要ります")
  if (aiCacheId !== undefined) {
    const [added] = await db
      .insert(csvCaseAiCaches)
      .select(
        db
          .select({ id: sql<string>`${aiCacheId}`.as("id"), caseId: csvCases.id, json: sql<string>`${parts.aiCache}`.as("json"), createdAt: sql<Date>`${Date.now()}`.as("created_at") })
          .from(csvCases)
          .where(isLive(caseId)),
      )
      .returning({ id: csvCaseAiCaches.id })
    if (!added) return refusal(db, caseId)
  }
  const [previous] =
    version === 0 ? [] : await db.select({ aiCacheId: csvCaseStates.aiCacheId }).from(csvCaseStates).where(and(eq(csvCaseStates.caseId, caseId), eq(csvCaseStates.version, version)))
  const saved =
    version === 0
      ? await db
          .insert(csvCaseStates)
          .select(
            db
              .select({
                caseId: csvCases.id,
                version: sql<number>`${next}`.as("version"),
                json: sql<string>`${parts.json}`.as("json"),
                aiCacheId: sql<string>`${aiCacheId}`.as("ai_cache_id"),
                updatedAt: sql<Date>`${Date.now()}`.as("updated_at"),
              })
              .from(csvCases)
              .where(isLive(caseId)),
          )
          .onConflictDoNothing()
          .returning({ version: csvCaseStates.version })
      : await db
          .update(csvCaseStates)
          .set({ version: next, json: parts.json, aiCacheId, updatedAt: new Date() })
          .where(and(eq(csvCaseStates.caseId, caseId), eq(csvCaseStates.version, version), liveCase(db, caseId)))
          .returning({ version: csvCaseStates.version })
  if (!saved.length) {
    if (aiCacheId !== undefined) await db.delete(csvCaseAiCaches).where(eq(csvCaseAiCaches.id, aiCacheId))
    return refusal(db, caseId)
  }
  if (aiCacheId !== undefined && previous) await db.delete(csvCaseAiCaches).where(eq(csvCaseAiCaches.id, previous.aiCacheId))
  await db.update(csvCases).set({ updatedAt: new Date() }).where(eq(csvCases.id, caseId))
  return { ok: true, version: next }
}

// ---- ファイル ----

/**
 * ファイルを付ける。案件が無いか削除中なら undefined（R2 にも行にも何も残さない）。
 * 行を「置いている途中」で先に足し（削除中の案件には足せない）、R2 に置き、案件がまだ削除中でなければ「置き終わった」にする。
 * 置いている間に削除が始まったら、置いたものを自分で消す。削除の側は R2 を案件のキーの頭で消すので、どちらの順で進んでも R2 に残らない
 */
export async function addFile(
  db: Db,
  bucket: Bucket,
  caseId: string,
  file: { kind: FileKind; name: string; contentType: string; body: ReadableStream | ArrayBuffer | Uint8Array },
): Promise<CaseFile | undefined> {
  const id = crypto.randomUUID()
  const r2Key = r2KeyOf(caseId, id)
  const [pending] = await db
    .insert(csvCaseFiles)
    .select(
      db
        .select({
          id: sql<string>`${id}`.as("id"),
          caseId: csvCases.id,
          kind: sql<FileKind>`${file.kind}`.as("kind"),
          name: sql<string>`${file.name}`.as("name"),
          contentType: sql<string>`${file.contentType}`.as("content_type"),
          size: sql<number>`0`.as("size"),
          status: sql<"pending">`'pending'`.as("status"),
          r2Key: sql<string>`${r2Key}`.as("r2_key"),
          createdAt: sql<Date>`${Date.now()}`.as("created_at"),
        })
        .from(csvCases)
        .where(isLive(caseId)),
    )
    .returning({ id: csvCaseFiles.id })
  if (!pending) return undefined
  const forget = async () => {
    await bucket.delete([r2Key])
    await db.delete(csvCaseFiles).where(eq(csvCaseFiles.id, id))
  }
  let size: number
  try {
    const object = await bucket.put(r2Key, file.body, { httpMetadata: { contentType: file.contentType } })
    size = object!.size
  } catch (e) {
    await forget()
    throw e
  }
  const [ready] = await db
    .update(csvCaseFiles)
    .set({ status: "ready", size })
    .where(and(eq(csvCaseFiles.id, id), liveCase(db, caseId)))
    .returning()
  if (ready) return toFile(ready)
  await forget()
  return undefined
}

/** 置き終わったファイルの行 */
export async function getFileRow(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(csvCaseFiles)
    .where(and(eq(csvCaseFiles.id, id), eq(csvCaseFiles.status, "ready")))
  return row
}

// ---- 削除（何度実行しても、途中で落ちた後でも、最後には何も残らない） ----

export async function deletionCounts(db: Db, target: { customerId: string } | { caseId: string }): Promise<DeletionCounts> {
  const where = "caseId" in target ? eq(csvCases.id, target.caseId) : eq(csvCases.customerId, target.customerId)
  const [row] = await db
    .select({ cases: sql<number>`count(distinct ${csvCases.id})`, files: count(csvCaseFiles.id) })
    .from(csvCases)
    .leftJoin(csvCaseFiles, readyFileOf(csvCases.id))
    .where(where)
  return { cases: row?.cases ?? 0, files: row?.files ?? 0 }
}

async function deleteObjects(bucket: Bucket, prefix: string) {
  for (;;) {
    const page = await bucket.list({ prefix })
    if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key))
    if (!page.truncated) return
  }
}

/**
 * 削除中の印 → R2 → ファイルの行 → 状態 → AI の結果 → 工事場所の調査の回 → 案件 の順。印を立てた後はファイルも状態も足せないので、R2 を消した後に増えない。
 * 工事場所の調査の裏の処理は、印を見てから AI を呼び、結果も費用も案件の行が無ければ書かない（変更案を置いたあとに印を見て消す）ので、走っていても残らない。
 * 案件の行がもう無くても R2 はキーの頭で消す（前の削除が R2 の途中で落ちた・置いている途中のファイルが残った場合）
 */
export async function deleteCase(db: Db, bucket: Bucket, caseId: string) {
  await db.update(csvCases).set({ deleting: true }).where(eq(csvCases.id, caseId))
  await deleteObjects(bucket, casePrefix(caseId))
  await db.delete(csvCaseFiles).where(eq(csvCaseFiles.caseId, caseId))
  await db.delete(csvCaseStates).where(eq(csvCaseStates.caseId, caseId))
  await db.delete(csvCaseAiCaches).where(eq(csvCaseAiCaches.caseId, caseId))
  await db.delete(csvRuleAppends).where(eq(csvRuleAppends.caseId, caseId))
  await deleteRunsOfCase(db, caseId)
  await db.delete(csvCases).where(eq(csvCases.id, caseId))
}

export async function deleteCustomer(db: Db, bucket: Bucket, customerId: string) {
  const cases = await db.select({ id: csvCases.id }).from(csvCases).where(eq(csvCases.customerId, customerId))
  for (const c of cases) await deleteCase(db, bucket, c.id)
  // 顧客ルールは顧客の行にあるので一緒に消える
  await db.delete(csvCustomers).where(eq(csvCustomers.id, customerId))
}
