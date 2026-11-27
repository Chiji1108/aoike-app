import { countFixes, fixActionGroups, gyoshuTodo, type FixActionGroup, type FixCounts, type FixKind, type RowFix } from "@/components/convert/status"
import { editKey, type RowResult, type CellEdit } from "@/lib/convert/convert"
import type { Inclusion, TaxMode } from "@/lib/convert/koji-selection"
import type { TaxBy } from "@/lib/cases/tax"
import type { CaseStatus } from "@/lib/cases/types"
import { decisionOf, pendingOf, type ChatChange, type Proposal } from "@/lib/chat/proposals"
import { inquiryKey, type Inquiry } from "@/lib/inquiry/inquiry"
import { codeLabel } from "@/lib/spec/code-sets"
import { KOJI_KEIREKI, type KojiFieldId } from "@/lib/spec/koji-keireki"

/**
 * 案件の残りの件数（次にやること・ダウンロードの前の確認・表の「直す」・業種のタブ・タブの数・チャットの答えを待つ印）を1か所で数える。
 * 画面の各所はこの結果を読むだけにする（同じものを別々の式で数えて食い違わない）。
 *
 * 変更案をどこに数えるかの決まり（出どころごと）:
 * | 出どころ | 答える | 工事場所のタブ |
 * | chat | 開いていれば1件 | — |
 * | location | 数えない | 開いていれば1件 |
 */

/**
 * 顧客の回答の変更案（チャットの record_answers）で、承認を待っているセル（editKey）。答えは届いているので、問い合わせの「まだ答えのない」に数えず、
 * 「残りは聞かない」でも外さない（承認か却下は「答える」で決める）
 */
export function answeringCells(proposals: readonly Proposal[], contents: ReadonlyMap<string, readonly ChatChange[]>): Set<string> {
  const out = new Set<string>()
  for (const p of proposals) {
    if (p.state !== "open") continue
    contents.get(p.id)?.forEach((c, i) => {
      if (c.kind === "cell" && c.edit.by === "customer" && decisionOf(p, i) === "pending") out.add(editKey(c.rowKey, c.field))
    })
  }
  return out
}

/** 業種の一覧の1行（業種のタブ） */
export type GyoshuItem = {
  key: string
  workName: string
  amount: string
  included: boolean
  kind: FixKind
  plan: { value: string; note: string } | null
  /** 行の今の値（選ぶ欄に渡す） */
  values: Readonly<Record<KojiFieldId, string>>
}

/**
 * 「答える」の1件。question は報告の聞き返し（税・計画の聞き返し）、proposal は答えを待つチャットの変更案
 * （waiting は承認待ちの項目の数。question は聞き返しにまだ答えていないか）
 */
export type AnswerItem = { kind: "question"; id: string } | { kind: "proposal"; proposalId: string; waiting: number; question: boolean }

/**
 * 問い合わせの段: todo まだ送っていない、waiting 送った・返事待ち（案件が問い合わせ中で、答えのない問い合わせが残っている。税込・税抜も顧客に聞くので数える）、
 * done 済み（聞くことが無い・案件が完了）。送ったかは案件の状態（問い合わせ中）だけで決める
 */
export type InquiryState = "todo" | "waiting" | "done"

export type CaseTodo = {
  /** 答えるもの（並びは報告の聞き返し → 変更案）。数は answer.length */
  answer: AnswerItem[]
  /** 業種を決める行（金額の大きい順。案は業種の AI の案か今の値） */
  gyoshu: { rows: GyoshuItem[] }
  /** 直す行（表の「直す」と同じ数） */
  fix: FixCounts
  /** 直す行のうち、まとめて頼める直し方 */
  fixActions: FixActionGroup[]
  /**
   * 問い合わせ。active はまだ答えのない問い合わせ（外したもの・回答の変更案で承認を待つセルを除く。完了した案件は 0）、
   * left はそのうちセルの問い合わせ、topics は案件全体の問い合わせ（税込・税抜など）
   */
  inquiry: { active: number; left: number; topics: number; state: InquiryState }
  /** 工事場所の開いている変更案 */
  location: { open: number }
  /** CSV に載せる件数 */
  exportRows: number
  /** 作業の画面のタブの数（無いタブは 0） */
  badges: { gyoshu: number; inquiry: number; location: number }
}

/**
 * 報告の聞き返し（税込・税抜と、計画の聞き返し）と答えたか。表ができてから聞く。報告・ダウンロードの前の確認・「答える」で同じものを使う。
 * 税は、まだ誰も決めていなければ聞き（計画・職員が決めたら聞かない。答えたものは答えを出す）、金額が決まったか「分からない」と答えたら答えた。
 * 計画の聞き返しは、聞き返しの答えとして記録したもの（exclude・keep）だけを答えと見なす（チャットなどで入れた除外は答えではない）
 */
export function reportQuestionStates(input: {
  hasTable: boolean
  /** 「答える」の載せる工事に答えたか（lib/cases/selection.ts。どの案件でも1回だけ聞く） */
  selectionAnswered: boolean
  tax: TaxMode
  taxBy: TaxBy | null
  reportAnswers: Readonly<Record<string, string>>
  asks: readonly { id: string; key: string }[]
}) {
  if (!input.hasTable) return []
  const { tax, taxBy, reportAnswers } = input
  const out: { id: string; answered: boolean }[] = []
  // 載せる工事は最初に聞く（業種を決める・直すの数が変わる）
  out.push({ id: "selection", answered: input.selectionAnswered })
  if ((tax === "unknown" && taxBy === null) || reportAnswers.tax) out.push({ id: "tax", answered: tax !== "unknown" || reportAnswers.tax === "ask" })
  // 計画の聞き返しの答えは、並び順の id ではなく聞き返しの鍵（lib/convert/plan.ts の askKey）で持つ
  for (const { id, key } of input.asks) out.push({ id, answered: reportAnswers[key] === "exclude" || reportAnswers[key] === "keep" })
  return out
}

export type TodoInput = {
  /** 画面の表の行（手直し・選び直しのあと。表がまだ無ければ空。表に依る数〔業種・直す〕は 0 で、答える・工事場所は変更案と聞き返しだけで数える） */
  shown: readonly RowResult<KojiFieldId>[]
  inclusion: ReadonlyMap<string, Inclusion>
  /** 行の片付けること（status.ts の rowFix。表の行の理由と同じもの） */
  rowFixes: ReadonlyMap<string, RowFix<KojiFieldId>>
  exportRows: number
  proposals: readonly Proposal[]
  contents: ReadonlyMap<string, readonly ChatChange[]>
  /** 業種の AI の案（案件の作業の gyoshuPlans） */
  gyoshuPlans: ReadonlyMap<string, CellEdit>
  /** 報告の聞き返し（reportQuestionStates） */
  questions: readonly { id: string; answered: boolean }[]
  inquiries: readonly Inquiry[]
  dismissed: ReadonlySet<string>
  /** 案件の状態（問い合わせ中なら送った・返事待ち、完了なら問い合わせは済み） */
  status: CaseStatus
}

export function caseTodo(input: TodoInput): CaseTodo {
  const { shown, inclusion, rowFixes, proposals } = input
  const rows = gyoshuItems(shown, inclusion, rowFixes, input.gyoshuPlans)

  const answer: AnswerItem[] = input.questions.filter((q) => !q.answered).map((q) => ({ kind: "question", id: q.id }))
  // チャットの変更案は開いていれば数える（開いている変更案には未決の項目か答えていない聞き返しがある）
  for (const p of proposals)
    if (p.state === "open" && p.origin.kind === "chat") answer.push({ kind: "proposal", proposalId: p.id, waiting: pendingOf(p).length, question: p.question !== null && p.question.answer === null })

  // まだ答えのない問い合わせ（外したもの・回答の変更案で承認を待つセルを除く。完了した案件は無し）。段の数・バッジ・状態はみなこれを使う
  const answering = answeringCells(proposals, input.contents)
  const unanswered =
    input.status === "done" ? [] : input.inquiries.filter((q) => !input.dismissed.has(inquiryKey(q)) && (q.kind === "case" || !answering.has(inquiryKey(q))))
  const left = unanswered.filter((q) => q.kind === "cell").length
  const topics = unanswered.length - left
  const state: InquiryState = unanswered.length === 0 ? "done" : input.status === "inquiring" ? "waiting" : "todo"
  const locationOpen = proposals.filter((p) => p.origin.kind === "location" && p.state === "open").length

  return {
    answer,
    gyoshu: { rows },
    fix: countFixes(shown, inclusion, rowFixes),
    fixActions: fixActionGroups(shown, inclusion, rowFixes),
    inquiry: { active: unanswered.length, left, topics, state },
    location: { open: locationOpen },
    exportRows: input.exportRows,
    badges: { gyoshu: rows.length, inquiry: unanswered.length, location: locationOpen },
  }
}

/** 答えていない報告の聞き返し（載せる工事・税込か税抜か・計画の聞き返し）の数。チャットの報告の1行「聞き返しが N件あります → 答える」 */
export const reportAsks = (todo: CaseTodo) => todo.answer.filter((a) => a.kind === "question").length

/** 変更案が「答える」に数えるものか（チャットの答えを待つ印・「答える」から移る先） */
export const awaitsAnswer = (todo: CaseTodo, proposalId: string) => todo.answer.some((a) => a.kind === "proposal" && a.proposalId === proposalId)

/** タブの数（数を出さないタブは 0） */
export const tabBadge = (todo: CaseTodo, tab: string) => (tab === "gyoshu" || tab === "inquiry" || tab === "location" ? todo.badges[tab] : 0)

/**
 * 業種の AI の案は、業種の一覧に今いる行（gyoshuTodo）にだけ意味がある（一覧に出す・案のまま決める・保存するは、みなこれを通す）。
 * 一覧にいない行の案を落とした作業（落とすものが無ければ同じもの）
 */
export function listedGyoshuPlans<W extends { gyoshuPlans: ReadonlyMap<string, CellEdit> }>(w: W, rows: readonly Pick<GyoshuItem, "key">[]): W {
  const listed = new Set(rows.map((r) => r.key))
  if ([...w.gyoshuPlans.keys()].every((k) => listed.has(k))) return w
  return { ...w, gyoshuPlans: new Map([...w.gyoshuPlans].filter(([k]) => listed.has(k))) }
}

/** 業種を決める行（status.ts の gyoshuTodo）を一覧の行にする。案は業種の AI の案、無ければ今の値（AI の推定・要確認でコード表にある値） */
function gyoshuItems(
  shown: readonly RowResult<KojiFieldId>[],
  inclusion: ReadonlyMap<string, Inclusion>,
  rowFixes: ReadonlyMap<string, RowFix<KojiFieldId>>,
  plans: ReadonlyMap<string, CellEdit>,
): GyoshuItem[] {
  return gyoshuTodo(shown, inclusion, rowFixes)
    .map((r): GyoshuItem => {
      const c = r.cells.gyoshu
      const p = plans.get(r.key)
      const kind = rowFixes.get(r.key)!.gyoshu!
      const plan = p ? { value: p.value, note: p.message ?? "" } : (kind === "guess" || kind === "review") && codeLabel("gyoshu", c.value) ? { value: c.value, note: c.message ?? "" } : null
      return {
        key: r.key,
        workName: r.cells.workName.value,
        amount: /^\d+$/.test(r.cells.amount.value) ? r.cells.amount.value : "",
        included: inclusion.get(r.key)?.included ?? false,
        kind,
        plan,
        values: Object.fromEntries(KOJI_KEIREKI.fields.map((f) => [f.id, r.cells[f.id].value])) as Record<KojiFieldId, string>,
      }
    })
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
}
