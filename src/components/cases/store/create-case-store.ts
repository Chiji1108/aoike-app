import { createStore } from "zustand"
import { fromSaved, newWork, type CaseWork, type SavedAiCache, type SavedWork } from "@/lib/cases/state"
import type { Rule7Tax } from "@/lib/convert/koji-selection"
import { reviewPlanTransforms } from "@/lib/convert/plan"
import { withRecorded, type ChatChange, type ProposalRecord } from "@/lib/chat/proposals"
import { KOJI_KEIREKI } from "@/lib/spec/koji-keireki"

/**
 * 案件の画面のストア（案件ごとに1つ。CaseWorkspace が作り、context で渡す）。
 * work は保存する作業（自動保存が参照の変化を拾う）、contents は変更案の中身（サーバーが R2 に置いたものの写し。proposal の id → 変更の並び）。
 * 変えるときは setState((s) => …) の中で s だけを読み、待っている処理は getState() で最新を読む（前の描画の値を使わない）
 */
export type CaseState = {
  work: CaseWork
  contents: ReadonlyMap<string, readonly ChatChange[]>
}

export type CaseStore = ReturnType<typeof createCaseStore>

export function createCaseStore(init: CaseState) {
  return createStore<CaseState>()(() => init)
}

/** 作業を変える（next はその時点の作業から作る） */
export function setWork(store: CaseStore, next: (w: CaseWork) => CaseWork) {
  store.setState((s) => ({ work: next(s.work) }))
}

/** 変更案をその中身と一緒に足す（1回で入れる。proposals はその時点の作業の変更案から作る） */
export function putProposal(store: CaseStore, record: ProposalRecord, proposals: (ps: CaseWork["proposals"]) => CaseWork["proposals"]) {
  store.setState((s) => ({ contents: new Map(s.contents).set(record.proposal.id, record.changes), work: { ...s.work, proposals: proposals(s.work.proposals) } }))
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
 * サーバーが記録した変更案のうち、作業にまだ無いもの（返事を受け取り損ねたもの）も作業に入れる
 */
export function initialCaseState(page: {
  state: { work: SavedWork; aiCache: SavedAiCache } | null
  proposals: readonly ProposalRecord[]
  settings: { rule7Tax: Rule7Tax }
}): CaseState {
  const w = page.state ? fromSaved(page.state.work, page.state.aiCache) : newWork(null, page.settings.rule7Tax)
  return {
    work: { ...reviewSavedPlan(w), proposals: withRecorded(w.proposals, page.proposals) },
    contents: new Map(page.proposals.map((r) => [r.proposal.id, r.changes])),
  }
}
