import { addDays, addMonths, daysBetween } from "../period"
import { acceptedOnOf, bookNumber, formatDate } from "./procedure"
import { fiscalYearOf, type FitSettings } from "./settings"
import { APPROVAL_KINDS, NOTICE_KINDS, type CloseReason, type DefectKind, type ProcedureKind, type SiteAddressKind } from "./types"

/**
 * 期限と注意（要件メモ6章）。手続ごとに、いま見ておくべきことを出す。日付は YYYY-MM-DD、今日は日本時間
 */

export const ALERT_KINDS = ["correction", "seal", "deadline", "notice", "noticeUnsaved", "stalled"] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  correction: "補正期限",
  seal: "印鑑証明",
  deadline: "年度の締切",
  notice: "告知の回答",
  noticeUnsaved: "認定通知書",
  stalled: "動いていない",
}

/** danger：期限切れなど今すぐ。warn：期限が近い。info：知らせるだけ */
export type AlertLevel = "danger" | "warn" | "info"

export type Alert = {
  procedureId: string
  caseId: string
  number: string
  name: string
  kind: AlertKind
  level: AlertLevel
  /** 期限（並べる順。無ければ後ろ） */
  dueOn: string | null
  text: string
}

export type AlertSource = {
  id: string
  caseId: string
  bookYear: number
  seq: number
  kind: ProcedureKind
  receivedOn: string
  poaReceivedOn: string | null
  noticeOn: string | null
  answeredOn: string | null
  sealCertIssuedOn: string | null
  onHold: boolean
  appliedOn: string | null
  approvedOn: string | null
  noticeSaved: boolean
  paidOn: string | null
  closeReason: CloseReason | null
  case: { name: string; siteAddressKind?: SiteAddressKind | null }
  openDefects: readonly { kind: DefectKind; content: string; dueOn: string | null }[]
}

/** 印鑑証明は、申請する日に発行から3か月以内（研修資料）。この日まで使える */
export const sealExpiryOf = (issuedOn: string) => addMonths(issuedOn, 3)

/** 告知から7日たてば了承とみなす（申込書の報酬表） */
export const noticeDeemedOn = (noticeOn: string) => addDays(noticeOn, 7)

/** 期限までの日数から、出し方を決める（過ぎたら danger、warnDays 以内なら warn） */
const levelOf = (today: string, dueOn: string, warnDays: number): AlertLevel | null => {
  const left = daysBetween(today, dueOn)
  if (left < 0) return "danger"
  return left <= warnDays ? "warn" : null
}

const leftText = (today: string, dueOn: string) => {
  const left = daysBetween(today, dueOn)
  if (left < 0) return `${-left}日過ぎた`
  return left === 0 ? "今日まで" : `あと${left}日`
}

export function alertsOf(p: AlertSource, settings: FitSettings, today: string): Alert[] {
  if (p.paidOn || p.closeReason) return []
  const base = { procedureId: p.id, caseId: p.caseId, number: bookNumber(p.bookYear, p.seq), name: p.case.name }
  const out: Alert[] = []
  const push = (kind: AlertKind, level: AlertLevel, dueOn: string | null, text: string) => out.push({ ...base, kind, level, dueOn, text })

  // 補正：期限を過ぎると自動で取下げになる（研修資料）
  for (const d of p.openDefects) {
    if (d.kind !== "after" || !d.dueOn) continue
    const level = levelOf(today, d.dueOn, settings.correctionWarnDays)
    if (level) push("correction", level, d.dueOn, `補正「${d.content}」の期限 ${formatDate(d.dueOn)}（${leftText(today, d.dueOn)}）`)
  }

  if (!p.appliedOn) {
    // 印鑑証明：1日でも過ぎれば不備
    if (p.sealCertIssuedOn) {
      const expiry = sealExpiryOf(p.sealCertIssuedOn)
      const level = levelOf(today, expiry, settings.sealWarnDays)
      if (level) push("seal", level, expiry, `印鑑証明は ${formatDate(expiry)} まで（${leftText(today, expiry)}）。${level === "danger" ? "取り直しが要る" : "それまでに申請する"}`)
    }

    // 年度の受付締切：新規・変更認定だけ（届出は1年中受付）
    if (APPROVAL_KINDS.has(p.kind)) {
      const deadline = settings.fiscalDeadlines.find((f) => f.fiscalYear === fiscalYearOf(today))?.deadline
      if (deadline) {
        const left = daysBetween(today, deadline)
        if (left < 0) push("deadline", "danger", deadline, `今年度の受付締切 ${formatDate(deadline)} を過ぎた（次の年度の受付を待つ）`)
        else if (left <= settings.deadlineWarnDays) push("deadline", "warn", deadline, `今年度の受付締切 ${formatDate(deadline)}（${leftText(today, deadline)}）`)
      }
    }

    // 告知の回答：返事が無くても7日たてば了承とみなせる
    if (NOTICE_KINDS.has(p.kind) && p.noticeOn && !p.answeredOn) {
      const deemed = noticeDeemedOn(p.noticeOn)
      if (today >= deemed) push("notice", "info", deemed, `告知から7日たった（${formatDate(deemed)}）。了承とみなして進められる`)
      else push("notice", "info", deemed, `告知の回答待ち。${formatDate(deemed)} で了承とみなせる`)
    }

    // 受任したのに申請していない
    const accepted = acceptedOnOf(p)
    if (accepted && !p.onHold && daysBetween(accepted, today) >= settings.stalledAcceptedDays) {
      push("stalled", "info", null, `受任から${daysBetween(accepted, today)}日たっても申請していない`)
    }
  } else if (!p.approvedOn && daysBetween(p.appliedOn, today) >= settings.stalledAppliedDays) {
    push("stalled", "info", null, `申請から${daysBetween(p.appliedOn, today)}日たっても${p.kind === "new" ? "認定" : "完了"}していない`)
  }

  // 認定通知書は1回しかダウンロードできない
  if (p.approvedOn && APPROVAL_KINDS.has(p.kind) && !p.noticeSaved) push("noticeUnsaved", "warn", null, "認定通知書をまだ保存していない（ダウンロードは1回だけ）")

  return out
}

const LEVEL_ORDER: Record<AlertLevel, number> = { danger: 0, warn: 1, info: 2 }

/** 急ぐ順（danger → warn → info、同じなら期限の近い順、期限の無いものは後ろ） */
export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.number.localeCompare(b.number))
}

/**
 * 住所確定待ち：地番で申請した新規認定が認定されたのに、同じ案件に事前変更届がまだ無い（住居表示が決まったら事前変更届の候補）
 */
export function addressPending<T extends AlertSource>(rows: readonly T[]): T[] {
  const hasPreChange = new Set(rows.filter((r) => r.kind === "pre_change").map((r) => r.caseId))
  return rows.filter((r) => r.kind === "new" && r.approvedOn && !r.closeReason && r.case.siteAddressKind === "lot" && !hasPreChange.has(r.caseId))
}
