import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  currentPeriodKey,
  formatPeriodRangeShort,
  formatPeriodTitle,
  shiftPeriod,
  type PeriodKey,
} from "@/lib/period"

export function PeriodNav({ period, onChange }: { period: PeriodKey; onChange: (p: PeriodKey) => void }) {
  const current = currentPeriodKey()
  const isCurrent = period === current
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon-lg"
        className="size-10 shrink-0"
        onClick={() => onChange(shiftPeriod(period, -1))}
        aria-label="前の月"
      >
        <ChevronLeft />
      </Button>
      <div className="min-w-0 flex-1 text-center lg:min-w-52 lg:flex-none">
        <div className="text-lg font-semibold tracking-tight num">{formatPeriodTitle(period)}</div>
        <div className="text-xs text-muted-foreground num">
          {formatPeriodRangeShort(period)}
          {isCurrent && <span className="ml-1.5 rounded bg-brand-soft px-1.5 py-0.5 font-medium text-brand">今月分</span>}
        </div>
      </div>
      <Button
        variant="outline"
        size="icon-lg"
        className="size-10 shrink-0"
        onClick={() => onChange(shiftPeriod(period, 1))}
        aria-label="次の月"
      >
        <ChevronRight />
      </Button>
      {!isCurrent && (
        <Button variant="ghost" className="h-10 shrink-0" onClick={() => onChange(current)}>
          今月分へ
        </Button>
      )}
    </div>
  )
}
