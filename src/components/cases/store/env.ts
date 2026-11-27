import type { addressCache } from "@/lib/convert/address"
import type { SheetGrid } from "@/lib/convert/plan"
import type { getCasePageFn } from "@/server/cases"
import type { CaseState, CaseStore } from "./create-case-store"
import type { CaseView } from "./case-view"
import type { CaseDeps } from "./deps"
import type { TableDerived } from "./table"

export type CasePageData = NonNullable<Awaited<ReturnType<typeof getCasePageFn>>>
export type PreviousCase = NonNullable<CasePageData["previous"]>
/** 案件の画面の読み込みのデータ（previousUnsaved は、離れてすぐ戻ったとき前の画面の変更を保存できなかった） */
export type CaseLoaderData = CasePageData & { previousUnsaved: boolean }
/** 案件の画面の1回分を作るのに使う、読み込んだページの部分 */
export type SessionPage = Pick<CaseLoaderData, "previousUnsaved" | "files" | "state" | "proposals" | "unreadableProposals" | "closedMissing" | "settings" | "chatEnabled" | "previous"> & {
  kase: Pick<CasePageData["kase"], "id" | "status" | "costUsd">
  customer: Pick<CasePageData["customer"], "name">
}

/** 案件ごとに決まっていて変わらないもの（読み込んだページから） */
export type CaseConfig = {
  /** AI が使えるか（APIキーがあるか） */
  chatEnabled: boolean
  caseId: string
  /** 顧客の名前（ダウンロードするファイルの名前） */
  customerName: string
  /** 去年の案件 */
  previous: PreviousCase | null
}

/**
 * 待つ処理（action）が使うもの: ストア・外の処理（deps）・案件の決まったもの・表の派生（ストアごと）と、状態ではないもの
 * （住所のキャッシュ、去年の Excel を1回だけ読む Promise）。ストアを作るときに1つ作る
 */
export type CaseEnv = {
  store: CaseStore
  deps: CaseDeps
  config: CaseConfig
  table: (s: CaseState) => TableDerived
  /** 表のあとの派生（件数・問い合わせ・聞き返し・並べ方。case-view.ts） */
  view: (s: CaseState) => CaseView
  addresses: ReturnType<typeof addressCache>
  previousLoad: { current: Promise<SheetGrid[] | null> | null }
}
