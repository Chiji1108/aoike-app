import type { ProcedureKind } from "./types"

/**
 * 手続の書類（R2 に置き、手続にひもづける）。同じ種類の書類を置き直すと新しい版になり、前の版も残す（上書き・削除はしない）
 */
export const DOC_TYPES = [
  "application_form",
  "building_cert",
  "layout",
  "grid_contract",
  "poa",
  "seal_cert",
  "consent",
  "approval_notice",
  "approval_cert",
  "application_copy",
  "other",
] as const
export type DocType = (typeof DOC_TYPES)[number]

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  application_form: "申込書",
  building_cert: "確認済証・登記簿",
  layout: "CAD割付図",
  grid_contract: "接続契約（接続同意書）",
  poa: "委任状",
  seal_cert: "印鑑証明",
  consent: "無償使用の同意書",
  approval_notice: "認定通知書",
  approval_cert: "認定証明書",
  application_copy: "申請書の控え",
  other: "その他",
}

/**
 * 申請に要る書類（書類チェックの「届いた」を見る）。新規認定は SHARP から届く書類一式と委任状・印鑑証明、共有名義なら同意書。
 * 変更系は手続によって違うので、委任状・印鑑証明だけを見る（ほかは「その他」で置く）
 */
export function requiredDocs(kind: ProcedureKind, sharedOwnership: boolean): DocType[] {
  if (kind !== "new") return ["poa", "seal_cert"]
  return ["application_form", "building_cert", "layout", "grid_contract", "poa", "seal_cert", ...(sharedOwnership ? (["consent"] as const) : [])]
}

/** 書類の大きさの上限（Workers が受け取れる本文の上限） */
export const MAX_DOC_BYTES = 100 * 1024 * 1024

/**
 * 保存期間：帳簿は閉じてから2年（行政書士法第9条第2項）、関係書類とともに保存する。事件簿は暦年で閉じるので、
 * その年の年末から years 年たった日まで残す
 */
export const retentionUntil = (bookYear: number, years: number) => `${bookYear + years}-12-31`

/** 保存期間が過ぎて消してよい書類か（手続が終わっていて、保存の期限を過ぎた） */
export function isPurgeable(p: { bookYear: number; finished: boolean }, years: number, today: string) {
  return p.finished && today > retentionUntil(p.bookYear, years)
}

export const fileUrl = (fileId: string) => `/api/fit/files/${fileId}`

/** R2 の置き場所（手続ごと） */
export const r2KeyOf = (procedureId: string, fileId: string) => `fit/${procedureId}/${fileId}`
