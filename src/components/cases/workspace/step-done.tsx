import { ArrowRight, CircleCheck } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useCaseActions, useCaseView } from "@/components/cases/store/context"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { nextStep, stepDone, VIEW_LABELS, type StepId } from "@/lib/cases/steps"

/**
 * 段の中身の終わりの「済みました。次は ◯◯ →」（段が済んだときだけ。ダウンロードは済みにしない）。
 * 段が済んでも勝手には次の段へ移らない。押したときだけ次の段（lib/cases/steps.ts の nextStep）を開き、その段の中身にフォーカスを移す
 */
export function StepDone({ step, className }: { step: Exclude<StepId, "export">; className?: string }) {
  const actions = useCaseActions()
  const { done, next } = useCaseView(useShallow((v) => ({ done: stepDone(v.todo, step), next: nextStep(v.todo, step) })))
  if (!done) return null
  return (
    <div
      className={cn(
        "flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
        className,
      )}
      data-testid="step-done"
      data-step={step}
      data-next={next}
    >
      <span className="flex items-center gap-2">
        <CircleCheck className="size-4 text-emerald-600" />
        {VIEW_LABELS[step]}は済みました。
      </span>
      <Button size="sm" variant="outline" className="bg-background" onClick={() => actions.goNextStep(step)} data-testid="step-next">
        次は{VIEW_LABELS[next]} <ArrowRight />
      </Button>
    </div>
  )
}
