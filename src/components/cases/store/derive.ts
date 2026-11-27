import type { UndoState } from "@/components/chat/proposal-card"
import { canUndo, CONFIRM_UNDO, GYOSHU_UNDO, type UndoEntry } from "@/lib/cases/undo"
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
  /** まだ決めていない問い合わせのメールの下書きの案がある（決めるまで「AI でメールの下書きを作る」を出さない） */
  pendingInquiryText: boolean
  /** 未決の工事場所の項目がある変更案がある（決めるまで次の一括調査を始めさせない） */
  undecidedLocation: boolean
  /** 取り消しの単位（変更案の id・`report:<聞き返し>`・操作の印と id）ごとの取り消せるか（変更案のカード・報告の聞き返し・ダウンロードの前の確認） */
  undoStates: ReadonlyMap<string, UndoState>
  /** 直前の、まだ取り消せる業種の一覧の決定・「これでよい」（業種のタブ・表の「取り消す」） */
  lastOp: { gyoshu: UndoEntry | null; confirm: UndoEntry | null }
}

/**
 * 入力ごとの memo（変更案 → 取り消しの記録 → 中身の参照で引く）。ストアに依らない（ストアが2つあっても取り合わない）。
 * 古い入力は参照が無くなれば消える
 */
const memo = new WeakMap<CaseState["work"]["proposals"], WeakMap<CaseState["work"]["undo"], WeakMap<CaseState["contents"], Derived>>>()

export function derive(s: CaseState): Derived {
  const { proposals, undo } = s.work
  let byUndo = memo.get(proposals)
  if (!byUndo) memo.set(proposals, (byUndo = new WeakMap()))
  let byContents = byUndo.get(undo)
  if (!byContents) byUndo.set(undo, (byContents = new WeakMap()))
  let out = byContents.get(s.contents)
  if (!out) byContents.set(s.contents, (out = deriveFrom(proposals, undo, s.contents)))
  return out
}

function deriveFrom(proposals: readonly Proposal[], undo: CaseState["work"]["undo"], contents: ReadonlyMap<string, readonly ChatChange[]>): Derived {
  const undoable = new Set(undo.filter(canUndo).map((e) => e.proposalId))
  const shown = (p: Proposal) => p.state === "open" || undoable.has(p.id)
  const panel = (kind: Proposal["origin"]["kind"]) => proposals.filter((p) => p.origin.kind === kind && shown(p))
  /** 開いている変更案に、未決の項目で when に合うものがあるか */
  const pendingWhere = (when: (c: ChatChange) => boolean) =>
    proposals.some((p) => p.state === "open" && (contents.get(p.id) ?? []).some((c, i) => when(c) && decisionOf(p, i) === "pending"))
  const undoStates = new Map<string, UndoState>()
  for (const e of undo) {
    const u = undoStates.get(e.proposalId) ?? { can: false, undone: false, tooLarge: false, external: [] }
    undoStates.set(e.proposalId, {
      can: u.can || canUndo(e),
      undone: u.undone || !!e.undone,
      tooLarge: u.tooLarge || !!e.tooLarge,
      external: [...new Set([...u.external, ...e.external])],
    })
  }
  const last = (mark: string) => undo.findLast((e) => e.proposalId.startsWith(mark) && canUndo(e)) ?? null
  return {
    undoStates,
    lastOp: { gyoshu: last(GYOSHU_UNDO), confirm: last(CONFIRM_UNDO) },
    panels: { excel: panel("excel"), answer: panel("answer"), location: panel("location"), fix: panel("fix") },
    pendingInquiryText: pendingWhere((c) => c.kind === "inquiryMail"),
    undecidedLocation: pendingWhere((c) => c.kind === "location"),
  }
}
