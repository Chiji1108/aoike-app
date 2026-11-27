import { toast } from "sonner"
import { MAX_ADDED_ROWS } from "@/lib/cases/added"
import type { CaseWork } from "@/lib/cases/state"
import { canUndo, pushUndo, undo, undoEntry, type UndoEntry, type UndoKind } from "@/lib/cases/undo"
import { addedCountAfter, applyChanges, approvedChange, decide, decisionOf, isAnswered, type Proposal, type ProposalRecord } from "@/lib/chat/proposals"
import type { MappingPlan, ValueFilter } from "@/lib/convert/plan"
import { applyPlanPatch, sheetShapeOf } from "@/lib/convert/plan-patch"
import { errorMessage } from "@/lib/errors"
import { KOJI_KEIREKI, type KojiFieldId } from "@/lib/spec/koji-keireki"
import { setRuntime, setWork, type CaseState, type CaseStore } from "../create-case-store"
import type { CaseEnv } from "../env"
import { supersedeConversion } from "./source"

/**
 * 変更案を中身と一緒に足す（変更案を足すのはここだけ。状態と中身を1回で入れるので、開いている変更案には必ず中身がある）。
 * replace はもうある同じ id の変更案を置き換えて最後に回す（チャットの返事・新しく作った変更案）。
 * ifUnknown は作業にもう同じ id があれば何もしない（サーバーが置いた記録を受け取る。決め終わったものを開き直さない）
 */
export function receiveProposal(store: CaseStore, record: ProposalRecord, how: "replace" | "ifUnknown") {
  const { id } = record.proposal
  store.setState((s) => {
    if (how === "ifUnknown" && s.work.proposals.some((p) => p.id === id)) return s
    return { contents: new Map(s.contents).set(id, record.changes), work: { ...s.work, proposals: [...s.work.proposals.filter((p) => p.id !== id), record.proposal] } }
  })
}

/**
 * 取り消せる変更の記録の中身。group は取り消すときの単位（変更案の id・`report:<聞き返し>`・操作の印と id）、kind は上限を数える枠、
 * external は戻さない外への書き込み、exclusions は計画の聞き返しの答えで足した出さない行の決まり（計画の前後の代わりに、足した分だけを残す）
 */
export type CommitMeta = { group: string; kind: UndoKind; external?: UndoEntry["external"]; exclusions?: ValueFilter[] }

/** 入れた変更の取り消し: undoable は取り消せる、tooLarge は記録が大きすぎて取り消せない、none は記録が無い（変わったものが無かった） */
export type Committed = "undoable" | "tooLarge" | "none"

/**
 * 取り消せる変更（承認・聞き返しの答え・画面の操作）を入れる。next はその時点の状態から次の作業を作り、前後の差分を取り消しの記録にして同じ1回で積む
 * （取り消しの記録を積むのはここだけ）。取り消せるかを返す（取り消せるときだけ「取り消す」を出す）
 */
export function commit(store: CaseStore, meta: CommitMeta, next: (s: CaseState) => CaseWork): Committed {
  let result: Committed = "none"
  store.setState((s) => {
    const before = s.work
    const after = next(s)
    const entry = undoEntry(before, meta.exclusions ? { ...after, plan: before.plan } : after, {
      id: crypto.randomUUID(),
      proposalId: meta.group,
      kind: meta.kind,
      label: meta.group,
      at: Date.now(),
      external: meta.external,
      exclusions: meta.exclusions,
    })
    if (!entry) return { work: after }
    const undo = pushUndo(after.undo, entry)
    result = undo.at(-1)!.tooLarge ? "tooLarge" : "undoable"
    return { work: { ...after, undo } }
  })
  return result
}

export type UndoSummary = { reverted: number; kept: number; planChanged: boolean }

/**
 * group の、まだ取り消していない記録を新しい順に取り消す（cases/undo.ts: 後のままの値だけを戻し、あとで変えた値は残して kept に数える）。
 * 変更案は開き直さない。計画を戻したら変換し直す（converted を外す）。取り消せる記録が無ければ null
 */
export function undoGroup(store: CaseStore, group: string): UndoSummary | null {
  let out: UndoSummary | null = null
  store.setState((s) => {
    let work = s.work
    const sum: UndoSummary = { reverted: 0, kept: 0, planChanged: false }
    let undone = false
    for (const e of [...work.undo].reverse()) {
      if (e.proposalId !== group || !canUndo(e)) continue
      const r = undo(work, e.id)
      if (!r) continue
      undone = true
      work = r.work
      sum.reverted += r.reverted
      sum.kept += r.kept
      sum.planChanged ||= r.planChanged
    }
    if (!undone) return s
    if (sum.planChanged) work = { ...work, converted: false }
    out = sum
    return { work }
  })
  return out
}

const updateProposal = (store: CaseStore, id: string, next: (p: Proposal) => Proposal) =>
  setWork(store, (w) => ({ ...w, proposals: w.proposals.map((p) => (p.id === id ? next(p) : p)) }))

/** 外に書いている間（ルールの追記）の印。書き終えたら（失敗しても）外す */
async function writingOutside<T>(env: CaseEnv, run: () => Promise<T>) {
  setRuntime(env.store, (r) => ({ busy: { ...r.busy, rule: true } }))
  try {
    return await run()
  } finally {
    setRuntime(env.store, (r) => ({ busy: { ...r.busy, rule: false } }))
  }
}

/**
 * 変更案を承認・却下する。承認した表の変更は手直し・入れ外し・設定に重ね、列の対応の変更は今の計画に重ねて変換し直す。
 * 承認するたびに取り消しの記録を残す。ルールの追記は外（ルール）に書けてから承認の印を付ける
 * （ルールは1件ずつ。途中で失敗しても、書けた追記は承認済みになり、もう一度承認しても二重に足さない）
 */
export async function decideProposal(env: CaseEnv, id: string, indices: number[], decision: "applied" | "rejected") {
  const { store, deps } = env
  const { work, contents } = store.getState()
  const p = work.proposals.find((x) => x.id === id)
  const changes = contents.get(id)
  if (!p || p.state !== "open" || !changes) return
  const chosen = indices.filter((i) => decisionOf(p, i) === "pending")
  if (decision === "rejected") return updateProposal(store, id, (x) => decide(x, chosen, "rejected"))
  if (!isAnswered(p)) return
  const planned = chosen.filter((i) => changes[i]!.kind === "plan")
  const table = chosen.filter((i) => changes[i]!.kind !== "rule" && changes[i]!.kind !== "plan")
  // 足した行の上限を超える承認はしない（超えるとチャットに表を送れなくなる）
  const after = addedCountAfter(work.added, table.map((i) => changes[i]!))
  if (after > MAX_ADDED_ROWS) {
    toast.error(`承認すると足した行が ${after} 行になります。案件に足せる行は ${MAX_ADDED_ROWS} 行までです（承認していません）`)
    return
  }
  // 列の対応の変更は、今の計画と計画の元のシートで確かめ直す（AI の計画の取り込みと同じ決まり）。合わなければ承認しない
  let nextPlan: MappingPlan<KojiFieldId> | null = null
  if (planned.length) {
    const { grid } = env.table(store.getState())
    const { source } = store.getState().runtime
    if (!work.plan || !grid || !source) {
      toast.error("変換の元のファイルを読んでいます。読み終えてから承認してください")
      return
    }
    let p0 = work.plan.plan
    for (const i of planned) {
      const c = changes[i]!
      if (c.kind !== "plan") continue
      const r = applyPlanPatch(KOJI_KEIREKI, p0, c.patch, sheetShapeOf(grid), source.sheets)
      if (!r.ok) {
        toast.error(`列の対応を変えられません（承認していません）: ${r.problems.join(" / ")}`)
        return
      }
      p0 = r.plan
    }
    nextPlan = p0
  }
  const apply = (items: number[]) => {
    if (!items.length) return
    commit(store, { group: id, kind: "approval" }, (s) => {
      const w = s.work
      const edited = env.table(s).view?.edited ?? []
      const overlaid = applyChanges(w, edited, items.map((i) => approvedChange(p, changes[i]!)))
      const replanned = nextPlan && items.some((i) => changes[i]!.kind === "plan") && w.plan ? { ...overlaid, plan: { ...w.plan, plan: nextPlan }, converted: false } : overlaid
      return { ...replanned, proposals: w.proposals.map((x) => (x.id === id ? decide(x, items, "applied") : x)) }
    })
  }
  if (nextPlan) supersedeConversion(env)
  apply([...table, ...planned])
  // 外に書くのを待っている間に元が変わった（変更案が閉じた）・変更案を決め終えたら、表に重ねず承認の印も付けない
  const generation = store.getState().runtime.gen.case
  const stillOpen = () => store.getState().runtime.gen.case === generation && store.getState().work.proposals.find((x) => x.id === id)?.state === "open"
  const rules = chosen.filter((i) => changes[i]!.kind === "rule")
  if (!rules.length) return
  try {
    const closed = await writingOutside(env, async () => {
      for (const i of rules) {
        if (!stillOpen()) return true
        // サーバーが変更案の記録から追記し、足した印も一緒に書く（開き直して同じ項目をもう一度承認しても二度足さない）
        await deps.approveRule(id, i)
        if (!stillOpen()) return true
        commit(store, { group: id, kind: "approval", external: ["rule"] }, ({ work: w }) => ({ ...w, proposals: w.proposals.map((x) => (x.id === id ? decide(x, [i], "applied") : x)) }))
      }
      return false
    })
    if (closed) toast.info("待っている間に変更案が閉じたので、残りのルールの追記と承認の印はやめました（書けた追記はルールに入っています）")
    else toast.success("ルールに追記しました")
  } catch (e) {
    toast.error(errorMessage(e, "ルールに追記できませんでした（保存できたものは承認済みにしました）"))
  }
}
