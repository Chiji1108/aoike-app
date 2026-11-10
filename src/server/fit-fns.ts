import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { env } from "cloudflare:workers"
import { getFitDb } from "@/db"
import { CLOSE_REASONS, DEFECT_KINDS, DEFECT_PARTIES, PROCEDURE_KINDS, SITE_ADDRESS_KINDS, SPECIAL_PAYERS } from "@/lib/fit/types"
import { EQUIPMENT_KINDS, MANUAL_CHECKS } from "@/lib/fit/checks"
import { settingsSchema } from "@/lib/fit/settings"
import { compareWeekly, weeklyValues } from "@/lib/fit/weekly"
import { todayIso } from "@/lib/period"
import { authMiddleware } from "./middleware"
import * as store from "./fit-store"

/** FIT 申請のサーバー関数（事務所アカウントでのログインが必要。入力は Zod で確かめる） */

const id = z.string().min(1).max(64)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付の形が違います")
const optionalDate = isoDate.nullable()
const text = (max: number) => z.string().trim().max(max, `${max}文字以内で入力してください`)
const yen = z.number().int().min(0).max(10_000_000, "金額が大きすぎます").nullable()

const caseSchema = z.object({
  // 空は「まだ無い」（一意の索引で比べない）
  commonId: text(30).transform((v) => v || null),
  name: text(100).min(1, "お客様の氏名を入力してください"),
  kana: text(100),
  postalCode: text(10),
  address: text(200),
  phone: text(30),
  email: text(200),
  sitePostalCode: text(10),
  siteAddress: text(200),
  siteKana: text(200),
  siteAddressKind: z.enum(SITE_ADDRESS_KINDS).nullable(),
  builder: text(100),
  outputKw: z.number().min(0).max(100, "出力が大きすぎます（10kW 未満の申請です）").nullable(),
  hasBattery: z.boolean(),
  sharedOwnership: z.boolean(),
  note: text(2000),
})

const procedurePatchSchema = z
  .object({
    kind: z.enum(PROCEDURE_KINDS),
    receivedOn: isoDate,
    poaReceivedOn: optionalDate,
    noticeOn: optionalDate,
    answeredOn: optionalDate,
    sealCertIssuedOn: optionalDate,
    fee: yen,
    special: z.boolean(),
    specialAmount: yen,
    specialPayer: z.enum(SPECIAL_PAYERS).nullable(),
    specialNotifiedOn: optionalDate,
    specialAnsweredOn: optionalDate,
    onHold: z.boolean(),
    holdReason: text(500),
    appliedOn: optionalDate,
    applicationId: text(50),
    approvedOn: optionalDate,
    facilityId: text(50),
    businessId: text(50),
    noticeSaved: z.boolean(),
    completedOn: optionalDate,
    invoicedOn: optionalDate,
    invoiceNumber: text(50),
    paidOn: optionalDate,
    closeReason: z.enum(CLOSE_REASONS).nullable(),
    checks: z.partialRecord(z.enum(MANUAL_CHECKS), z.boolean()),
    note: text(2000),
  })
  .partial()

const defectSchema = z.object({
  kind: z.enum(DEFECT_KINDS),
  content: text(500).min(1, "不備の内容を入力してください"),
  receivedOn: optionalDate,
  dueOn: optionalDate,
  requestedTo: z.enum(DEFECT_PARTIES).nullable(),
  resolvedOn: optionalDate,
})

/** 手続の一覧とトップ：手続と、期限の見張りに使う設定 */
export const listProceduresFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const db = getFitDb()
    const [rows, settings] = await Promise.all([store.listProcedures(db), store.getSettings(db)])
    return { rows, settings }
  })

export const getSettingsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => store.getSettings(getFitDb()))

export const saveSettingsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(settingsSchema)
  .handler(({ data }) => store.saveSettings(getFitDb(), data))

/** 申込書を受け付けたとき：案件と最初の手続を作る */
export const createCaseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ fitCase: caseSchema, kind: z.enum(PROCEDURE_KINDS), receivedOn: isoDate }))
  .handler(({ data }) => store.createCase(getFitDb(), data.fitCase, { kind: data.kind, receivedOn: data.receivedOn }))

/** 案件の画面（手続の編集で報酬表の額を見せるので、報酬表もつける）。案件が無ければ null */
export const getCasePageFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ id }))
  .handler(async ({ data }) => {
    const db = getFitDb()
    const [page, settings] = await Promise.all([store.getCasePage(db, data.id), store.getSettings(db)])
    return page ? { ...page, feeTables: settings.feeTables } : null
  })

export const updateCaseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id, fitCase: caseSchema }))
  .handler(({ data }) => store.updateCase(getFitDb(), data.id, data.fitCase))

export const addProcedureFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ caseId: id, kind: z.enum(PROCEDURE_KINDS), receivedOn: isoDate }))
  .handler(({ data }) => store.addProcedure(getFitDb(), data.caseId, data.kind, data.receivedOn))

export const updateProcedureFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id, patch: procedurePatchSchema }))
  .handler(({ data }) => store.updateProcedure(getFitDb(), data.id, data.patch))

export const saveEquipmentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      caseId: id,
      items: z
        .array(
          z.object({
            kind: z.enum(EQUIPMENT_KINDS),
            maker: text(100),
            model: text(100),
            watts: z.number().int("出力は整数の W で入れてください").min(1, "出力（W）を入れてください").max(100_000, "出力（W）が大きすぎます"),
            count: z.number().int("数は整数で入れてください").min(1, "数を入れてください").max(1000, "数が大きすぎます"),
          }),
        )
        .max(50),
      /** 求めた出力を案件の出力にも入れる */
      useOutput: z.boolean().optional(),
    }),
  )
  .handler(({ data }) => store.saveEquipment(getFitDb(), data.caseId, data.items, data.useOutput))

export const setInvoiceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ ids: z.array(id).min(1).max(1000), invoiceNumber: text(50).min(1, "請求書番号を入れてください"), invoicedOn: isoDate }))
  .handler(({ data }) => store.setInvoice(getFitDb(), data.ids, data.invoiceNumber, data.invoicedOn))

export const addDefectFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ procedureId: id, defect: defectSchema }))
  .handler(({ data }) => store.addDefect(getFitDb(), data.procedureId, data.defect))

export const updateDefectFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id, defect: defectSchema.partial() }))
  .handler(({ data }) => store.updateDefect(getFitDb(), data.id, data.defect))

export const deleteDefectFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id }))
  .handler(({ data }) => store.deleteDefect(getFitDb(), data.id))

// ---- 週次の案件表 ----

/** 今の手続を案件表の行にし、いちばん新しい記録と比べる */
async function currentWeekly(db: store.Db) {
  const [rows, previous] = await Promise.all([store.listProcedures(db), store.latestWeeklyRows(db)])
  const current = store.weeklySources(rows).map((s) => ({ id: s.id, values: weeklyValues(s) }))
  return { current, previous, rows: compareWeekly(current, previous) }
}

/** 出す前の確認（前回から変わった行）と、出した記録 */
export const weeklyPreviewFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const db = getFitDb()
    const [{ previous, rows }, reports] = await Promise.all([currentWeekly(db), store.listWeeklyReports(db)])
    return { rows, hasPrevious: previous !== null, reports }
  })

/** 案件表を出して記録する（記録した行と、前回と比べた印を返す。Excel は画面で作る） */
export const exportWeeklyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const db = getFitDb()
    const { current, rows } = await currentWeekly(db)
    const meta = await store.saveWeeklyReport(db, Object.fromEntries(current.map((r) => [r.id, r.values])))
    return { meta, rows }
  })

/** 前に出した案件表を、そのときと同じ印で出し直す */
export const getWeeklyReportFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ id }))
  .handler(async ({ data }) => {
    const report = await store.getWeeklyReport(getFitDb(), data.id)
    if (!report) return null
    const current = Object.entries(report.rows).map(([id, values]) => ({ id, values }))
    return { meta: report.meta, rows: compareWeekly(current, report.previous) }
  })

// ---- 書類のゴミ箱 ----

export const trashFileFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id }))
  .handler(({ data, context }) => store.trashFile(getFitDb(), data.id, context.session.user.id))

export const restoreFileFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id }))
  .handler(({ data }) => store.restoreFile(getFitDb(), data.id))

// ---- 書類の保存期間 ----

/** 保存期間が過ぎて消してよい書類（消す前に確かめる一覧） */
export const purgeableFilesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const db = getFitDb()
    const { retentionYears } = await store.getSettings(db)
    return { retentionYears, rows: await store.purgeableFiles(db, retentionYears, todayIso()) }
  })

/** 選んだ書類を消す（期間が過ぎていないものは消さない）。消した数を返す */
export const purgeFilesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ ids: z.array(id).min(1).max(5000) }))
  .handler(async ({ data }) => {
    const db = getFitDb()
    const { retentionYears } = await store.getSettings(db)
    return store.purgeFiles(db, env.FIT_FILES, data.ids, retentionYears, todayIso())
  })
