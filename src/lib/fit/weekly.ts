import { PROCEDURE_KIND_LABELS, type ProcedureKind } from "./types"
import { acceptedOnOf, bookNumber } from "./procedure"

/**
 * SHARP への週次の案件表（SHARP の資料「確認事項_COCORO POWER フロー案」4ページ目の列の順。1行＝1手続）。
 * 出した行は記録に残し、次に出すときに前回から変わったセルへ印を付ける
 */
export const WEEKLY_COLUMNS = [
  "申請区分",
  "COCORO POWER\n共通ID",
  "顧客名",
  "ビルダー名",
  "貴社\n管理番号",
  "青池様\n受付日",
  "青池様\n受任日",
  "不備内容",
  "fit申請日",
  "申請ID",
  "fit認定日",
  "設備ID",
  "青池事務所\n完了通知日",
  "請求書\n発行日",
] as const

/** 日付の列（Excel では日付のセルにする） */
export const WEEKLY_DATE_COLUMNS: ReadonlySet<number> = new Set([5, 6, 8, 10, 12, 13])

export type WeeklyValues = (string | null)[]

export type WeeklySource = {
  id: string
  kind: ProcedureKind
  bookYear: number
  seq: number
  receivedOn: string
  poaReceivedOn: string | null
  appliedOn: string | null
  applicationId: string
  approvedOn: string | null
  facilityId: string
  completedOn: string | null
  invoicedOn: string | null
  case: { commonId: string | null; name: string; builder: string }
  /** まだ済んでいない不備・補正の内容 */
  openDefects: string[]
}

const orNull = (v: string | null | undefined) => (v ? v : null)

/** 案件表の1行の値（日付は YYYY-MM-DD のまま。空は null） */
export function weeklyValues(p: WeeklySource): WeeklyValues {
  return [
    PROCEDURE_KIND_LABELS[p.kind],
    orNull(p.case.commonId),
    p.case.name,
    orNull(p.case.builder),
    bookNumber(p.bookYear, p.seq),
    p.receivedOn,
    acceptedOnOf(p),
    orNull(p.openDefects.join("、")),
    orNull(p.appliedOn),
    orNull(p.applicationId),
    orNull(p.approvedOn),
    orNull(p.facilityId),
    orNull(p.completedOn),
    orNull(p.invoicedOn),
  ]
}

export type WeeklyRow = {
  id: string
  values: WeeklyValues
  /** 前回の案件表に無かった行 */
  added: boolean
  /** 列ごとに、前回から変わったか（足した行はすべて false） */
  changed: boolean[]
}

/** 前回の記録（手続 id → 値）と比べる。前回が無ければ（初めて出すとき）すべて足した行 */
export function compareWeekly(current: { id: string; values: WeeklyValues }[], previous: Record<string, WeeklyValues> | null): WeeklyRow[] {
  return current.map(({ id, values }) => {
    const before = previous?.[id]
    if (!before) return { id, values, added: true, changed: values.map(() => false) }
    return { id, values, added: false, changed: values.map((v, i) => (before[i] ?? null) !== v) }
  })
}

/** 「今週の変更」のシートに出す行（足した行と、どこかのセルが変わった行） */
export const isUpdated = (r: WeeklyRow) => r.added || r.changed.some(Boolean)
