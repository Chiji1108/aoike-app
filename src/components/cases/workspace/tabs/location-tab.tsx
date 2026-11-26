import { useCase, useTable } from "@/components/cases/store/context"
import { derive } from "@/components/cases/store/derive"
import { LocationPanel } from "@/components/convert/location-panel"
import { useProposalActions } from "../hooks"
import { useWorkspaceTools } from "../tools"

/** 工事場所のタブ: 一括調査（費用の目安を見てから職員が始める）と、その変更案 */
export function LocationTab() {
  const { location, fx } = useWorkspaceTools()
  const proposalActions = useProposalActions()
  const view = useTable((t) => t.view)
  const contents = useCase((s) => s.contents)
  const busy = useCase((s) => s.runtime.busy.rule)
  const proposals = useCase((s) => derive(s).panels.location)
  if (!view) return null
  return <LocationPanel search={location} view={view} proposals={proposals} changes={contents} actions={proposalActions} busy={busy} fx={fx} />
}
