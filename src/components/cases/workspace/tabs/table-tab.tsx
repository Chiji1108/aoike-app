import { Loader2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useCase, useCaseActions, useCaseView, useTable } from "@/components/cases/store/context"
import { derive } from "@/components/cases/store/derive"
import { PreviewTable } from "@/components/convert/preview-table"
import { CONFIRM_LABEL, type TableFilter } from "@/components/convert/status"
import { editSession } from "@/lib/convert/convert"
import { ALL_HINT_MANUAL } from "@/lib/convert/koji-selection"
import { KOJI_KEIREKI } from "@/lib/spec/koji-keireki"

/** 表のタブ: 変換した表（手直し・入れ外し・絞り込み・直し方の操作） */
export function TableTab() {
  const actions = useCaseActions()
  const { shown, inclusion, letters, output, reconverting } = useTable(
    useShallow((t) => ({ shown: t.shown, inclusion: t.inclusion, letters: t.letters, output: t.output, reconverting: t.reconverting })),
  )
  const { rowFixes, todo, askRows, manualIncluded } = useCaseView(useShallow((v) => ({ rowFixes: v.rowFixes, todo: v.todo, askRows: v.askRows, manualIncluded: v.manualIncluded })))
  const selection = useCase((s) => s.work.selection)
  const allHintClosed = useCase((s) => s.work.allHintClosed)
  const filter = useCase((s) => s.ui.filter)
  const lastConfirm = useCase((s) => derive(s).lastOp.confirm)
  if (!shown || !output) return null
  /**
   * 表の絞り込み。職員が選ぶまでは、直す行があればその行だけ（無ければすべて）。もう無い聞き返し（計画を立て直した）は「すべて」に戻し、
   * 行が無くなった理由（直し終えた）は理由を外す（絞り込みから抜けられなくならないように）
   */
  const chosen: TableFilter = filter ?? { kind: todo.fix.rows > 0 ? "fix" : "all" }
  const tableFilter: TableFilter =
    chosen.ask && !askRows.some((a) => a.id === chosen.ask) ? { kind: "all" } : chosen.reason && !(todo.fix.byKind[chosen.reason] > 0) ? { kind: chosen.kind } : chosen
  /** 7割ルールのまま手で載せた行が多ければ、表の上で全件を勧める */
  const allHint =
    selection === "rule7" && !allHintClosed && manualIncluded >= ALL_HINT_MANUAL
      ? { count: manualIncluded, onAll: () => actions.changeSelection("all"), onClose: actions.closeAllHint }
      : null
  return (
    <>
      {reconverting && (
        <div className="absolute inset-0 z-30 flex items-start justify-center bg-background/60 pt-24 backdrop-blur-[1px]" data-testid="reconverting">
          <span className="flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm shadow-sm">
            <Loader2 className="size-4 animate-spin text-violet-600" /> 列の対応を変えたので変換し直しています…
          </span>
        </div>
      )}
      {output.length === 0 && (
        <p className="mb-3 text-sm text-muted-foreground" data-testid="no-rows-note">
          載せる行がありません
        </p>
      )}
      <PreviewTable
        spec={KOJI_KEIREKI}
        rows={shown}
        inclusion={inclusion}
        openEditor={(cell) => editSession(cell, letters)}
        onEdit={actions.editCells}
        onToggle={actions.toggleRow}
        onToggleRange={actions.toggleRange}
        selection={selection}
        onSelection={actions.changeSelection}
        allHint={allHint}
        filter={tableFilter}
        onFilterChange={actions.setFilter}
        fixes={rowFixes}
        counts={todo.fix}
        asks={askRows}
        onOpenInquiry={() => actions.showTab("inquiry")}
        onFixAction={actions.runFixAction}
        onConfirm={actions.confirmCell}
        confirmUndo={lastConfirm ? () => actions.undoWithNotice(lastConfirm.proposalId, `「${CONFIRM_LABEL}」`) : null}
      />
    </>
  )
}
