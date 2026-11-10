import { formatYen as yen } from "../commute"
import { reiwaOf } from "../period"
import type { CloseReason } from "./types"

/** 事件簿の年（受付日の年。今の事件簿と同じく暦年で区切る） */
export const bookYearOf = (receivedOn: string) => Number(receivedOn.slice(0, 4))

/**
 * 事件簿の番号。「F8-0001」＝ F（FIT）＋和暦の年の数字（令和）−その年の通し番号4桁。
 * 今の事件簿の「30-097」と見分けがつき、SHARP の案件表の「貴社管理番号」にもこのまま出す
 */
export function bookNumber(bookYear: number, seq: number) {
  return `F${reiwaOf(bookYear)}-${String(seq).padStart(4, "0")}`
}

/** 受任日＝申込書と委任状がそろった日（遅いほう）。片方でも無ければまだ受任していない */
export function acceptedOnOf(p: { receivedOn: string; poaReceivedOn: string | null }): string | null {
  if (!p.poaReceivedOn) return null
  return p.poaReceivedOn > p.receivedOn ? p.poaReceivedOn : p.receivedOn
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

/** 報酬額の表示（まだ無ければ空） */
export const formatYen = (n: number | null | undefined) => (n == null ? "" : yen(n))

/** 手続と、済んでいない不備・補正から状況を決める */
export function statusOf(p: Omit<StatusInput, "openCorrection">, openDefects: readonly { kind: string }[]): ProcedureStatus {
  return procedureStatus({ ...p, openCorrection: openDefects.some((d) => d.kind === "after") })
}

/** 状況ごとの件数 */
export function countByStatus(statuses: Iterable<ProcedureStatus>): Map<ProcedureStatus, number> {
  const m = new Map<ProcedureStatus, number>()
  for (const s of statuses) m.set(s, (m.get(s) ?? 0) + 1)
  return m
}
