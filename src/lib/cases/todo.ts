import { countFixes, fixActionGroups, gyoshuTodo, type FixActionGroup, type FixCounts, type FixKind, type RowFix } from "@/components/convert/status"
import type { RowResult, CellEdit } from "@/lib/convert/convert"
import type { Inclusion, TaxMode } from "@/lib/convert/koji-selection"
import type { TaxBy } from "@/lib/cases/tax"
import { decisionOf, pendingOf, type ChatChange, type Proposal, type ProposalOrigin } from "@/lib/chat/proposals"
import { inquiryKey, type Inquiry } from "@/lib/inquiry/inquiry"
import { codeLabel } from "@/lib/spec/code-sets"
import { KOJI_KEIREKI, type KojiFieldId } from "@/lib/spec/koji-keireki"

/**
 * 案件の残りの件数（次にやること・ダウンロードの前の確認・表の「直す」・業種のタブ・タブの数・チャットの答えを待つ印）を1か所で数える。
 * 画面の各所はこの結果を読むだけにする（同じものを別々の式で数えて食い違わない）。
 *
 * 変更案をどこに数えるかの決まり（出どころごと）:
 * | 出どころ | 答える | 業種を決める | 工事場所のタブ |
 * | chat・excel・answer | 開いていれば1件 | — | — |
 * | fix（業種の AI の案） | 一覧の外の行に未決があれば1件 | 一覧の行の未決は行ごと | — |
 * | location | 数えない | — | 開いていれば1件 |
 */

/** 業種の AI の案（出どころ fix）の開いている変更案の、未決の業種の項目（行 → 変更案と項目の番号・案） */
export type PendingGyoshu = { proposalId: string; index: number; rowKey: string; edit: CellEdit }

export function pendingGyoshuItems(proposals: readonly Proposal[], contents: ReadonlyMap<string, readonly ChatChange[]>): Map<string, PendingGyoshu> {
  const out = new Map<string, PendingGyoshu>()
  for (const p of proposals) {
    if (p.origin.kind !== "fix" || p.state !== "open") continue
    contents.get(p.id)?.forEach((c, i) => {
      if (c.kind === "cell" && c.field === "gyoshu" && decisionOf(p, i) === "pending") out.set(c.rowKey, { proposalId: p.id, index: i, rowKey: c.rowKey, edit: c.edit })
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
 * 「答える」の1件。question は報告の聞き返し（税・計画の聞き返し）、proposal は答えを待つ変更案
 * （waiting は承認待ちの項目の数。業種の AI の案は一覧の外の行の分だけ。question は聞き返しにまだ答えていないか）
 */
export type AnswerItem =
  | { kind: "question"; id: string }
  | { kind: "proposal"; proposalId: string; origin: ProposalOrigin["kind"]; waiting: number; question: boolean }

/** 問い合わせの段: todo まだ送っていない、waiting 送った・返事待ち、done 済み（聞くことが無い・返事を取り込んで決め終えた） */
export type InquiryState = "todo" | "waiting" | "done"

export type CaseTodo = {
  /** 答えるもの（並びは報告の聞き返し → 変更案）。数は answer.length */
  answer: AnswerItem[]
  /** 業種を決める行（金額の大きい順）と、業種の AI の案の未決の項目 */
  gyoshu: { rows: GyoshuItem[]; pending: ReadonlyMap<string, PendingGyoshu> }
  /** 直す行（表の「直す」と同じ数） */
  fix: FixCounts
  /** 直す行のうち、まとめて頼める直し方 */
  fixActions: FixActionGroup[]
  /** 問い合わせ。active は外していない問い合わせ（セル・案件全体）、left は外していないセルの問い合わせ */
  inquiry: { active: number; left: number; state: InquiryState }
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
export function reportQuestionStates(input: { hasTable: boolean; tax: TaxMode; taxBy: TaxBy | null; reportAnswers: Readonly<Record<string, string>>; askIds: readonly string[] }) {
  if (!input.hasTable) return []
  const { tax, taxBy, reportAnswers } = input
  const out: { id: string; answered: boolean }[] = []
  if ((tax === "unknown" && taxBy === null) || reportAnswers.tax) out.push({ id: "tax", answered: tax !== "unknown" || reportAnswers.tax === "ask" })
  for (const id of input.askIds) out.push({ id, answered: reportAnswers[id] === "exclude" || reportAnswers[id] === "keep" })
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
  /** 報告の聞き返し（reportQuestionStates） */
  questions: readonly { id: string; answered: boolean }[]
  inquiries: readonly Inquiry[]
  dismissed: ReadonlySet<string>
  /** 返ってきた Excel を読んだか（作業の answers） */
  answersRead: boolean
  /** 問い合わせを送ったか（案件が問い合わせ中・問い合わせの Excel かメールの下書きを出した） */
  inquirySent: boolean
}

export function caseTodo(input: TodoInput): CaseTodo {
  const { shown, inclusion, rowFixes, proposals } = input
  const pending = pendingGyoshuItems(proposals, input.contents)
  const rows = gyoshuItems(shown, inclusion, rowFixes, pending)
  const inList = new Set(rows.map((r) => r.key))
  /** 業種の AI の案の変更案ごとの、一覧の外の行の未決の項目の数（一覧の行は一覧の「案」で決める） */
  const outside = new Map<string, number>()
  for (const x of pending.values()) if (!inList.has(x.rowKey)) outside.set(x.proposalId, (outside.get(x.proposalId) ?? 0) + 1)

  const answer: AnswerItem[] = input.questions.filter((q) => !q.answered).map((q) => ({ kind: "question", id: q.id }))
  for (const p of proposals) {
    if (p.state !== "open") continue
    const kind = p.origin.kind
    const waiting = kind === "chat" || kind === "excel" || kind === "answer" ? pendingOf(p).length : kind === "fix" ? (outside.get(p.id) ?? 0) : 0
    const question = p.question !== null && p.question.answer === null
    // chat・excel・answer は開いていれば数える（開いている変更案には未決の項目か答えていない聞き返しがある）。fix は一覧の外の行に未決があるときだけ
    if (kind === "chat" || kind === "excel" || kind === "answer" || (kind === "fix" && waiting > 0)) answer.push({ kind: "proposal", proposalId: p.id, origin: kind, waiting, question })
  }

  const active = input.inquiries.filter((q) => !input.dismissed.has(inquiryKey(q)))
  const left = active.filter((q) => q.kind === "cell").length
  const answersOpen = proposals.some((p) => p.origin.kind === "answer" && p.state === "open")
  const state: InquiryState = active.length === 0 || (input.answersRead && !answersOpen) ? "done" : input.inquirySent ? "waiting" : "todo"
  const locationOpen = proposals.filter((p) => p.origin.kind === "location" && p.state === "open").length

  return {
    answer,
    gyoshu: { rows, pending },
    fix: countFixes(shown, inclusion, rowFixes),
    fixActions: fixActionGroups(shown, inclusion, rowFixes),
    inquiry: { active: active.length, left, state },
    location: { open: locationOpen },
    exportRows: input.exportRows,
    badges: { gyoshu: rows.length, inquiry: active.length, location: locationOpen },
  }
}

/** 変更案が「答える」に数えるものか（チャットの答えを待つ印・「答える」から移る先） */
export const awaitsAnswer = (todo: CaseTodo, proposalId: string) => todo.answer.some((a) => a.kind === "proposal" && a.proposalId === proposalId)

/** タブの数（数を出さないタブは 0） */
export const tabBadge = (todo: CaseTodo, tab: string) => (tab === "gyoshu" || tab === "inquiry" || tab === "location" ? todo.badges[tab] : 0)

/** 業種を決める行（status.ts の gyoshuTodo）を一覧の行にする。案は AI の案の未決の項目、無ければ今の値（AI の推定・要確認でコード表にある値） */
function gyoshuItems(
  shown: readonly RowResult<KojiFieldId>[],
  inclusion: ReadonlyMap<string, Inclusion>,
  rowFixes: ReadonlyMap<string, RowFix<KojiFieldId>>,
  pending: ReadonlyMap<string, PendingGyoshu>,
): GyoshuItem[] {
  return gyoshuTodo(shown, inclusion, rowFixes)
    .map((r): GyoshuItem => {
      const c = r.cells.gyoshu
      const p = pending.get(r.key)
      const kind = rowFixes.get(r.key)!.gyoshu!
      const plan = p ? { value: p.edit.value, note: p.edit.message ?? "" } : (kind === "guess" || kind === "review") && codeLabel("gyoshu", c.value) ? { value: c.value, note: c.message ?? "" } : null
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
