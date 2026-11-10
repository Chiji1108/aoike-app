import { AlertTriangle, Info, OctagonAlert } from "lucide-react"
import type { Alert } from "@/lib/fit/alerts"
import { cn } from "@/lib/utils"

/** 期限と注意の1行（期限切れは赤、近いものは黄、知らせるだけのものは灰） */
export function AlertText({ alert, className }: { alert: Alert; className?: string }) {
  const Icon = alert.level === "danger" ? OctagonAlert : alert.level === "warn" ? AlertTriangle : Info
  return (
    <span
      className={cn(
        "flex items-start gap-1 text-xs",
        alert.level === "danger" ? "text-red-700 dark:text-red-400" : alert.level === "warn" ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground",
        className,
      )}
      data-testid="fit-alert"
      data-level={alert.level}
      data-kind={alert.kind}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <span>{alert.text}</span>
    </span>
  )
}
