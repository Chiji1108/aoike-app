import { PROCEDURE_STATUS_LABELS, acceptedOnOf, bookNumber, procedureStatus } from "./procedure"
import { CLOSE_REASON_LABELS, PROCEDURE_KIND_LABELS, type CloseReason, type ProcedureKind, type SpecialPayer } from "./types"

/**
 * 請求の月次明細と、事件簿（帳簿）の年ごとの一覧
 */

export type LedgerSource = {
  id: string
  caseId: string
  bookYear: number
  seq: number
  kind: ProcedureKind
  receivedOn: string
  poaReceivedOn: string | null
  appliedOn: string | null
  approvedOn: string | null
  completedOn: string | null
  invoicedOn: string | null
  invoiceNumber: string
  paidOn: string | null
  onHold: boolean
  closeReason: CloseReason | null
  fee: number | null
  special: boolean
  specialAmount: number | null
  specialPayer: SpecialPayer | null
  case: { name: string; address: string }
  openDefects: readonly { kind: string }[]
}

// ---- 請求 ----

export type BillingRow = {
  id: string
  caseId: string
  number: string
  name: string
  kind: string
  completedOn: string
  fee: number | null
  /** SHARP が負担する特殊対応の額（SHARP に請求する） */
  special: number
  /** SHARP が負担する特殊対応なのに額が空 */
  specialMissing: boolean
  invoicedOn: string | null
  invoiceNumber: string
}

/**
 * month（YYYY-MM）の請求：完了通知日がその月の手続（月末締め。2026-11-09 決定）。請求先はいつも SHARP（報酬は SESJ の立替）。
 * 取下げ・中止したものは入れない
 */
export function billingRows(rows: readonly LedgerSource[], month: string): BillingRow[] {
  return rows
    .filter((r) => r.completedOn?.startsWith(`${month}-`) && !r.closeReason)
    .map((r) => ({
      id: r.id,
      caseId: r.caseId,
      number: bookNumber(r.bookYear, r.seq),
      name: r.case.name,
      kind: PROCEDURE_KIND_LABELS[r.kind],
      completedOn: r.completedOn!,
      fee: r.fee,
      special: r.special && r.specialPayer === "sharp" ? (r.specialAmount ?? 0) : 0,
      specialMissing: r.special && r.specialPayer === "sharp" && r.specialAmount == null,
      invoicedOn: r.invoicedOn,
      invoiceNumber: r.invoiceNumber,
    }))
    .sort((a, b) => a.completedOn.localeCompare(b.completedOn) || a.number.localeCompare(b.number))
}

export const billingTotal = (rows: readonly BillingRow[]) => rows.reduce((a, r) => a + (r.fee ?? 0) + r.special, 0)

/** 完了通知日のある月（新しい順）。請求の月を選ぶ */
export function billingMonths(rows: readonly LedgerSource[]): string[] {
  return [...new Set(rows.flatMap((r) => (r.completedOn ? [r.completedOn.slice(0, 7)] : [])))].sort().reverse()
}

// ---- 事件簿 ----

export type BookRow = {
  id: string
  caseId: string
  number: string
  receivedOn: string
  acceptedOn: string | null
  /** 事件の名称（帳簿の記載事項） */
  title: string
  name: string
  address: string
  fee: number | null
  /** 結果（入金まで済んだものは完了、途中で終わったものは取下げ・中止、ほかは今の状況） */
  result: string
}

/** 事件の名称：再エネ事業計画（太陽光10kW未満）＋申請区分 */
export const caseTitle = (kind: ProcedureKind) => `再エネ事業計画（太陽光10kW未満）${PROCEDURE_KIND_LABELS[kind]}`

/** year の事件簿（行政書士法第9条の帳簿。番号の順）。事件の名称・年月日・報酬額・依頼者の住所氏名を持つ */
export function bookRows(rows: readonly LedgerSource[], year: number): BookRow[] {
  return rows
    .filter((r) => r.bookYear === year)
    .sort((a, b) => a.seq - b.seq)
    .map((r) => ({
      id: r.id,
      caseId: r.caseId,
      number: bookNumber(r.bookYear, r.seq),
      receivedOn: r.receivedOn,
      acceptedOn: acceptedOnOf(r),
      title: caseTitle(r.kind),
      name: r.case.name,
      address: r.case.address,
      fee: r.fee,
      result: r.closeReason
        ? CLOSE_REASON_LABELS[r.closeReason]
        : r.paidOn
          ? "完了"
          : PROCEDURE_STATUS_LABELS[procedureStatus({ ...r, openCorrection: r.openDefects.some((d) => d.kind === "after") })],
    }))
}

/** 事件簿のある年（新しい順。今年はいつも入れる） */
export function bookYears(rows: readonly LedgerSource[], thisYear: number): number[] {
  return [...new Set([thisYear, ...rows.map((r) => r.bookYear)])].sort((a, b) => b - a)
}
