import { createContext, useContext } from "react"
import { useStore } from "zustand"
import type { CaseState, CaseStore } from "./create-case-store"
import type { CaseView } from "./case-view"
import type { CaseSession } from "./session"
import type { TableDerived } from "./table"

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

/** 案件の action（変えるのはこれだけ。どれも描画の値を受け取らず、その時点の状態を読む） */
export function useCaseActions(): CaseSession["actions"] {
  return useCaseSession().actions
}

/** 表（変換の鎖。table.ts）の一部を読む（pick は表の派生の項目を選ぶだけにする。新しい配列・オブジェクトを作らない） */
export function useTable<T>(pick: (t: TableDerived) => T): T {
  const { table } = useCaseSession()
  return useCase((s) => pick(table(s)))
}

/** 表のあとの派生（件数・問い合わせ・聞き返し・並べ方。case-view.ts）の一部を読む（pick は項目を選ぶだけにする） */
export function useCaseView<T>(pick: (v: CaseView) => T): T {
  const { view } = useCaseSession()
  return useCase((s) => pick(view(s)))
}
