import { PROCEDURE_STATUS_LABELS, type ProcedureStatus } from "@/lib/fit/procedure"
import { cn } from "@/lib/utils"

/** 状況ごとの色（止まっている・急ぐものは目立たせ、終わったものは薄く） */
const TONE: Record<ProcedureStatus, string> = {
  received: "bg-muted text-foreground",
  preparing: "bg-brand-soft text-brand",
  on_hold: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  applied: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  correcting: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  approved: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  notified: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  invoiced: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  closed: "bg-transparent text-muted-foreground ring-1 ring-border",
}

export function StatusBadge({ status, className }: { status: ProcedureStatus; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONE[status], className)} data-testid="fit-status">
      {PROCEDURE_STATUS_LABELS[status]}
    </span>
  )
}
