import { createStore } from "zustand"
import type { UploadNote } from "@/components/cases/case-report"
import type { FinalImport } from "@/components/convert/final-import-panel"
import type { SaveStatus } from "@/lib/cases/autosave"
import { fromSaved, newWork, type CaseWork, type SavedAiCache, type SavedPlan, type SavedWork } from "@/lib/cases/state"
import type { CaseFile, CaseStatus } from "@/lib/cases/types"
import { NO_ADDRESSES, type AddressBook } from "@/lib/convert/address"
import type { Rule7Tax } from "@/lib/convert/koji-selection"
import { reviewPlanTransforms, type SheetGrid } from "@/lib/convert/plan"
import type { Markability } from "@/lib/inquiry/markable"
import { withRecorded, type ChatChange, type ProposalRecord } from "@/lib/chat/proposals"
import { KOJI_KEIREKI } from "@/lib/spec/koji-keireki"

/** 変換の元。bytes は読んだファイル（印付きの Excel を書くのに使う。取り直さない）、markable は印付きの Excel にできるか（lib/inquiry/markable.ts） */
export type Source = { fileId: string; name: string; bytes: Uint8Array; sheets: SheetGrid[]; markable: Markability }

/**
 * 同じブラウザの別のタブ（BroadcastChannel で知らせ合う。sync.ts）: none はほかに無い、open は別のタブでも開いている、
 * saved は別のタブがこの案件を保存した（この画面の作業は古い。変えても保存はぶつかる）
 */
export type PeerState = "none" | "open" | "saved"

/**
 * 案件の画面のストア（案件ごとに1つ。CaseWorkspace が作り、context で渡す）。
 * work は保存する作業（自動保存〔sync.ts〕が参照の変化を拾う）、contents は変更案の中身（サーバーが R2 に置いたものの写し。proposal の id → 変更の並び）、
 * runtime は保存しない状態（読んだ元・計画と変換の途中・世代・費用など）、sync は保存の状態。
 * 変えるときは setState((s) => …) の中で s だけを読み、待っている処理は await のあとに getState() で最新を読み直す（前の描画の値・始めに取った値を使わない）
 */
export type CaseState = {
  work: CaseWork
  /**
   * 変更案の中身。開いている変更案には、記録が読めないもの（runtime.unreadable）のほかは必ずある
   * （足すのは receiveProposal だけ。記録の無い開いた変更案は、案件を読むときにサーバーが閉じる〔server/cases.ts の getCasePageFn〕）
   */
  contents: ReadonlyMap<string, readonly ChatChange[]>
  /** 保存しない状態 */
  runtime: {
    /** 案件を読むときに、中身（R2 の記録）が無くサーバーが閉じた変更案の数（報告に1行出す） */
    closedMissing: number
    /** 記録はあるが読めなかった変更案の数（作業にあるものは閉じずに残す。報告に1行出す。カードは決められない） */
    unreadable: number
    /** 離れてすぐ戻ったとき、前の画面の変更を保存できなかった（報告に1行出す） */
    previousUnsaved: boolean
    /** 案件のファイルの一覧（D1・R2 の写し。アップロード・ダウンロードの控えで足す） */
    files: CaseFile[]
    /** 案件の状態（変えるときは楽観的に変え、失敗したら savedStatus に戻す） */
    status: CaseStatus
    /** サーバーが最後に受け付けた案件の状態 */
    savedStatus: CaseStatus
    /** 案件の AI の費用の合計（変換・チャットの分。サーバーの合計に足したものを画面でも足す） */
    costUsd: number
    /** 読んだ変換の元 */
    source: Source | null
    /** 読んでいる変換の元のファイル名 */
    loading: string | null
    /** 変換の元を読めなかった（報告に理由とやり直しを出す） */
    sourceError: { file: CaseFile; message: string } | null
    /** AI が列の対応を考えている間の、見出しからの推定 */
    planDraft: SavedPlan | null
    converting: boolean
    /** 自動の変換が失敗したときの理由と、その計画（同じ計画で何度も変換し直さない） */
    convertError: { message: string; plan: SavedPlan | null } | null
    /**
     * 世代。待っている処理は始めに取り、待ったあとに今の世代と比べて違えば結果を捨てる。
     * source は元のファイルを読む、case は元・計画（計画・回答の結果を捨てる）、conversion は変換、status は案件の状態の変更
     */
    gen: { source: number; case: number; conversion: number; status: number }
    /** 去年の案件の元の Excel（形を比べる・列の計画の参考。読めなければ理由。読み終わるまで null） */
    previous: SheetGrid[] | { error: string } | null
    /** 引いた住所（増えたら表を作り直す） */
    addressBook: AddressBook
    /** ルールの追記・工事場所を保存している間（変更案の承認を止める） */
    busy: { rule: boolean }
    /** アップロードしたファイルをどう扱ったか（報告に出す。最後の10件） */
    notes: UploadNote[]
    /** 最後に上げ直した最後の Excel の結果（チャット欄の報告の下に出す） */
    finalResult: FinalImport | null
    /**
     * チャットの案内: answer は色付きの欄の外の記入・読めなかった記入のある返ってきた Excel（ファイルごとに AI に読ませるかを出す）、
     * review は案件を「完了」にしたので振り返りを出せると案内するか（完了から戻すか、送ったら消す）
     */
    hints: { answer: { fileId: string; name: string }[]; review: boolean }
  }
  /** 保存の状態と、同じブラウザの別のタブ */
  sync: { status: SaveStatus; peer: PeerState }
}

export type CaseStore = ReturnType<typeof createCaseStore>

export function createCaseStore(init: CaseState) {
  return createStore<CaseState>()(() => init)
}

/** 作業を変える（next はその時点の作業から作る） */
export function setWork(store: CaseStore, next: (w: CaseWork) => CaseWork) {
  store.setState((s) => ({ work: next(s.work) }))
}

/** 保存しない状態を変える（next はその時点の状態から、変える項目だけを作る） */
export function setRuntime(store: CaseStore, next: (r: CaseState["runtime"]) => Partial<CaseState["runtime"]>) {
  store.setState((s) => ({ runtime: { ...s.runtime, ...next(s.runtime) } }))
}

/**
 * 保存済みの計画を今の変換の決まりで確かめる（AI の計画の取り込みと同じ）。使えなくなった変換（個人名を匿名化しない変換など）は替え、
 * 変換し直す（替えた変換の AI の結果はまだ無い。開くと自動で変換する）
 */
function reviewSavedPlan(w: CaseWork): CaseWork {
  if (!w.plan) return w
  const { plan, changed } = reviewPlanTransforms(KOJI_KEIREKI, w.plan.plan)
  if (!changed.length) return w
  const notice = `保存した計画の ${changed.join("・")} を今の決まり（個人名の項目は匿名化する変換だけ）に合わせて直し、変換し直しました。`
  return { ...w, plan: { ...w.plan, plan, notice: [w.plan.notice, notice].filter(Boolean).join(" ") }, converted: false }
}

/**
 * 読み込んだ案件からストアの最初の状態を作る。保存した作業が無ければ新しい作業（7割の計算は事務所の設定）。
 * サーバーが記録した変更案のうち、作業にまだ無いもの（返事を受け取り損ねたもの）も作業に入れる。
 * closedMissing はサーバーが閉じた記録の無い変更案の数、unreadableProposals は記録を読めなかった変更案（作業に無いものも。閉じない）
 */
export function initialCaseState(page: {
  kase: { status: CaseStatus; costUsd: number }
  files: CaseFile[]
  state: { work: SavedWork; aiCache: SavedAiCache } | null
  proposals: readonly ProposalRecord[]
  unreadableProposals: readonly string[]
  closedMissing: number
  settings: { rule7Tax: Rule7Tax }
  previousUnsaved: boolean
}): CaseState {
  const w = page.state ? fromSaved(page.state.work, page.state.aiCache) : newWork(null, page.settings.rule7Tax)
  return {
    work: { ...reviewSavedPlan(w), proposals: withRecorded(w.proposals, page.proposals) },
    contents: new Map(page.proposals.map((r) => [r.proposal.id, r.changes])),
    runtime: {
      closedMissing: page.closedMissing,
      unreadable: page.unreadableProposals.length,
      previousUnsaved: page.previousUnsaved,
      files: page.files,
      status: page.kase.status,
      savedStatus: page.kase.status,
      costUsd: page.kase.costUsd,
      source: null,
      loading: null,
      sourceError: null,
      planDraft: null,
      converting: false,
      convertError: null,
      gen: { source: 0, case: 0, conversion: 0, status: 0 },
      previous: null,
      addressBook: NO_ADDRESSES,
      busy: { rule: false },
      notes: [],
      finalResult: null,
      hints: { answer: [], review: false },
    },
    sync: { status: { kind: "saved" }, peer: "none" },
  }
}
