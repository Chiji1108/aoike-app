import type { CloseReason, ProcedureKind } from "./types"

/** 今日（日本時間）の YYYY-MM-DD */
export function todayIso(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** 事件簿の年（受付日の年。今の事件簿と同じく暦年で区切る） */
export const bookYearOf = (receivedOn: string) => Number(receivedOn.slice(0, 4))

/**
 * 事件簿の番号。「F8-0001」＝ F（FIT）＋和暦の年の数字（令和）−その年の通し番号4桁。
 * 今の事件簿の「30-097」と見分けがつき、SHARP の案件表の「貴社管理番号」にもこのまま出す
 */
export function bookNumber(bookYear: number, seq: number) {
  return `F${bookYear - 2018}-${String(seq).padStart(4, "0")}`
}

/** 受任日＝申込書と委任状がそろった日（遅いほう）。片方でも無ければまだ受任していない */
export function acceptedOnOf(p: { receivedOn: string; poaReceivedOn: string | null }): string | null {
  if (!p.poaReceivedOn) return null
  return p.poaReceivedOn > p.receivedOn ? p.poaReceivedOn : p.receivedOn
}

/**
 * 報酬表（税込・円）。acceptedUntil までに受任したものにその表を使う（古い順に並べる）。
 * 申込書の別紙1（2027-03-31 までに受任時の価格）。その他変更認定は事案ごとなので表に額が無い（手で入れる）。
 * 次の報酬表が決まったら、下に足す
 */
export const FEE_TABLES: readonly { acceptedUntil: string; fees: Record<ProcedureKind, number | null> }[] = [
  { acceptedUntil: "2027-03-31", fees: { new: 11_000, pre_change: 5_500, post_change: 5_500, change_approval: 5_500, other_change: null } },
]

/** 受任日の報酬表の額。表が無い（期間の外）か、事案ごとの区分なら null */
export function feeFor(kind: ProcedureKind, acceptedOn: string): number | null {
  const table = FEE_TABLES.find((t) => acceptedOn <= t.acceptedUntil)
  return table?.fees[kind] ?? null
}

/** 手続の状況（日付と印から決める。手では入れない） */
export const PROCEDURE_STATUSES = ["received", "preparing", "on_hold", "applied", "correcting", "approved", "notified", "invoiced", "closed"] as const
export type ProcedureStatus = (typeof PROCEDURE_STATUSES)[number]

export const PROCEDURE_STATUS_LABELS: Record<ProcedureStatus, string> = {
  received: "受付",
  preparing: "受任・準備中",
  on_hold: "保留",
  applied: "申請中",
  correcting: "補正中",
  approved: "認定済",
  notified: "完了通知済",
  invoiced: "請求済",
  closed: "終了",
}

export type StatusInput = {
  receivedOn: string
  poaReceivedOn: string | null
  appliedOn: string | null
  approvedOn: string | null
  completedOn: string | null
  invoicedOn: string | null
  paidOn: string | null
  onHold: boolean
  closeReason: CloseReason | null
  /** 申請後の補正で、まだ済んでいないものがあるか */
  openCorrection: boolean
}

/**
 * 状況。終わったもの（入金済み・取下げ・中止）→ 保留 → 補正中 → 進んだ日付の遅い順に見る。
 * 保留は申請の前でも後でも止まっていることを先に見せる
 */
export function procedureStatus(p: StatusInput): ProcedureStatus {
  if (p.paidOn || p.closeReason) return "closed"
  if (p.onHold) return "on_hold"
  if (p.appliedOn && !p.approvedOn && p.openCorrection) return "correcting"
  if (p.invoicedOn) return "invoiced"
  if (p.completedOn) return "notified"
  if (p.approvedOn) return "approved"
  if (p.appliedOn) return "applied"
  if (acceptedOnOf(p)) return "preparing"
  return "received"
}

/** 共通ID の形（CP＋数字）。違っても保存は止めず、注意だけ出す（桁数は SHARP に確かめるまで決め打ちしない） */
export const looksLikeCommonId = (v: string) => /^CP\d+$/.test(v)

/** YYYY-MM-DD → 2026/11/10（画面の表示） */
export function formatDate(iso: string | null | undefined) {
  if (!iso) return ""
  const [y, m, d] = iso.split("-")
  return `${y}/${Number(m)}/${Number(d)}`
}

export const formatYen = (n: number | null | undefined) => (n == null ? "" : `${n.toLocaleString("ja-JP")}円`)

/** 手続と、済んでいない不備・補正から状況を決める */
export function statusOf(p: Omit<StatusInput, "openCorrection">, openDefects: readonly { kind: string }[]): ProcedureStatus {
  return procedureStatus({ ...p, openCorrection: openDefects.some((d) => d.kind === "after") })
}
