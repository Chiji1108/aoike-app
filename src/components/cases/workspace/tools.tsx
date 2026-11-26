import { createContext, useContext } from "react"
import { useUsdJpy } from "@/components/cost"
import { useLocationSearch, type LocationSearch } from "@/components/convert/location-panel"
import { useGyoshuSuggestion, type GyoshuSuggestionState } from "@/components/convert/fix-suggestion"
import { useCase, useCaseSession, useTable } from "@/components/cases/store/context"
import { derive } from "@/components/cases/store/derive"
import type { UsdJpy } from "@/lib/fx"

/**
 * 案件の画面の道具のうち、自分で状態を持つもの（工事場所の一括調査・業種の AI の案・ドル円）。結果の変更案はストアの action（receiveRecorded）で足し、
 * 状態は画面のいくつかの部品（チャット・報告・作業のタブ）が同じものを読むので、ここで1つ持って渡す
 */
export type WorkspaceTools = { location: LocationSearch; gyoshu: GyoshuSuggestionState; fx: UsdJpy | null }

const ToolsContext = createContext<WorkspaceTools | null>(null)

export function useWorkspaceTools(): WorkspaceTools {
  const tools = useContext(ToolsContext)
  if (!tools) throw new Error("WorkspaceToolsProvider の外では使えません")
  return tools
}

/** 道具を1つ持つ（children はこの部品が描き直しても作り直さないので、道具を読む部品だけが描き直る） */
export function WorkspaceToolsProvider({ children }: { children: React.ReactNode }) {
  const session = useCaseSession()
  const { actions, config } = session
  const view = useTable((t) => t.view)
  // 未決の工事場所の項目がある変更案（一括調査のものも、チャットの「この現場ってどこ？」のものも）を決めるまで、次の一括調査を始めさせない
  const undecided = useCase((s) => derive(s).undecidedLocation)
  const location = useLocationSearch({ caseId: config.caseId, view, table: session.tableWire, undecided, onRecord: actions.receiveRecorded, onCaseCost: actions.setCost })
  const gyoshu = useGyoshuSuggestion({ caseId: config.caseId, onRecord: actions.receiveRecorded, onCaseCost: actions.addCost })
  const fx = useUsdJpy()
  return <ToolsContext.Provider value={{ location, gyoshu, fx }}>{children}</ToolsContext.Provider>
}
