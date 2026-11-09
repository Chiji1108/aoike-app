import { ChevronRight, Plus } from "lucide-react"
import { formatMonthDay, parseDate, todayIso, weekdayIndex, weekdayLabel } from "@/lib/period"
import { formatYen } from "@/lib/commute"
import { calcWorkMinutes, formatDuration, formatTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { AttendanceRow } from "@/server/attendance"

// タブレット幅では備考列を省き（備考は時刻の下に表示）、PC幅で備考列を追加する
const GRID =
  "sm:grid-cols-[8rem_minmax(7rem,1fr)_3.5rem_5.25rem_5.25rem_1rem] md:grid-cols-[8.5rem_minmax(8rem,1fr)_3.5rem_5.5rem_5.5rem_minmax(0,1.2fr)_1.5rem]"

function dayTone(iso: string) {
  const w = weekdayIndex(iso)
  if (w === 0) return "text-red-600"
  if (w === 6) return "text-blue-600"
  return ""
}

/** 対象期間の全日付を並べた一覧。行をタップするとその日の入力・編集が開く */
export function DayList({
  dates,
  recordsByDate,
  onSelect,
  usualFare,
}: {
  dates: string[]
  recordsByDate: Map<string, AttendanceRow>
  onSelect: (date: string, record?: AttendanceRow) => void
  /** 都度の人の通常の通勤費。これと違う日だけ金額を表示する */
  usualFare?: number
}) {
  const today = todayIso()

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className={`hidden ${GRID} gap-3 border-b bg-muted/40 px-5 py-2.5 text-xs font-medium text-muted-foreground sm:grid`}>
        <span>日付</span>
        <span>出勤 〜 退勤</span>
        <span className="text-right">休憩</span>
        <span className="text-right">実働</span>
        <span className="text-right">残業</span>
        <span className="hidden md:block">備考</span>
        <span />
      </div>
      <ul className="divide-y">
        {dates.map((date) => {
          const r = recordsByDate.get(date)
          const isToday = date === today
          const w = weekdayIndex(date)
          const weekend = w === 0 || w === 6
          const showMonthDivider = parseDate(date).getUTCDate() === 1
          const fareNote =
            r && usualFare !== undefined && r.commuteFare !== usualFare
              ? `通勤費${r.commuteFare === 0 ? "なし" : formatYen(r.commuteFare)}`
              : null
          return (
            <li key={date} className={cn(showMonthDivider && "border-t-2 border-t-border")}>
              <button
                type="button"
                onClick={() => onSelect(date, r)}
                className={cn(
                  "group relative w-full text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:outline-none",
                  weekend && !r && "bg-muted/25",
                  isToday && "bg-brand-soft/60 hover:bg-brand-soft",
                )}
              >
                {isToday && <span className="absolute inset-y-0 left-0 w-[3px] bg-brand" />}

                {/* スマートフォン */}
                <div className="flex items-center gap-3 px-4 py-3 sm:hidden">
                  <div className={cn("w-12 shrink-0 text-center leading-tight", dayTone(date))}>
                    <div className="text-[15px] font-semibold num">{formatMonthDay(date)}</div>
                    <div className="text-xs">{weekdayLabel(date)}</div>
                  </div>
                  {r ? (
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-medium num">
                        {formatTime(r.startTime)} 〜 {formatTime(r.endTime)}
                      </div>
                      <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground num">
                        <span className="whitespace-nowrap">休憩{r.breakMinutes}分</span>
                        {r.overtimeMinutes > 0 && (
                          <span className="whitespace-nowrap text-amber-700">残業{formatDuration(r.overtimeMinutes)}</span>
                        )}
                        {fareNote && <span className="whitespace-nowrap">{fareNote}</span>}
                      </div>
                      {r.note && <div className="truncate text-xs text-muted-foreground">{r.note}</div>}
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center gap-1.5 text-sm text-muted-foreground/80">
                      <Plus className="size-3.5" />
                      {isToday ? "今日の勤怠を入力" : "未入力"}
                    </div>
                  )}
                  {r && (
                    <div className="text-right leading-tight">
                      <div className="text-sm font-semibold whitespace-nowrap num">{formatDuration(calcWorkMinutes(r))}</div>
                      <div className="text-[10px] text-muted-foreground">実働</div>
                    </div>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
                </div>

                {/* PC・タブレット */}
                <div className={`hidden min-h-12 ${GRID} items-center gap-3 px-5 py-2.5 text-sm sm:grid`}>
                  <span className={cn("flex items-baseline gap-1.5 whitespace-nowrap num", dayTone(date))}>
                    <span className="font-medium">{formatMonthDay(date)}</span>
                    <span className="text-xs">（{weekdayLabel(date)}）</span>
                    {isToday && (
                      <span className="ml-1 shrink-0 self-center rounded bg-brand px-1.5 py-px text-[10px] leading-4 font-medium whitespace-nowrap text-white">今日</span>
                    )}
                  </span>
                  {r ? (
                    <>
                      <span className="min-w-0">
                        <span className="block font-medium whitespace-nowrap num">
                          {formatTime(r.startTime)}
                          <span className="mx-1.5 text-muted-foreground">〜</span>
                          {formatTime(r.endTime)}
                        </span>
                        {r.note && (
                          <span className="block truncate text-xs text-muted-foreground md:hidden">{r.note}</span>
                        )}
                        {fareNote && <span className="block truncate text-xs text-muted-foreground num">{fareNote}</span>}
                      </span>
                      <span className="text-right whitespace-nowrap text-muted-foreground num">{r.breakMinutes}分</span>
                      <span className="text-right font-semibold whitespace-nowrap num">{formatDuration(calcWorkMinutes(r))}</span>
                      <span className={cn("text-right whitespace-nowrap num", r.overtimeMinutes > 0 ? "font-medium text-amber-700" : "text-muted-foreground/60")}>
                        {r.overtimeMinutes > 0 ? formatDuration(r.overtimeMinutes) : "—"}
                      </span>
                      <span className="hidden truncate text-muted-foreground md:block">{r.note}</span>
                    </>
                  ) : (
                    <span className="col-span-4 flex whitespace-nowrap md:col-span-5 items-center gap-1.5 text-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <Plus className="size-3.5" />
                      クリックして入力
                    </span>
                  )}
                  <ChevronRight className="size-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
