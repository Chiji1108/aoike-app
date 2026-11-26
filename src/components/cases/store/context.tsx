import { createContext, useContext } from "react"
import { useStore } from "zustand"
import type { CaseState, CaseStore } from "./create-case-store"

/** 案件の画面のストアを渡す（zustand の「props で初期化する」形: 案件ごとに createStore で作り、context で渡す） */
export const CaseStoreContext = createContext<CaseStore | null>(null)

/** 案件のストアそのもの（getState で最新を読む・setState で変える） */
export function useCaseStore(): CaseStore {
  const store = useContext(CaseStoreContext)
  if (!store) throw new Error("CaseStoreContext.Provider の外では使えません")
  return store
}

/** ストアの一部を読む（選んだ値が変わったときだけ描き直す。配列・オブジェクトを新しく作る selector は useShallow で包む） */
export function useCase<T>(selector: (s: CaseState) => T): T {
  return useStore(useCaseStore(), selector)
}
