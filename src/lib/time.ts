export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function timeToMinutes(time: string) {
  const [h, m] = time.split(":").map(Number)
  return h! * 60 + m!
}

/** 実働時間（分）= 退勤 − 出勤 − 休憩 */
export function calcWorkMinutes(r: { startTime: string; endTime: string; breakMinutes: number }) {
  return Math.max(0, timeToMinutes(r.endTime) - timeToMinutes(r.startTime) - r.breakMinutes)
}

/** 125 → "2時間5分" / 60 → "1時間" / 30 → "30分" / 0 → "0分" */
export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h && m) return `${h}時間${m}分`
  if (h) return `${h}時間`
  return `${m}分`
}

/** "09:00" → "9:00" */
export function formatTime(time: string) {
  return time.replace(/^0(\d)/, "$1")
}

export function summarize(
  records: { startTime: string; endTime: string; breakMinutes: number; overtimeMinutes: number }[],
) {
  return records.reduce(
    (acc, r) => ({
      days: acc.days + 1,
      workMinutes: acc.workMinutes + calcWorkMinutes(r),
      overtimeMinutes: acc.overtimeMinutes + r.overtimeMinutes,
    }),
    { days: 0, workMinutes: 0, overtimeMinutes: 0 },
  )
}
