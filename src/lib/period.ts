// 20日締め（例：2026年10月分 = 2026/9/21〜2026/10/20）

export const CLOSING_DAY = 20

/** 期間キー（"YYYY-MM" = その月の20日で締まる期間） */
export type PeriodKey = string

export const PERIOD_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const

const pad = (n: number) => String(n).padStart(2, "0")

/** YYYY-MM-DD を（タイムゾーンの影響を受けない）UTC の Date に */
export function parseDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!))
}

export function formatIsoDate(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function addDays(iso: string, days: number) {
  const d = parseDate(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return formatIsoDate(d)
}

/** months か月後の同じ日（その月に無ければ月末。11/30 の3か月後は 2/28） */
export function addMonths(iso: string, months: number) {
  const [y, m, d] = iso.split("-").map(Number)
  const last = new Date(Date.UTC(y!, m! - 1 + months + 1, 0)).getUTCDate()
  return formatIsoDate(new Date(Date.UTC(y!, m! - 1 + months, Math.min(d!, last))))
}

/** from から to までの日数（to が前なら負） */
export function daysBetween(from: string, to: string) {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000)
}

/** 日本時間の今日（YYYY-MM-DD）。now を渡すと、その時刻の日本時間の日付 */
export function todayIso(now = new Date()) {
  return formatIsoDate(new Date(now.getTime() + 9 * 60 * 60 * 1000))
}

export function periodKeyOf(year: number, month: number): PeriodKey {
  return `${year}-${pad(month)}`
}

export function parsePeriodKey(key: PeriodKey) {
  const [year, month] = key.split("-").map(Number)
  return { year: year!, month: month! }
}

/** 日付が属する期間（21日以降は翌月分） */
export function periodKeyForDate(iso: string): PeriodKey {
  const d = parseDate(iso)
  let year = d.getUTCFullYear()
  let month = d.getUTCMonth() + 1
  if (d.getUTCDate() > CLOSING_DAY) {
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return periodKeyOf(year, month)
}

export function currentPeriodKey() {
  return periodKeyForDate(todayIso())
}

export function shiftPeriod(key: PeriodKey, delta: number): PeriodKey {
  const { year, month } = parsePeriodKey(key)
  const idx = year * 12 + (month - 1) + delta
  return periodKeyOf(Math.floor(idx / 12), (idx % 12) + 1)
}

export function getPeriodRange(key: PeriodKey) {
  const { year, month } = parsePeriodKey(key)
  const end = formatIsoDate(new Date(Date.UTC(year, month - 1, CLOSING_DAY)))
  const start = formatIsoDate(new Date(Date.UTC(year, month - 2, CLOSING_DAY + 1)))
  return { start, end }
}

/** 期間内の全日付 */
export function getPeriodDates(key: PeriodKey) {
  const { start, end } = getPeriodRange(key)
  const dates: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d)
  return dates
}

export function isDateInPeriod(iso: string, key: PeriodKey) {
  const { start, end } = getPeriodRange(key)
  return iso >= start && iso <= end
}

export function weekdayIndex(iso: string) {
  return parseDate(iso).getUTCDay()
}

export function weekdayLabel(iso: string) {
  return WEEKDAYS[weekdayIndex(iso)]!
}

/** "2026年10月分" */
export function formatPeriodTitle(key: PeriodKey) {
  const { year, month } = parsePeriodKey(key)
  return `${year}年${month}月分`
}

/** "9/21〜10/20" */
export function formatPeriodRangeShort(key: PeriodKey) {
  const { start, end } = getPeriodRange(key)
  return `${formatMonthDay(start)}〜${formatMonthDay(end)}`
}

/** "2026年9月21日〜2026年10月20日" */
export function formatPeriodRangeLong(key: PeriodKey) {
  const { start, end } = getPeriodRange(key)
  return `${formatDateLong(start)}〜${formatDateLong(end)}`
}

export function formatMonthDay(iso: string) {
  const d = parseDate(iso)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

export function formatDateLong(iso: string) {
  const d = parseDate(iso)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}

/** "10月14日（火）" */
export function formatDateWithWeekday(iso: string) {
  const d = parseDate(iso)
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${weekdayLabel(iso)}）`
}
