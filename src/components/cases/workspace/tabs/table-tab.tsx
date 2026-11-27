import { Loader2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useCase, useCaseActions, useCaseView, useTable } from "@/components/cases/store/context"
import { derive } from "@/components/cases/store/derive"
import { PreviewTable } from "@/components/convert/preview-table"
import { CONFIRM_LABEL, type TableFilter } from "@/components/convert/status"
import { editSession } from "@/lib/convert/convert"
import { tableKindOf } from "@/lib/cases/steps"
import { KOJI_KEIREKI } from "@/lib/spec/koji-keireki"

/**
 * 直すの段と表: 変換した表（手直し・入れ外し・直し方の操作）。直すの段では直す行だけ（理由で絞れ、理由と直し方の列を出す）、
 * 表ではすべての行（聞き返しの対象の行に絞れる）。「直す／すべて」の切り替えは出さない（開いているもので決まる）
 */
export function TableTab() {
  const actions = useCaseActions()
  const { shown, inclusion, letters, output, reconverting } = useTable(
    useShallow((t) => ({ shown: t.shown, inclusion: t.inclusion, letters: t.letters, output: t.output, reconverting: t.reconverting })),
  )
  const { rowFixes, todo, askRows, view, visible } = useCaseView(
    useShallow((v) => ({ rowFixes: v.rowFixes, todo: v.todo, askRows: v.askRows, view: v.view, visible: v.visible })),
  )
  const selection = useCase((s) => s.work.selection)
  const filter = useCase((s) => s.ui.filter)
  const lastConfirm = useCase((s) => derive(s).lastOp.confirm)
  if (!shown || !output) return null
  /**
   * 表の絞り込み。種類は開いているもので決まる（直すの段は直す行、表はすべて）。理由は直すの段だけ、聞き返しは表だけで使う。
   * もう無い聞き返し（計画を立て直した）・行が無くなった理由（直し終えた）は外す（絞り込みから抜けられなくならないように）
   */
  const kind = tableKindOf(view)
  const reason = kind === "fix" && filter?.reason && todo.fix.byKind[filter.reason] > 0 ? filter.reason : undefined
  const ask = kind === "all" && filter?.ask && askRows.some((a) => a.id === filter.ask) ? filter.ask : undefined
  const tableFilter: TableFilter = { kind, ...(reason ? { reason } : {}), ...(ask ? { ask } : {}) }
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
        filter={tableFilter}
        onFilterChange={actions.setFilter}
        fixes={rowFixes}
        counts={todo.fix}
        asks={askRows}
        onOpenInquiry={() => actions.showTab("inquiry")}
        onFixAction={actions.runFixAction}
        onConfirm={actions.confirmCell}
        confirmUndo={lastConfirm ? () => actions.undoWithNotice(lastConfirm.proposalId, `「${CONFIRM_LABEL}」`) : null}
        onGoFix={() => actions.goStep("fix")}
        visible={visible === "table" || visible === "fix"}
      />
    </>
  )
}
