import { createContext, useContext } from "react"
import { useUsdJpy } from "@/components/cost"
import { useLocationSearch, type LocationSearch } from "@/components/convert/location-panel"
import { useGyoshuSuggestion, type GyoshuSuggestionState } from "@/components/convert/fix-suggestion"
import { useCase, useCaseSession, useTable } from "@/components/cases/store/context"
import { derive } from "@/components/cases/store/derive"
import type { UsdJpy } from "@/lib/fx"

/**
 * 案件の画面の道具のうち、自分で状態を持つもの（工事場所の一括調査・業種の AI の案・ドル円）。結果の変更案はストアの action（receiveRecorded）で足す。
 * 状態は画面のいくつかの部品が同じものを読むので、ここで1つずつ持って渡す。道具ごとに context を分け、各 hook は同じ状態なら同じものを返すので、
 * 読む部品はその道具の状態が変わったときだけ描き直る（children は各 Provider が描き直しても作り直さない）
 */
const LocationContext = createContext<LocationSearch | null>(null)
const GyoshuContext = createContext<GyoshuSuggestionState | null>(null)
const FxContext = createContext<UsdJpy | null | undefined>(undefined)

function need<T>(v: T | null | undefined, name: string): T {
  if (v === undefined || v === null) throw new Error(`${name} の外では使えません`)
  return v
}

/** 工事場所の一括調査 */
export const useLocationTool = () => need(useContext(LocationContext), "WorkspaceToolsProvider")
/** 業種の AI の案 */
export const useGyoshuTool = () => need(useContext(GyoshuContext), "WorkspaceToolsProvider")
/** ドル円（取れなければ null で、円は出さない） */
export function useFx(): UsdJpy | null {
  const fx = useContext(FxContext)
  if (fx === undefined) throw new Error("WorkspaceToolsProvider の外では使えません")
  return fx
}

export function WorkspaceToolsProvider({ children }: { children: React.ReactNode }) {
  return (
    <FxProvider>
      <GyoshuProvider>
        <LocationProvider>{children}</LocationProvider>
      </GyoshuProvider>
    </FxProvider>
  )
}

function FxProvider({ children }: { children: React.ReactNode }) {
  const fx = useUsdJpy()
  return <FxContext.Provider value={fx}>{children}</FxContext.Provider>
}

function GyoshuProvider({ children }: { children: React.ReactNode }) {
  const { actions, config } = useCaseSession()
  const gyoshu = useGyoshuSuggestion({ caseId: config.caseId, onRecord: actions.receiveRecorded, onCaseCost: actions.addCost })
  return <GyoshuContext.Provider value={gyoshu}>{children}</GyoshuContext.Provider>
}

function LocationProvider({ children }: { children: React.ReactNode }) {
  const session = useCaseSession()
  const { actions, config } = session
  const view = useTable((t) => t.view)
  // 未決の工事場所の項目がある変更案（一括調査のものも、チャットの「この現場ってどこ？」のものも）を決めるまで、次の一括調査を始めさせない
  const undecided = useCase((s) => derive(s).undecidedLocation)
  const location = useLocationSearch({ caseId: config.caseId, view, table: session.tableWire, undecided, onRecord: actions.receiveRecorded, onCaseCost: actions.setCost })
  return <LocationContext.Provider value={location}>{children}</LocationContext.Provider>
}
