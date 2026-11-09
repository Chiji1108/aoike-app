import { formatYen, periodCommuteTotal, type CommuteSetting } from "@/lib/commute"
import { OFFICE_NAME } from "@/lib/constants"
import {
  formatMonthDay,
  formatPeriodRangeLong,
  formatPeriodTitle,
  getPeriodDates,
  weekdayIndex,
  weekdayLabel,
  type PeriodKey,
} from "@/lib/period"
import { calcWorkMinutes, formatDuration, formatTime, summarize } from "@/lib/time"
import type { AttendanceRow } from "@/server/attendance"

const SERIF = '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif'
const CELL = "border border-[#c3c8cf]"

/**
 * A4縦の勤務報告書。
 * 画面・印刷とも mm 単位でレイアウトし、1ページ（210×297mm）に収める。
 */
export function ReportSheet({
  period,
  employeeName,
  commute,
  records,
}: {
  period: PeriodKey
  employeeName: string
  commute: CommuteSetting
  records: AttendanceRow[]
}) {
  const dates = getPeriodDates(period)
  const byDate = new Map(records.map((r) => [r.workDate, r]))
  const summary = summarize(records)
  const perTrip = commute.commuteType === "per_trip"
  const hasCommute = commute.commuteType !== "none"
  // 期間の日数（28〜31日）に応じて行の高さを調整（通勤費の行がある場合はその分詰める）
  const rowHeight = (dates.length >= 31 ? 6.1 : dates.length === 30 ? 6.3 : 6.6) - (hasCommute ? 0.3 : 0)
  const headers = ["日付", "曜日", "出勤時刻", "退勤時刻", "休憩", "実働時間", "残業時間", ...(perTrip ? ["通勤費"] : []), "備考"]

  return (
    <div
      className="print-sheet relative mx-auto box-border bg-white text-[#1a1d23] shadow-[0_1px_3px_rgba(0,0,0,0.08),0_12px_32px_-12px_rgba(0,0,0,0.18)]"
      style={{
        width: "210mm",
        height: "297mm",
        padding: "13mm 15mm 12mm",
        fontFamily: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif',
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
        overflow: "hidden",
      }}
    >
      {/* 提出日 */}
      <div className="flex justify-end text-[9pt]">
        <span>
          提出日
          <span className="ml-[3mm] inline-block w-[40mm] border-b border-[#555] text-right">
            年　　月　　日
          </span>
        </span>
      </div>

      {/* タイトル */}
      <h1
        className="mt-[3mm] text-center text-[19pt] font-semibold tracking-[0.6em]"
        style={{ fontFamily: SERIF, paddingLeft: "0.6em" }}
      >
        勤務報告書
      </h1>

      {/* 対象期間・所属 ／ 氏名・押印欄 */}
      <div className="mt-[6mm] flex items-end justify-between gap-[6mm]">
        <dl className="grid grid-cols-[17mm_1fr] gap-y-[3mm] pb-[1mm] text-[10pt] leading-none">
          <dt className="text-[#555]">対象期間</dt>
          <dd>
            <span className="font-semibold">{formatPeriodTitle(period)}</span>
            <span className="mt-[1.5mm] block text-[8.5pt] text-[#444]">（{formatPeriodRangeLong(period)}）</span>
          </dd>
          <dt className="text-[#555]">所　　属</dt>
          <dd>{OFFICE_NAME}</dd>
        </dl>

        {/* 「氏名＿＿＿ ㊞」形式。㊞の周囲（幅26mm × 高さ26mm）は押印用に何も置かない */}
        <div className="flex shrink-0 flex-col justify-end pb-[1mm]" style={{ height: "26mm", width: "84mm" }}>
          <div className="text-[8.5pt] text-[#555]">氏名</div>
          <div className="mt-[2mm] flex items-center border-b border-[#333]">
            <span className="min-w-0 flex-1 truncate pb-[1.2mm] text-[14pt] font-medium tracking-[0.08em]">
              {employeeName}
            </span>
            <span className="flex w-[26mm] shrink-0 items-center justify-center pb-[1.2mm]" aria-label="押印欄">
              <span
                className="flex items-center justify-center rounded-full border border-[#bdbdbd] text-[9pt] leading-none text-[#a8a8a8]"
                style={{ width: "10mm", height: "10mm", fontFamily: SERIF }}
              >
                印
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* 勤怠表 */}
      <table className="mt-[5mm] w-full border-collapse text-[8.8pt] leading-none" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "15mm" }} />
          <col style={{ width: "9mm" }} />
          <col style={{ width: "16mm" }} />
          <col style={{ width: "16mm" }} />
          <col style={{ width: "14mm" }} />
          <col style={{ width: "20mm" }} />
          <col style={{ width: "20mm" }} />
          {perTrip && <col style={{ width: "17mm" }} />}
          <col />
        </colgroup>
        <thead>
          <tr className="bg-[#f1f3f6]">
            {headers.map((h) => (
              <th key={h} className="border border-[#9aa1ab] text-[8.5pt] font-medium" style={{ height: "7mm" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map((date) => {
            const r = byDate.get(date)
            const w = weekdayIndex(date)
            const tone = w === 0 ? "#c62828" : w === 6 ? "#1d4ed8" : undefined
            return (
              <tr
                key={date}
                style={{ height: `${rowHeight}mm`, background: w === 0 || w === 6 ? "#f8f9fa" : undefined }}
              >
                <td className={`${CELL} text-center tabular-nums`}>{formatMonthDay(date)}</td>
                <td className={`${CELL} text-center`} style={{ color: tone }}>
                  {weekdayLabel(date)}
                </td>
                <td className={`${CELL} text-center tabular-nums`}>{r ? formatTime(r.startTime) : ""}</td>
                <td className={`${CELL} text-center tabular-nums`}>{r ? formatTime(r.endTime) : ""}</td>
                <td className={`${CELL} pr-[2mm] text-right tabular-nums`}>{r ? `${r.breakMinutes}分` : ""}</td>
                <td className={`${CELL} pr-[2mm] text-right font-medium tabular-nums`}>
                  {r ? formatDuration(calcWorkMinutes(r)) : ""}
                </td>
                <td className={`${CELL} pr-[2mm] text-right tabular-nums`}>
                  {r && r.overtimeMinutes > 0 ? formatDuration(r.overtimeMinutes) : ""}
                </td>
                {perTrip && (
                  <td className={`${CELL} pr-[2mm] text-right tabular-nums`}>
                    {r ? formatYen(r.commuteFare) : ""}
                  </td>
                )}
                <td className={`${CELL} truncate px-[1.5mm] text-[8pt]`}>{r?.note ?? ""}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* 合計 */}
      <table className="mt-[4mm] w-full border-collapse" style={{ tableLayout: "fixed" }}>
        <tbody>
          <tr>
            {[
              { label: "合計出勤日数", value: `${summary.days}日` },
              { label: "合計実働時間", value: formatDuration(summary.workMinutes) },
              { label: "合計残業時間", value: formatDuration(summary.overtimeMinutes) },
            ].map(({ label, value }) => (
              <td key={label} className="border border-[#9aa1ab] p-0">
                <div className="flex h-[11mm] items-stretch">
                  <div className="flex w-[25mm] items-center justify-center border-r border-[#c3c8cf] bg-[#f1f3f6] text-[8.5pt] text-[#333]">
                    {label}
                  </div>
                  <div className="flex flex-1 items-center justify-center text-[11.5pt] font-semibold whitespace-nowrap tabular-nums">
                    {value}
                  </div>
                </div>
              </td>
            ))}
          </tr>
          {hasCommute && (
            <tr>
              <td colSpan={3} className="border border-[#9aa1ab] p-0">
                <div className="flex h-[10mm] items-stretch">
                  <div className="flex w-[25mm] items-center justify-center border-r border-[#c3c8cf] bg-[#f1f3f6] text-[8.5pt] text-[#333]">
                    通勤費
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-[3mm] px-[3mm] text-[8.5pt] text-[#333]">
                    <span className="shrink-0 font-medium">
                      {commute.commuteType === "pass"
                        ? "定期（月額）"
                        : `都度（片道${formatYen(commute.commuteOneWayFare)}）`}
                    </span>
                    {commute.commuteRoute && <span className="truncate">経路：{commute.commuteRoute}</span>}
                  </div>
                  <div className="flex w-[40mm] shrink-0 items-center justify-end border-l border-[#c3c8cf] pr-[4mm] text-[11.5pt] font-semibold whitespace-nowrap tabular-nums">
                    {formatYen(periodCommuteTotal(commute, records))}
                  </div>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

    </div>
  )
}
