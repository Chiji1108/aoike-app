import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, lte, max, or, sql } from "drizzle-orm"
import type { BatchItem, BatchResponse } from "drizzle-orm/batch"
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core"
import { fitCases, fitDefects, fitEquipment, fitFileDownloads, fitFiles, fitProcedures, fitSettings, fitWeeklyReports, type FitCase, type FitDefect, type FitFile, type FitProcedure } from "@/db/fit-schema"
import { outputKwOf, type Equipment } from "@/lib/fit/checks"
import { TRASH_DAYS, lastPurgeableBookYear, r2KeyOf, type DocType } from "@/lib/fit/documents"
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

// ---- 設備 ----

export async function getEquipment(db: Db, caseId: string): Promise<Equipment[]> {
  return db
    .select({ kind: fitEquipment.kind, maker: fitEquipment.maker, model: fitEquipment.model, watts: fitEquipment.watts, count: fitEquipment.count })
    .from(fitEquipment)
    .where(eq(fitEquipment.caseId, caseId))
    .orderBy(asc(fitEquipment.sortOrder))
}

/**
 * 案件の設備をまとめて入れ替える（1つの処理で消して足す）。useOutput なら、求めた出力を案件の出力にも入れる（同じ処理で。ほかの項目は触らない）。
 * 入れた出力を返す（入れなければ null）
 */
export async function saveEquipment(db: Db, caseId: string, items: Equipment[], useOutput = false): Promise<number | null> {
  if (!(await getCase(db, caseId))) throw new Error("案件が見つかりません")
  const output = useOutput ? outputKwOf(items) : null
  if (useOutput && output === null) throw new Error("パネルとパワコンを入れると出力を求められます")
  const writes = [
    db.delete(fitEquipment).where(eq(fitEquipment.caseId, caseId)),
    ...(items.length ? [db.insert(fitEquipment).values(items.map((e, i) => ({ ...e, caseId, sortOrder: i })))] : []),
    ...(output !== null ? [db.update(fitCases).set({ outputKw: output }).where(eq(fitCases.id, caseId))] : []),
  ]
  await db.batch(writes as [(typeof writes)[number], ...typeof writes])
  return output
}

/** 侍で作った請求書の番号と発行日を、手続にまとめて入れる（請求の月の明細から） */
export async function setInvoice(db: Db, ids: string[], invoiceNumber: string, invoicedOn: string) {
  // D1 は1つの文に渡せる値が100個まで
  for (let i = 0; i < ids.length; i += 90) await db.update(fitProcedures).set({ invoiceNumber, invoicedOn }).where(inArray(fitProcedures.id, ids.slice(i, i + 90)))
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
  case: Pick<FitCase, "id" | "commonId" | "name" | "kana" | "builder" | "siteAddressKind" | "address">
  /** まだ済んでいない不備・補正 */
  openDefects: Pick<FitDefect, "kind" | "content" | "dueOn">[]
}

/** 手続を事件簿の番号の順に（案件の項目と、済んでいない不備をつけて） */
export async function listProcedures(db: Db): Promise<ProcedureListRow[]> {
  const [rows, defects] = await Promise.all([
    db
      .select({ p: fitProcedures, c: { id: fitCases.id, commonId: fitCases.commonId, name: fitCases.name, kana: fitCases.kana, builder: fitCases.builder, siteAddressKind: fitCases.siteAddressKind, address: fitCases.address } })
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
  const [files, equipment] = await Promise.all([
    listFiles(
      db,
      procedures.map((p) => p.id),
    ),
    getEquipment(db, id),
  ])
  return { fitCase, procedures, defects: defects.map((r) => r.d), files, equipment }
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

// ---- 書類 ----

/** R2Bucket のうち使うところ（テストは手元の代わりで回す） */
export type Bucket = {
  put(key: string, value: ReadableStream | ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string } }): Promise<{ size: number } | null>
  delete(keys: string[]): Promise<void>
}

export type FileView = Omit<FitFile, "r2Key" | "createdAt" | "purgedAt" | "deletedAt"> & {
  createdAt: number
  deletedAt: number | null
  purgedAt: number | null
  downloads: number
  lastDownloadAt: number | null
}

/**
 * 手続に書類を置く（同じ種類なら版を1つ上げる）。R2 に置いてから記録し、記録できなければ R2 からも消す。
 * 認定通知書を置いたら「認定通知書を保存した」にする（手で印を付けない）
 */
export async function addFile(
  db: Db,
  bucket: Bucket,
  procedureId: string,
  file: { docType: DocType; name: string; contentType: string; body: ReadableStream | ArrayBuffer | Uint8Array; uploadedBy: string },
): Promise<{ id: string; version: number } | undefined> {
  if (!(await getProcedure(db, procedureId))) return undefined
  const id = crypto.randomUUID()
  const r2Key = r2KeyOf(procedureId, id)
  const put = await bucket.put(r2Key, file.body, { httpMetadata: { contentType: file.contentType } })
  if (!put) throw new Error("書類を置けませんでした")
  const nextVersion = sql<number>`(select coalesce(max(${fitFiles.version}), 0) + 1 from ${fitFiles} where ${fitFiles.procedureId} = ${procedureId} and ${fitFiles.docType} = ${file.docType})`
  try {
    const [row] = await db
      .insert(fitFiles)
      .values({ id, procedureId, docType: file.docType, version: nextVersion, name: file.name, contentType: file.contentType, size: put.size, r2Key, uploadedBy: file.uploadedBy })
      .returning({ id: fitFiles.id, version: fitFiles.version })
    if (file.docType === "approval_notice") await db.update(fitProcedures).set({ noticeSaved: true }).where(eq(fitProcedures.id, procedureId))
    return row!
  } catch (e) {
    await bucket.delete([r2Key])
    throw e
  }
}

/** 手続の書類（種類・版の順。ダウンロードの回数と最後の日時をつける） */
export async function listFiles(db: Db, procedureIds: string[]): Promise<FileView[]> {
  if (procedureIds.length === 0) return []
  const rows = await db
    .select({ f: fitFiles, downloads: count(fitFileDownloads.id), last: max(fitFileDownloads.createdAt) })
    .from(fitFiles)
    .leftJoin(fitFileDownloads, eq(fitFileDownloads.fileId, fitFiles.id))
    .where(inArray(fitFiles.procedureId, procedureIds))
    .groupBy(fitFiles.id)
    .orderBy(asc(fitFiles.docType), desc(fitFiles.version))
  return rows.map(({ f: { r2Key: _, ...f }, downloads, last }) => ({
    ...f,
    createdAt: f.createdAt.getTime(),
    deletedAt: f.deletedAt?.getTime() ?? null,
    purgedAt: f.purgedAt?.getTime() ?? null,
    downloads,
    // max() は列の型を引き継がず、sqlite のミリ秒の数のまま返る
    lastDownloadAt: last == null ? null : Number(last instanceof Date ? last.getTime() : last),
  }))
}

export async function getFileRow(db: Db, id: string) {
  const [row] = await db.select().from(fitFiles).where(eq(fitFiles.id, id))
  return row
}

export async function recordDownload(db: Db, fileId: string, userId: string) {
  await db.insert(fitFileDownloads).values({ fileId, userId })
}

/** 手続が終わった（入金済み・取下げ・中止） */
const finished = or(isNotNull(fitProcedures.paidOn), isNotNull(fitProcedures.closeReason))

/** 保存期間が過ぎて消してよい書類（消す前に一覧で確かめる） */
export async function purgeableFiles(db: Db, years: number, today: string) {
  const rows = await db
    .select({ file: fitFiles, bookYear: fitProcedures.bookYear, seq: fitProcedures.seq, caseId: fitProcedures.caseId, name: fitCases.name })
    .from(fitFiles)
    .innerJoin(fitProcedures, eq(fitProcedures.id, fitFiles.procedureId))
    .innerJoin(fitCases, eq(fitCases.id, fitProcedures.caseId))
    // 帳簿を閉じた年末から years 年たった年の書類だけを読む
    // ゴミ箱の書類は30日で消えるので、ここには出さない
    .where(and(isNull(fitFiles.purgedAt), isNull(fitFiles.deletedAt), finished, lte(fitProcedures.bookYear, lastPurgeableBookYear(years, today))))
    .orderBy(asc(fitProcedures.bookYear), asc(fitProcedures.seq), asc(fitFiles.docType), asc(fitFiles.version))
  return rows.map(({ file: { r2Key: _, deletedAt: __, ...f }, ...r }) => ({ ...r, file: { ...f, createdAt: f.createdAt.getTime(), purgedAt: null } }))
}

/** 保存期間が過ぎた書類を R2 から消し、記録に消した日時を入れる（期間が過ぎていないものは消さない） */
export async function purgeFiles(db: Db, bucket: Bucket, ids: string[], years: number, today: string) {
  const allowed = new Set((await purgeableFiles(db, years, today)).map((r) => r.file.id))
  const targets = ids.filter((id) => allowed.has(id))
  if (targets.length === 0) return 0
  // D1 は1つの文に渡せる値が100個までなので分けて消す（R2 の delete は1000件まで）
  for (let i = 0; i < targets.length; i += 90) {
    const chunk = targets.slice(i, i + 90)
    const rows = await db.select({ r2Key: fitFiles.r2Key }).from(fitFiles).where(inArray(fitFiles.id, chunk))
    await bucket.delete(rows.map((r) => r.r2Key))
    await db.update(fitFiles).set({ purgedAt: new Date() }).where(inArray(fitFiles.id, chunk))
  }
  return targets.length
}

// ---- ゴミ箱 ----

/** 手続にまだ使える（ゴミ箱でも消してもいない）認定通知書があるか */
async function hasLiveNotice(db: Db, procedureId: string) {
  const [row] = await db
    .select({ id: fitFiles.id })
    .from(fitFiles)
    .where(and(eq(fitFiles.procedureId, procedureId), eq(fitFiles.docType, "approval_notice"), isNull(fitFiles.deletedAt), isNull(fitFiles.purgedAt)))
    .limit(1)
  return !!row
}

/**
 * 書類をゴミ箱に入れる（30日のうちは戻せる）。認定通知書がほかに残らなければ「認定通知書を保存した」を外す
 * （置き間違いを消したのに保存済みのままだと、完了通知に進めてしまう）
 */
export async function trashFile(db: Db, id: string, userId: string) {
  const row = await getFileRow(db, id)
  if (!row || row.purgedAt) throw new Error("書類が見つかりません")
  if (row.deletedAt) return
  await db.update(fitFiles).set({ deletedAt: new Date(), deletedBy: userId }).where(eq(fitFiles.id, id))
  if (row.docType === "approval_notice" && !(await hasLiveNotice(db, row.procedureId))) {
    await db.update(fitProcedures).set({ noticeSaved: false }).where(eq(fitProcedures.id, row.procedureId))
  }
}

/** ゴミ箱から戻す（R2 から消える前だけ）。認定通知書なら「保存した」に戻す */
export async function restoreFile(db: Db, id: string) {
  const row = await getFileRow(db, id)
  if (!row || row.purgedAt) throw new Error("ゴミ箱から消えたので戻せません")
  if (!row.deletedAt) return
  await db.update(fitFiles).set({ deletedAt: null, deletedBy: null }).where(eq(fitFiles.id, id))
  if (row.docType === "approval_notice") await db.update(fitProcedures).set({ noticeSaved: true }).where(eq(fitProcedures.id, row.procedureId))
}

/** ゴミ箱に入れてから30日たった書類を R2 から消し、消した日時を入れる（毎日の定時の処理）。消した数を返す */
export async function emptyTrash(db: Db, bucket: Bucket, now = Date.now()) {
  const rows = await db
    .select({ id: fitFiles.id, r2Key: fitFiles.r2Key })
    .from(fitFiles)
    .where(and(isNull(fitFiles.purgedAt), lt(fitFiles.deletedAt, new Date(now - TRASH_DAYS * 86_400_000))))
  // D1 は1つの文に渡せる値が100個まで
  for (let i = 0; i < rows.length; i += 90) {
    const chunk = rows.slice(i, i + 90)
    await bucket.delete(chunk.map((r) => r.r2Key))
    await db
      .update(fitFiles)
      .set({ purgedAt: new Date(now) })
      .where(
        inArray(
          fitFiles.id,
          chunk.map((r) => r.id),
        ),
      )
  }
  return rows.length
}
