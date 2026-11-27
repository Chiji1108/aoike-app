import { useShallow } from "zustand/react/shallow"
import { useCase, useCaseActions, useCaseView, useTable } from "@/components/cases/store/context"
import { ExportPanel } from "@/components/convert/export-dialog"

/** ダウンロードの段: 前の確認（残り・7割・決算書の額・エラー）とダウンロードのボタン。残りの段を押すとその段へ移る */
export function ExportTab() {
  const actions = useCaseActions()
  const output = useTable((t) => t.output)
  const { summary, todo, questionStates } = useCaseView(useShallow((v) => ({ summary: v.summary, todo: v.todo, questionStates: v.questionStates })))
  const { basis, rule7Tax, tax } = useCase(useShallow((s) => ({ basis: s.work.basis, rule7Tax: s.work.rule7Tax, tax: s.work.tax })))
  if (!output) return null
  return (
    <ExportPanel
      output={output}
      summary={summary}
      basis={basis}
      rule7Tax={rule7Tax}
      onBasisChange={actions.setBasis}
      onExcel={() => void actions.downloadFinalExcel()}
      onCsv={actions.downloadCsv}
      steps={todo}
      onGo={actions.goStep}
      onFixAction={actions.runFixAction}
      // 金額・7割・載せる行に関わる聞き返し（報告の聞き返し）が残っている・税込か税抜かが決まっていない間は控えめに
      unsettled={tax === "unknown" || questionStates.some((q) => !q.answered)}
    />
  )
}
