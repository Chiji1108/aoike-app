import type { ValueFilter } from "@/lib/convert/plan"
import type { CaseWork } from "@/lib/cases/state"
import { canUndo, pushUndo, undo, undoEntry, type UndoEntry, type UndoKind } from "@/lib/cases/undo"
import { withLogged, withUndone, type ProposalRecord } from "@/lib/chat/proposals"
import type { CaseState, CaseStore } from "../create-case-store"

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
 * items は承認した変更案の項目の番号、external は戻さない外への書き込み、exclusions は計画の聞き返しの答えで足した出さない行の決まり
 * （計画の前後の代わりに、足した分だけを残す）
 */
export type CommitMeta = { group: string; kind: UndoKind; items?: number[]; external?: UndoEntry["external"]; exclusions?: ValueFilter[] }

/** 入れた変更の取り消し: undoable は取り消せる、tooLarge は記録が大きすぎて取り消せない、none は記録が無い（変わったものが無かった） */
export type Committed = "undoable" | "tooLarge" | "none"

/**
 * 取り消せる変更（承認・聞き返しの答え・画面の操作）を入れる。next はその時点の状態から次の作業を作り、前後の差分を取り消しの記録にして同じ1回で積む
 * （取り消しの記録を積むのはここだけ）。変更案の承認なら、記録に残した項目を変更案にも書く（logged）。取り消せるかを返す（取り消せるときだけ「取り消す」を出す）
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
      items: meta.items ?? [],
      label: meta.group,
      at: Date.now(),
      external: meta.external,
      exclusions: meta.exclusions,
    })
    if (!entry) return { work: after }
    const undo = pushUndo(after.undo, entry)
    result = undo.at(-1)!.tooLarge ? "tooLarge" : "undoable"
    const items = meta.items ?? []
    const proposals = meta.kind === "approval" && items.length ? after.proposals.map((p) => (p.id === meta.group ? withLogged(p, items) : p)) : after.proposals
    return { work: { ...after, undo, proposals } }
  })
  return result
}

export type UndoSummary = { reverted: number; kept: number; planChanged: boolean }

/**
 * group の、まだ取り消していない記録を新しい順に取り消す（cases/undo.ts: 後のままの値だけを戻し、あとで変えた値は残して kept に数える）。
 * 変更案の承認なら、取り消した項目の番号を変更案にも書く（記録が上限で捨てられても、振り返り・去年のやり方が取り消したことを知れる）。
 * 変更案は開き直さない。計画を戻したら変換し直す（converted を外す）。取り消せる記録が無ければ null
 */
export function undoGroup(store: CaseStore, group: string): UndoSummary | null {
  let out: UndoSummary | null = null
  store.setState((s) => {
    let work = s.work
    const sum: UndoSummary = { reverted: 0, kept: 0, planChanged: false }
    const items: number[] = []
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
      items.push(...(e.items ?? []))
    }
    if (!undone) return s
    if (items.length) work = { ...work, proposals: work.proposals.map((p) => (p.id === group ? withUndone(p, items) : p)) }
    if (sum.planChanged) work = { ...work, converted: false }
    out = sum
    return { work }
  })
  return out
}
