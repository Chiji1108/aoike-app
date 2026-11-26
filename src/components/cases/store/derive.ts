import { canUndo } from "@/lib/cases/undo"
import { decisionOf, type ChatChange, type Proposal } from "@/lib/chat/proposals"
import type { CaseState } from "./create-case-store"

/**
 * ストアの状態から作る派生（変更案の欄・未決の有無）。入力（変更案・取り消しの記録・変更案の中身）の参照が同じなら同じ結果（同じ参照）を返すので、
 * 描画（selector）でも action でも同じものを読め、欄に渡す配列が描画ごとに変わらない。
 * 表の変換の鎖（元・計画・住所から作るもの）は、元や住所をストアに移すとき（段③）にここへ足す
 */
export type Derived = {
  /** 欄に出す変更案（出どころごと）: 開いているものと、承認を取り消せるもの（決め終わっても、取り消すまで欄に残す） */
  panels: { excel: Proposal[]; answer: Proposal[]; location: Proposal[]; fix: Proposal[] }
  /** まだ決めていない振り返りの案がある（決めるまで振り返りの案内を重ねて出さない） */
  pendingReview: boolean
  /** まだ決めていない問い合わせのメールの下書きの案がある（決めるまで「AI でメールの下書きを作る」を出さない） */
  pendingInquiryText: boolean
  /** 未決の工事場所の項目がある変更案がある（決めるまで次の一括調査を始めさせない） */
  undecidedLocation: boolean
}

let last: { proposals: CaseState["work"]["proposals"]; undo: CaseState["work"]["undo"]; contents: CaseState["contents"]; out: Derived } | null = null

export function derive(s: CaseState): Derived {
  const { proposals, undo } = s.work
  if (last && last.proposals === proposals && last.undo === undo && last.contents === s.contents) return last.out
  const out = deriveFrom(proposals, undo, s.contents)
  last = { proposals, undo, contents: s.contents, out }
  return out
}

function deriveFrom(proposals: readonly Proposal[], undo: CaseState["work"]["undo"], contents: ReadonlyMap<string, readonly ChatChange[]>): Derived {
  const undoable = new Set(undo.filter(canUndo).map((e) => e.proposalId))
  const shown = (p: Proposal) => p.state === "open" || undoable.has(p.id)
  const panel = (kind: Proposal["origin"]["kind"]) => proposals.filter((p) => p.origin.kind === kind && shown(p))
  /** 開いている変更案に、未決の項目で when に合うものがあるか */
  const pendingWhere = (when: (c: ChatChange) => boolean) =>
    proposals.some((p) => p.state === "open" && (contents.get(p.id) ?? []).some((c, i) => when(c) && decisionOf(p, i) === "pending"))
  return {
    panels: { excel: panel("excel"), answer: panel("answer"), location: panel("location"), fix: panel("fix") },
    pendingReview: pendingWhere((c) => c.kind === "rule" && c.source === "review"),
    pendingInquiryText: pendingWhere((c) => c.kind === "inquiryMail"),
    undecidedLocation: pendingWhere((c) => c.kind === "location"),
  }
}
