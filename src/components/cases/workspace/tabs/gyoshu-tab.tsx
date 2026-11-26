import { useCase, useCaseActions, useCaseView } from "@/components/cases/store/context"
import { derive } from "@/components/cases/store/derive"
import { GyoshuPanel } from "@/components/convert/gyoshu-panel"
import { choicesOf } from "@/lib/spec/choices"
import { KOJI_KEIREKI } from "@/lib/spec/koji-keireki"
import { useGyoshuSuggest } from "../hooks"

/** 業種の選ぶ欄の選択肢 */
const GYOSHU_CHOICES = choicesOf(KOJI_KEIREKI.fields.find((f) => f.id === "gyoshu")!)!

/** 業種のタブ: 7割で載りうる行の業種を決める（AI の案を頼める。直前の決定は取り消せる） */
export function GyoshuTab() {
  const actions = useCaseActions()
  const rows = useCaseView((v) => v.todo.gyoshu.rows)
  const lastGyoshu = useCase((s) => derive(s).lastOp.gyoshu)
  const suggest = useGyoshuSuggest()
  return (
    <GyoshuPanel
      items={rows}
      choices={GYOSHU_CHOICES}
      onDecide={actions.decideGyoshu}
      suggest={{ run: suggest.run, blocked: suggest.blocked, running: suggest.state.running, last: suggest.state.last }}
      undo={lastGyoshu ? { count: lastGyoshu.edits.length, onUndo: () => actions.undoWithNotice(lastGyoshu.proposalId, "業種の決定") } : null}
    />
  )
}
