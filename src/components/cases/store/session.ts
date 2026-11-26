import type { UploadNote } from "@/components/cases/case-report"
import { addressCache } from "@/lib/convert/address"
import type { FileKind, CaseFile, CaseStatus } from "@/lib/cases/types"
import type { MappingPlan, SheetGrid } from "@/lib/convert/plan"
import type { KojiFieldId } from "@/lib/spec/koji-keireki"
import { changeStatus } from "./actions/case"
import { importAnswers, importFinal, keepFile, note } from "./actions/files"
import { decideProposal, undoGroup } from "./actions/proposals"
import { addCost, changePlan, convert, ensureAddresses, loadPreviousSheets, needsConversion, openSource, retry, setCost, startPlanning, supersedeConversion } from "./actions/source"
import { createCaseStore, initialCaseState, setRuntime, type CaseState, type Source } from "./create-case-store"
import type { CaseDeps } from "./deps"
import type { CaseEnv, SessionPage } from "./env"
import { createCaseSync, type PeerChannel } from "./sync"
import { createTableDerive } from "./table"

/**
 * 案件の画面の1回分（案件ごとに1つ。CaseWorkspace が作る）: ストア・表の派生・待つ処理（action）・保存と同期をまとめる。
 * 自動の処理（住所の値が変わったら引く・計画が決まって変換していなければ変換する）は、画面の effect ではなくストアの変化を見て始める
 */
export function createCaseSession(page: SessionPage, deps: CaseDeps, channel: () => PeerChannel | null) {
  const store = createCaseStore(initialCaseState(page))
  const addresses = addressCache(deps.lookupAddresses)
  const env: CaseEnv = {
    store,
    deps,
    config: { chatEnabled: page.chatEnabled, excelKey: page.excelKey, caseId: page.kase.id, previous: page.previous },
    table: createTableDerive(addresses),
    addresses,
    previousLoad: { current: null },
  }
  const sync = createCaseSync(store, { caseId: page.kase.id, save: deps.saveState, version: page.state?.version ?? 0, saved: page.state ? store.getState().work : null, channel })

  const actions = {
    openSource: (file: CaseFile, replan: boolean) => openSource(env, file, replan),
    startPlanning: (src: Source, requiredSheet?: string) => startPlanning(env, src, requiredSheet),
    changePlan: (p: MappingPlan<KojiFieldId>) => changePlan(env, p),
    retry: (what: "source" | "convert") => retry(env, what),
    supersedeConversion: () => void supersedeConversion(env),
    keepFile: (kind: FileKind, blob: Blob, name: string) => keepFile(env, kind, blob, name),
    note: (n: UploadNote) => note(env, n),
    importFinal: (f: File, sheets: readonly SheetGrid[]) => importFinal(env, f, sheets),
    importAnswers: (f: File, kind: "marked" | "answer") => importAnswers(env, f, kind),
    decideProposal: (id: string, indices: number[], decision: "applied" | "rejected") => decideProposal(env, id, indices, decision),
    /** 取り消す（actions/proposals.ts の undoGroup）。計画を戻したら、待っている変換の結果を捨てる（変換し直す） */
    undo: (group: string) => {
      const r = undoGroup(store, group)
      if (r?.planChanged) supersedeConversion(env)
      return r
    },
    changeStatus: (s: CaseStatus) => changeStatus(env, s),
    addCost: (usd: number) => addCost(env, usd),
    setCost: (usd: number) => setCost(env, usd),
    /** 案内を送った（返ってきた Excel の案内はファイルの id、振り返りは review） */
    dropHint: (kind: "review" | { fileId: string }) =>
      setRuntime(store, (r) => ({ hints: kind === "review" ? { ...r.hints, review: false } : { ...r.hints, answer: r.hints.answer.filter((h) => h.fileId !== kind.fileId) } })),
  }

  return {
    store,
    table: env.table,
    actions,
    settle: sync.settle,
    /**
     * 画面につなぐ（保存の層・別のタブとの道・自動で始める処理）。変換の元をまだ読んでいなければ読み、計画が無ければ立てる。去年の Excel も読み始める。
     * 返す関数で外す: 自動保存は待っている変更を送ってそのあとは受けず、自動で始める処理をやめ、世代を上げて待っている元・計画・変換の結果を捨てる
     * （画面を離れたあとに AI の結果を入れて保存しない。開き直した画面が読み直す）
     */
    connect() {
      const disconnectSync = sync.connect()
      const unwatch = watch(env)
      const { work, runtime } = store.getState()
      const file = runtime.files.find((f) => f.id === work.sourceFileId)
      if (file && (!runtime.source || (!work.plan && env.config.chatEnabled))) void openSource(env, file, !work.plan)
      // 去年の Excel は開いたときから読み始める（計画の AI に添えるのと、去年との違いに使う。1回だけ読む）
      void loadPreviousSheets(env)
      return () => {
        unwatch()
        setRuntime(store, (r) => ({
          gen: { ...r.gen, source: r.gen.source + 1, case: r.gen.case + 1, conversion: r.gen.conversion + 1 },
          loading: null,
          planDraft: null,
          converting: false,
        }))
        disconnectSync()
      }
    },
  }
}

export type CaseSession = ReturnType<typeof createCaseSession>
export type CaseActions = CaseSession["actions"]

/**
 * ストアの変化を見て始める処理（前の画面の effect の代わり。どの action のあとでも漏れない）:
 * 住所の値の集まりが変わったら新しい値を引き、計画が決まって変換していなければ変換する（計画が変わったときも）。
 * 変化を知らせている最中にストアを変えないよう、次の microtask で今の状態を確かめてから始める
 */
function watch(env: CaseEnv): () => void {
  const { store } = env
  let watching = true
  let lastSig: string | null = null
  let lastNeeds = false
  let lastPlan = store.getState().work.plan
  const check = (s: CaseState) => {
    const t = env.table(s)
    if (t.addressSig !== lastSig) {
      lastSig = t.addressSig
      const values = t.addressValues
      if (values)
        queueMicrotask(() => {
          if (watching) void ensureAddresses(env, values)
        })
    }
    const needs = needsConversion(env, s)
    const planChanged = s.work.plan !== lastPlan
    if (needs && (!lastNeeds || planChanged))
      queueMicrotask(() => {
        if (watching && needsConversion(env, store.getState())) void convert(env)
      })
    lastNeeds = needs
    lastPlan = s.work.plan
  }
  // つないだときの状態でも確かめる（外していた間に決まった計画も変換する）
  check(store.getState())
  const unsubscribe = store.subscribe(check)
  return () => {
    watching = false
    unsubscribe()
  }
}
