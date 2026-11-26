import { useCase, useCaseActions, useTable } from "@/components/cases/store/context"
import { ReplacePanel } from "@/components/convert/replace-panel"
import { KOJI_KEIREKI } from "@/lib/spec/koji-keireki"

/** 一括置換のタブ */
export function ReplaceTab() {
  const actions = useCaseActions()
  const rows = useTable((t) => t.rows)
  const letters = useTable((t) => t.letters)
  const replacements = useCase((s) => s.work.replacements)
  if (!rows) return null
  return <ReplacePanel spec={KOJI_KEIREKI} rows={rows} letters={letters} replacements={replacements} onChange={actions.replaceValue} />
}
