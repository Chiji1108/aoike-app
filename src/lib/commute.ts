import type { CommuteType } from "@/db/kintai-schema"

export const COMMUTE_TYPE_LABELS: Record<CommuteType, string> = {
  none: "なし",
  pass: "定期",
  per_trip: "都度",
}

export type CommuteSetting = {
  commuteType: CommuteType
  commuteRoute: string
  commuteOneWayFare: number
  commutePassMonthly: number
}

/** 都度の人の1日あたりの初期値（往復） */
export function defaultDailyFare(s: CommuteSetting) {
  return s.commuteType === "per_trip" ? s.commuteOneWayFare * 2 : 0
}

/** 期間の通勤費（定期は月額、都度は日ごとの合計） */
export function periodCommuteTotal(s: CommuteSetting, records: { commuteFare: number }[]) {
  if (s.commuteType === "pass") return s.commutePassMonthly
  if (s.commuteType === "per_trip") return records.reduce((sum, r) => sum + r.commuteFare, 0)
  return 0
}

/** 12340 → "12,340円" */
export function formatYen(amount: number) {
  return `${amount.toLocaleString("ja-JP")}円`
}

/** 従業員一覧などに出す短い説明。"定期・月額12,340円" */
export function describeCommute(s: CommuteSetting) {
  if (s.commuteType === "pass") return `定期・月額${formatYen(s.commutePassMonthly)}`
  if (s.commuteType === "per_trip") return `都度・片道${formatYen(s.commuteOneWayFare)}`
  return null
}
