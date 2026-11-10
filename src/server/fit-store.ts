import { asc, desc, eq, isNull, lt, sql } from "drizzle-orm"
import type { BatchItem, BatchResponse } from "drizzle-orm/batch"
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core"
import { fitCases, fitDefects, fitProcedures, fitSettings, fitWeeklyReports, type FitCase, type FitDefect, type FitProcedure } from "@/db/fit-schema"
import type * as schema from "@/db/fit-schema"
import { acceptedOnOf, bookYearOf } from "@/lib/fit/procedure"
import { feeFor, withDefaults, type FitSettings } from "@/lib/fit/settings"
import { APPROVAL_KINDS, type ProcedureKind } from "@/lib/fit/types"
import { groupBy } from "@/lib/group-by"
import type { WeeklySource, WeeklyValues } from "@/lib/fit/weekly"

/**
 * FIT 申請の案件・手続・不備・週次の案件表の記録の読み書き（D1）。サーバー関数から呼ぶ。
 * D1 でも bun:sqlite でも動くよう、drizzle の sqlite の型で受ける（テストは bun:sqlite で回す）
 */
export type Db = BaseSQLiteDatabase<"sync" | "async", unknown, typeof schema> & {
  batch<U extends BatchItem<"sqlite">, T extends Readonly<[U, ...U[]]>>(batch: T): Promise<BatchResponse<T>>
}

/** 同じ共通ID の案件がもうある */
export class DuplicateCommonIdError extends Error {
  constructor(commonId: string) {
    super(`共通ID ${commonId} の案件はもうあります`)
  }
}

export type CaseInput = Omit<FitCase, "id" | "createdAt" | "updatedAt">

/** 手続で、画面から直せる項目（事件簿の番号・案件は変えない） */
export type ProcedurePatch = Partial<Omit<FitProcedure, "id" | "caseId" | "bookYear" | "seq" | "createdAt" | "updatedAt">>

export type DefectInput = Omit<FitDefect, "id" | "procedureId" | "createdAt" | "updatedAt">

const isCommonIdConflict = (e: unknown) => {
  // D1 は元のエラーを cause に入れる。drizzle も包むので、つながったメッセージを全部見る
  for (let x: unknown = e; x instanceof Error; x = x.cause) if (/UNIQUE constraint failed: fit_cases\.common_id/.test(x.message)) return true
  return false
}

/** 共通ID の重複を、画面に出せるエラーにする */
async function guardCommonId<T>(commonId: string | null, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    if (commonId && isCommonIdConflict(e)) throw new DuplicateCommonIdError(commonId)
    throw e
  }
}

/** 受付日の年の次の番号で手続を足す文（番号は1つの文の中で求めるので、同時に足しても重ならない） */
function insertProcedure(db: Db, caseId: string, kind: ProcedureKind, receivedOn: string) {
  const bookYear = bookYearOf(receivedOn)
  const nextSeq = sql<number>`(select coalesce(max(${fitProcedures.seq}), 0) + 1 from ${fitProcedures} where ${fitProcedures.bookYear} = ${bookYear})`
  return db.insert(fitProcedures).values({ caseId, kind, receivedOn, bookYear, seq: nextSeq }).returning({ id: fitProcedures.id })
}

// ---- 案件 ----

/** 案件と最初の手続を一緒に作る（申込書を受け付けたとき） */
export async function createCase(db: Db, input: CaseInput, first: { kind: ProcedureKind; receivedOn: string }): Promise<{ caseId: string; procedureId: string }> {
  const caseId = crypto.randomUUID()
  const [, [procedure]] = await guardCommonId(input.commonId, () =>
    db.batch([db.insert(fitCases).values({ ...input, id: caseId }), insertProcedure(db, caseId, first.kind, first.receivedOn)]),
  )
  return { caseId, procedureId: procedure!.id }
}

export async function updateCase(db: Db, id: string, patch: Partial<CaseInput>) {
  await guardCommonId(patch.commonId ?? null, () => db.update(fitCases).set(patch).where(eq(fitCases.id, id)))
}

export async function getCase(db: Db, id: string) {
  const [row] = await db.select().from(fitCases).where(eq(fitCases.id, id))
  return row
}

// ---- 手続 ----

export async function addProcedure(db: Db, caseId: string, kind: ProcedureKind, receivedOn: string) {
  if (!(await getCase(db, caseId))) throw new Error("案件が見つかりません")
  const [row] = await insertProcedure(db, caseId, kind, receivedOn)
  return row!
}

export async function getProcedure(db: Db, id: string) {
  const [row] = await db.select().from(fitProcedures).where(eq(fitProcedures.id, id))
  return row
}

/**
 * 手続を直す。受任した（申込書と委任状がそろった）のに報酬額が空なら、受任日の報酬表の額を入れる
 * （入れた額はあとで報酬表が変わっても動かさない。手で直した額もそのまま）。
 * 額を入れずに申請区分だけを変えたら（告知で区分が決まったときなど）、新しい区分の額に入れ直す
 */
export async function updateProcedure(db: Db, id: string, patch: ProcedurePatch) {
  const current = await getProcedure(db, id)
  if (!current) throw new Error("手続が見つかりません")
  // 番号は受付日の年で付けたので、年をまたぐ直しはさせない（番号の年と受付日の年がずれる）
  if (patch.receivedOn && bookYearOf(patch.receivedOn) !== current.bookYear) throw new Error(`受付日は番号の年（${current.bookYear}年）の日付にしてください。年が違うなら新しい手続を足してください`)
  const kindChanged = patch.kind !== undefined && patch.kind !== current.kind && patch.fee === undefined
  const next = { ...current, ...patch, ...(kindChanged && { fee: null }) }
  // 認定通知書は1回しかダウンロードできないので、保存したと印を付けるまで完了通知に進めない
  if (next.completedOn && !next.noticeSaved && APPROVAL_KINDS.has(next.kind)) throw new Error("認定通知書を保存してから、完了通知日を入れてください")
  const accepted = acceptedOnOf(next)
  const fee = next.fee == null && accepted ? feeFor(next.kind, accepted, (await getSettings(db)).feeTables) : next.fee
  await db
    .update(fitProcedures)
    .set({ ...patch, fee })
    .where(eq(fitProcedures.id, id))
}

// ---- 不備・補正 ----

export async function addDefect(db: Db, procedureId: string, input: DefectInput) {
  if (!(await getProcedure(db, procedureId))) throw new Error("手続が見つかりません")
  const [row] = await db
    .insert(fitDefects)
    .values({ ...input, procedureId })
    .returning({ id: fitDefects.id })
  return row!
}

export async function updateDefect(db: Db, id: string, patch: Partial<DefectInput>) {
  await db.update(fitDefects).set(patch).where(eq(fitDefects.id, id))
}

/** 間違えて足した不備を消す（帳簿の記載事項ではないので消してよい） */
export async function deleteDefect(db: Db, id: string) {
  await db.delete(fitDefects).where(eq(fitDefects.id, id))
}

// ---- 設定 ----

const SETTINGS_ID = "default"

/** 設定（保存してない項目は初期値） */
export async function getSettings(db: Db): Promise<FitSettings> {
  const [row] = await db.select({ value: fitSettings.value }).from(fitSettings).where(eq(fitSettings.id, SETTINGS_ID))
  return withDefaults(row?.value)
}

export async function saveSettings(db: Db, value: FitSettings) {
  await db.insert(fitSettings).values({ id: SETTINGS_ID, value }).onConflictDoUpdate({ target: fitSettings.id, set: { value, updatedAt: new Date() } })
}

// ---- 一覧・案件の画面 ----

export type ProcedureListRow = FitProcedure & {
  case: Pick<FitCase, "id" | "commonId" | "name" | "kana" | "builder" | "siteAddressKind">
  /** まだ済んでいない不備・補正 */
  openDefects: Pick<FitDefect, "kind" | "content" | "dueOn">[]
}

/** 手続を事件簿の番号の順に（案件の項目と、済んでいない不備をつけて） */
export async function listProcedures(db: Db): Promise<ProcedureListRow[]> {
  const [rows, defects] = await Promise.all([
    db
      .select({ p: fitProcedures, c: { id: fitCases.id, commonId: fitCases.commonId, name: fitCases.name, kana: fitCases.kana, builder: fitCases.builder, siteAddressKind: fitCases.siteAddressKind } })
      .from(fitProcedures)
      .innerJoin(fitCases, eq(fitCases.id, fitProcedures.caseId))
      .orderBy(asc(fitProcedures.bookYear), asc(fitProcedures.seq)),
    db
      .select({ procedureId: fitDefects.procedureId, kind: fitDefects.kind, content: fitDefects.content, dueOn: fitDefects.dueOn })
      .from(fitDefects)
      .where(isNull(fitDefects.resolvedOn))
      .orderBy(asc(fitDefects.createdAt)),
  ])
  const open = groupBy(defects, (d) => d.procedureId)
  return rows.map(({ p, c }) => ({ ...p, case: c, openDefects: (open.get(p.id) ?? []).map(({ procedureId: _, ...d }) => d) }))
}

/** 案件の画面（案件・手続・不備）。案件が無ければ undefined */
export async function getCasePage(db: Db, id: string) {
  const fitCase = await getCase(db, id)
  if (!fitCase) return undefined
  const procedures = await db.select().from(fitProcedures).where(eq(fitProcedures.caseId, id)).orderBy(asc(fitProcedures.bookYear), asc(fitProcedures.seq))
  const defects = procedures.length
    ? await db
        .select({ d: fitDefects })
        .from(fitDefects)
        .innerJoin(fitProcedures, eq(fitProcedures.id, fitDefects.procedureId))
        .where(eq(fitProcedures.caseId, id))
        .orderBy(asc(fitDefects.createdAt))
    : []
  return { fitCase, procedures, defects: defects.map((r) => r.d) }
}

// ---- 週次の案件表 ----

export function weeklySources(rows: ProcedureListRow[]): WeeklySource[] {
  return rows.map((r) => ({ ...r, openDefects: r.openDefects.map((d) => d.content) }))
}

export type WeeklyReportMeta = { id: string; createdAt: number; count: number }

const toMeta = (r: typeof fitWeeklyReports.$inferSelect): WeeklyReportMeta => ({ id: r.id, createdAt: r.createdAt.getTime(), count: Object.keys(r.rows).length })

/** 出した記録（新しい順） */
export async function listWeeklyReports(db: Db): Promise<WeeklyReportMeta[]> {
  const rows = await db.select().from(fitWeeklyReports).orderBy(desc(fitWeeklyReports.createdAt))
  return rows.map(toMeta)
}

/** いちばん新しい記録の行（まだ出していなければ null） */
export async function latestWeeklyRows(db: Db): Promise<Record<string, WeeklyValues> | null> {
  const [row] = await db.select({ rows: fitWeeklyReports.rows }).from(fitWeeklyReports).orderBy(desc(fitWeeklyReports.createdAt)).limit(1)
  return row?.rows ?? null
}

/** 出した案件表を記録する */
export async function saveWeeklyReport(db: Db, rows: Record<string, WeeklyValues>): Promise<WeeklyReportMeta> {
  const [row] = await db.insert(fitWeeklyReports).values({ rows }).returning()
  return toMeta(row!)
}

/** 前に出した案件表を、そのとき比べた1つ前の記録と一緒に（出し直す用） */
export async function getWeeklyReport(db: Db, id: string) {
  const [report] = await db.select().from(fitWeeklyReports).where(eq(fitWeeklyReports.id, id))
  if (!report) return undefined
  const [previous] = await db
    .select({ rows: fitWeeklyReports.rows })
    .from(fitWeeklyReports)
    .where(lt(fitWeeklyReports.createdAt, report.createdAt))
    .orderBy(desc(fitWeeklyReports.createdAt))
    .limit(1)
  return { meta: toMeta(report), rows: report.rows, previous: previous?.rows ?? null }
}
