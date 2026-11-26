import { createContext, useContext } from "react"
import { useStore } from "zustand"
import type { CaseState, CaseStore } from "./create-case-store"
import type { CaseSession } from "./session"

/** 案件の画面の1回分（ストア・表の派生・action・保存）を渡す（zustand の「props で初期化する」形: 案件ごとに作り、context で渡す） */
export const CaseSessionContext = createContext<CaseSession | null>(null)

/** 案件の画面の1回分 */
export function useCaseSession(): CaseSession {
  const session = useContext(CaseSessionContext)
  if (!session) throw new Error("CaseSessionContext.Provider の外では使えません")
  return session
}

/** 案件のストアそのもの（getState で最新を読む・setState で変える） */
export function useCaseStore(): CaseStore {
  return useCaseSession().store
}

/** ストアの一部を読む（選んだ値が変わったときだけ描き直す。配列・オブジェクトを新しく作る selector は useShallow で包む） */
export function useCase<T>(selector: (s: CaseState) => T): T {
  return useStore(useCaseStore(), selector)
}
