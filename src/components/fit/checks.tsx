import { useState } from "react"
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Checkbox } from "@/components/ui/checkbox"
import type { FitProcedure } from "@/db/fit-schema"
import { errorMessage } from "@/lib/errors"
import { MANUAL_CHECKS, MANUAL_CHECK_LABELS, autoChecks, type CheckSource, type ManualCheck } from "@/lib/fit/checks"
import { todayIso } from "@/lib/period"
import { cn } from "@/lib/utils"
import { updateProcedureFn } from "@/server/fit-fns"

/** 整合性チェック：アプリのデータで分かるもの（自動）と、書類を見比べて職員が印を付けるもの */
export function Checks({ procedure, source, onChanged }: { procedure: FitProcedure; source: CheckSource; onChanged: () => void }) {
  const [checks, setChecks] = useState(procedure.checks)
  const auto = autoChecks(source, todayIso())

  async function toggle(id: ManualCheck, value: boolean) {
    const next = { ...checks, [id]: value }
    setChecks(next)
    try {
      await updateProcedureFn({ data: { id: procedure.id, patch: { checks: next } } })
      onChanged()
    } catch (e) {
      setChecks(checks)
      toast.error(errorMessage(e))
    }
  }

  const done = MANUAL_CHECKS.filter((c) => checks[c]).length
  return (
    <div className="grid gap-2" data-testid="fit-checks">
      <h4 className="text-sm font-semibold">
        整合性チェック
        <span className="ml-2 text-xs font-normal text-muted-foreground num">
          見比べ {done}/{MANUAL_CHECKS.length}
        </span>
      </h4>
      <ul className="grid gap-1 text-sm">
        {auto.map((a) => (
          <li key={a.id} className="flex items-start gap-2" data-testid="check-auto" data-id={a.id} data-state={a.state}>
            {a.state === "ok" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            ) : a.state === "ng" ? (
              <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
            ) : (
              <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <span>
              <span className="font-medium">{a.label}</span>
              <span className={cn("ml-2 text-xs", a.state === "ng" ? "text-red-700 dark:text-red-400" : "text-muted-foreground")}>{a.detail}</span>
            </span>
          </li>
        ))}
        {MANUAL_CHECKS.map((c) => (
          <li key={c} className="flex items-start gap-2">
            <Checkbox id={`${procedure.id}-${c}`} className="mt-0.5" checked={!!checks[c]} onCheckedChange={(v) => void toggle(c, v === true)} data-testid={`check-${c}`} />
            <label htmlFor={`${procedure.id}-${c}`} className="cursor-pointer">
              <span className="font-medium">{MANUAL_CHECK_LABELS[c].label}</span>
              <span className="block text-xs text-muted-foreground">{MANUAL_CHECK_LABELS[c].hint}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
