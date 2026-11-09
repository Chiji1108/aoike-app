import { CalendarCheck2, Clock, TrainFront, Timer } from "lucide-react"
import { formatDuration } from "@/lib/time"
import { cn } from "@/lib/utils"

export function SummaryCards({
  summary,
  commute,
}: {
  summary: { days: number; workMinutes: number; overtimeMinutes: number }
  /** 通勤費がある従業員のみ。label は「通勤費（定期）」など */
  commute?: { label: string; amount: number }
}) {
  const items = [
    { label: "出勤日数", value: `${summary.days}`, unit: "日", icon: CalendarCheck2 },
    { label: "実働時間", value: formatDuration(summary.workMinutes), icon: Clock },
    { label: "残業時間", value: formatDuration(summary.overtimeMinutes), icon: Timer },
    ...(commute
      ? [{ label: commute.label, value: commute.amount.toLocaleString("ja-JP"), unit: "円", icon: TrainFront }]
      : []),
  ]
  return (
    <div className={cn("grid gap-2 sm:gap-4", commute ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
      {items.map(({ label, value, unit, icon: Icon }) => (
        <div key={label} className="rounded-2xl border bg-card px-3 py-3 sm:px-5 sm:py-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
            <Icon className="hidden size-4 sm:block" />
            {label}
          </div>
          <div className="mt-1 text-[15px] leading-snug font-semibold tracking-tight num sm:text-2xl">
            {value}
            {unit && <span className="ml-0.5 text-sm font-medium text-muted-foreground">{unit}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
