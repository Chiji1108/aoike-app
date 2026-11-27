/** 顧客・案件・ファイル。サーバー関数がそのまま返す素の値（日時は Unix ミリ秒） */

export const CASE_STATUSES = ["converting", "inquiring", "done"] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]
export const CASE_STATUS_LABELS: Record<CaseStatus, string> = { converting: "変換中", inquiring: "問い合わせ中", done: "完了" }

/** source: 届いたファイル（Excel・CSV・PDF・顧客の回答のファイル）。csv: 出力した CSV。final_sheet: ダウンロードした最後の Excel */
export const FILE_KINDS = ["source", "csv", "final_sheet"] as const
export type FileKind = (typeof FILE_KINDS)[number]
export const FILE_KIND_LABELS: Record<FileKind, string> = { source: "届いたファイル", csv: "CSV", final_sheet: "最後のExcel" }

/**
 * 届いた（received: アップロードしたもの）か、
 * 作った（made: この画面でダウンロードしたときに残した控え）か。届いたものは作業の画面の上のファイルの行に、作ったものは見出しの「…」のダウンロードの履歴に出す。
 * 控えはサーバーに残し続ける（あとからそのときの中身をダウンロードできる）
 */
export type FileOrigin = "received" | "made"
export const FILE_ORIGINS: Record<FileKind, FileOrigin> = { source: "received", csv: "made", final_sheet: "made" }

/** 作業の画面の上のファイルの行に出すファイル（届いたもの。付けた順） */
export const receivedFiles = (files: readonly CaseFile[]) => files.filter((f) => FILE_ORIGINS[f.kind] === "received")

/** ダウンロードの履歴（作った控え。新しい順） */
/** 新しい順。同じ時刻なら後から足したもの（files の後ろ）を先に */
export const downloadHistory = (files: readonly CaseFile[]) =>
  files
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => FILE_ORIGINS[f.kind] === "made")
    .sort((a, b) => b.f.createdAt - a.f.createdAt || b.i - a.i)
    .map(({ f }) => f)

export const FILE_STATUSES = ["pending", "ready"] as const

export type Customer = { id: string; name: string; createdAt: number; updatedAt: number }
export type CustomerSummary = Customer & { caseCount: number }

/** deleting: 削除の途中（前の削除が途中で失敗した。もう一度削除すると消し切れる） */
export type Case = { id: string; customerId: string; fiscalYear: number; status: CaseStatus; costUsd: number; deleting: boolean; createdAt: number; updatedAt: number }

export type CaseFile = { id: string; caseId: string; kind: FileKind; name: string; contentType: string; size: number; createdAt: number }

/** 削除の確認に出す件数 */
export type DeletionCounts = { cases: number; files: number }

export const r2KeyOf = (caseId: string, fileId: string) => `cases/${caseId}/${fileId}`
export const casePrefix = (caseId: string) => `cases/${caseId}/`

/** 変換の元にできるファイル（ブラウザの readWorkbook で読めるもの） */
export function isSheetFile(name: string) {
  return /\.(xlsx|xls|csv)$/i.test(name)
}

const CONTENT_TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  pdf: "application/pdf",
  // 顧客の回答（メールを保存したもの・Word の文書）。チャットの AI が読む
  txt: "text/plain",
  eml: "message/rfc822",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // スキャン・手書きの写真（チャットの AI がそのまま見る。lib/chat/view-file.ts。HEIC は AI が見られないが、届いたファイルとして保存はする）
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
}

/** ファイルを付けるボタンで選べるファイル（ドラッグしたときは選ばない。表として読めないファイルは届いたファイルとして保存し、チャットの AI が読む） */
export const ATTACH_ACCEPT = ".xlsx,.xls,.csv,.pdf,.txt,.eml,.docx,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif"

/** 保存して返すときの種類。名前の拡張子で決め、送り手の Content-Type は使わない（ほかの種類は中身を開かせない octet-stream） */
export function contentTypeOf(name: string) {
  return CONTENT_TYPES[/\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream"
}

/** AI のコンテナに置くときの名前（i は会話で上げた順。元の名前は日本語のことがあるので、file-<n>.<拡張子> にする） */
export const containerName = (i: number, fileName: string) => `file-${i + 1}${/\.[A-Za-z0-9]+$/.exec(fileName)?.[0]?.toLowerCase() ?? ""}`

export const fileUrl = (fileId: string) => `/api/csv/files/${fileId}`

/** 届いたファイルがあり、そのどれも表のファイル（変換の元にできるもの）でない（PDF・画像だけの案件。AI に一から表を作らせる） */
export function onlyNonSheetSources(files: readonly CaseFile[]) {
  const sources = files.filter((f) => f.kind === "source")
  return sources.length > 0 && !sources.some((f) => isSheetFile(f.name))
}
