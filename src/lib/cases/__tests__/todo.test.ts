import { describe, expect, test } from "vitest"
import type { RowFix } from "@/components/convert/status"
import { kojiRow } from "@/lib/convert/__tests__/helpers"
import type { Inclusion } from "@/lib/convert/koji-selection"
import { answer, decide, discard, newProposal, type ChatChange, type Proposal, type ProposalOrigin } from "@/lib/chat/proposals"
import { inquiryKey, type Inquiry } from "@/lib/inquiry/inquiry"
import type { KojiFieldId } from "@/lib/spec/koji-keireki"
import { awaitsAnswer, caseTodo, reportQuestionStates, tabBadge, type TodoInput } from "../todo"

// 4行: r0・r1 は業種が空（r0 は載せる、r1 は7割の選び直しで載りうる）、r2 は業種を職員が決めた（一覧の外）、r3 は工事名がエラーで載せる
const shown = [0, 1, 2, 3].map((i) => kojiRow({ workName: `工事${i}`, amount: String((i + 1) * 100) }, i))
const [r0, r1, r2, r3] = shown.map((r) => r.key) as [string, string, string, string]
const inclusion: ReadonlyMap<string, Inclusion> = new Map<string, Inclusion>([
  [r0, { included: true, reason: "rule7" }],
  [r1, { included: false, reason: "unselected" }],
  [r2, { included: true, reason: "rule7" }],
  [r3, { included: true, reason: "rule7" }],
])
const none: RowFix<KojiFieldId> = { fixes: [], ask: [] }
const rowFixes: ReadonlyMap<string, RowFix<KojiFieldId>> = new Map([
  [r0, { ...none, gyoshu: "empty" as const }],
  [r1, { ...none, gyoshu: "empty" as const }],
  [r2, none],
  [r3, { fixes: [{ field: "workName" as const, kind: "error" as const }], ask: [] }],
])

const gyoshuChange = (rowKey: string, value: string): ChatChange => ({ kind: "cell", rowKey, field: "gyoshu", edit: { value, by: "chat", guessed: true, message: "工事名から" } })
const cellChange = (rowKey: string): ChatChange => ({ kind: "cell", rowKey, field: "workName", edit: { value: "直した", by: "chat" } })
const proposal = (id: string, origin: ProposalOrigin, changes: ChatChange[], question: string | null = null) => ({ p: newProposal(id, origin, changes, question), changes })

function input(proposals: { p: Proposal; changes: ChatChange[] }[], over: Partial<TodoInput> = {}): TodoInput {
  return {
    shown,
    inclusion,
    rowFixes,
    exportRows: 3,
    proposals: proposals.map((x) => x.p),
    contents: new Map(proposals.map((x) => [x.p.id, x.changes])),
    questions: [],
    inquiries: [],
    dismissed: new Set(),
    answersRead: false,
    inquirySent: false,
    ...over,
  }
}

describe("業種の AI の案（fix）", () => {
  test("一覧の行の未決は業種を決める（行ごと）に数え、答えるには数えない。一覧の「案」は変更案の値", () => {
    const fix = proposal("f1", { kind: "fix", runId: "x", field: "gyoshu" }, [gyoshuChange(r0, "01"), gyoshuChange(r1, "02")])
    const todo = caseTodo(input([fix]))
    expect(todo.answer).toEqual([])
    expect(todo.gyoshu.rows.map((r) => r.key)).toEqual([r1, r0]) // 金額の大きい順
    expect(todo.gyoshu.rows.find((r) => r.key === r0)!.plan).toEqual({ value: "01", note: "工事名から" })
    expect(todo.gyoshu.pending.size).toBe(2)
    expect(todo.badges.gyoshu).toBe(2)
    expect(awaitsAnswer(todo, "f1")).toBe(false)
  })
  test("一覧の外の行に未決があれば、その変更案を答えるに1件（承認待ちは一覧の外の項目の数）", () => {
    const fix = proposal("f1", { kind: "fix", runId: "x", field: "gyoshu" }, [gyoshuChange(r0, "01"), gyoshuChange(r2, "02"), gyoshuChange(r3, "03")])
    const todo = caseTodo(input([fix]))
    expect(todo.answer).toEqual([{ kind: "proposal", proposalId: "f1", origin: "fix", waiting: 2, question: false }])
    expect(awaitsAnswer(todo, "f1")).toBe(true)
    // 一覧の外の項目を決めると答えるから外れる
    const decided = caseTodo(input([{ ...fix, p: decide(fix.p, [1, 2], "rejected") }]))
    expect(decided.answer).toEqual([])
    expect(decided.gyoshu.rows.length).toBe(2)
  })
})

describe("答える", () => {
  test("報告の聞き返し（答えていないもの）→ chat・excel・answer の開いた変更案の順。location・閉じたものは数えない", () => {
    const chat = proposal("c1", { kind: "chat", messageId: "m" }, [cellChange(r3)], "これでよいですか")
    const excel = proposal("e1", { kind: "excel", fileId: "f" }, [cellChange(r3), cellChange(r0)])
    const closed = proposal("a1", { kind: "answer", fileId: "f" }, [cellChange(r3)])
    const location = proposal("l1", { kind: "location", runId: "r" }, [cellChange(r3)])
    const todo = caseTodo(
      input([chat, excel, { ...closed, p: discard(closed.p) }, location], {
        questions: [
          { id: "tax", answered: false },
          { id: "plan-ask-0", answered: true },
        ],
      }),
    )
    expect(todo.answer).toEqual([
      { kind: "question", id: "tax" },
      { kind: "proposal", proposalId: "c1", origin: "chat", waiting: 1, question: true },
      { kind: "proposal", proposalId: "e1", origin: "excel", waiting: 2, question: false },
    ])
    expect(todo.location.open).toBe(1)
    expect(todo.badges.location).toBe(1)
    expect(awaitsAnswer(todo, "l1")).toBe(false)
    expect(awaitsAnswer(todo, "a1")).toBe(false)
    // 聞き返しに「はい」と答えても、承認するまでは答えるに残る
    const yes = caseTodo(input([{ ...chat, p: answer(chat.p, "yes") }]))
    expect(yes.answer).toEqual([{ kind: "proposal", proposalId: "c1", origin: "chat", waiting: 1, question: false }])
  })
  test("変更案の無い聞き返し（中身が空の変更案）も、答えるまでは1件", () => {
    const ask = proposal("c2", { kind: "chat", messageId: "m" }, [], "どちらですか")
    expect(caseTodo(input([ask])).answer).toEqual([{ kind: "proposal", proposalId: "c2", origin: "chat", waiting: 0, question: true }])
  })
})

describe("直す・問い合わせ・タブの数", () => {
  test("直すは載せる行のうち職員が直すセルがある行（業種の未決は数えない）", () => {
    const todo = caseTodo(input([]))
    expect(todo.fix.rows).toBe(1)
    expect(todo.fix.byKind.error).toBe(1)
    expect(todo.exportRows).toBe(3)
  })
  test("外した問い合わせは数えない（タブの数も次にやることと同じ）。left はセルの問い合わせだけ", () => {
    const inquiries: Inquiry[] = [
      { kind: "case", topic: "tax" },
      { kind: "cell", rowKey: r0, field: "client", reason: "missing", current: "" },
      { kind: "cell", rowKey: r3, field: "workName", reason: "missing", current: "" },
    ]
    const todo = caseTodo(input([], { inquiries, dismissed: new Set([inquiryKey(inquiries[2]!)]) }))
    expect(todo.inquiry).toEqual({ active: 2, left: 1, state: "todo" })
    expect(tabBadge(todo, "inquiry")).toBe(2)
    expect(tabBadge(todo, "table")).toBe(0)
    expect(caseTodo(input([], { inquiries, inquirySent: true })).inquiry.state).toBe("waiting")
    // 返ってきた Excel を読んでも、顧客の回答の変更案を決め終えるまでは済みにしない
    const ans = proposal("a1", { kind: "answer", fileId: "f" }, [cellChange(r3)])
    expect(caseTodo(input([ans], { inquiries, inquirySent: true, answersRead: true })).inquiry.state).toBe("waiting")
    expect(caseTodo(input([{ ...ans, p: discard(ans.p) }], { inquiries, answersRead: true })).inquiry.state).toBe("done")
    expect(caseTodo(input([], { inquiries, dismissed: new Set(inquiries.map(inquiryKey)) })).inquiry).toEqual({ active: 0, left: 0, state: "done" })
  })
})

test("表がまだ無くても、答える（変更案）とチャットの答えを待つ印は数える。表に依る数は 0", () => {
  const chat = proposal("c1", { kind: "chat", messageId: "m" }, [cellChange(r3)])
  const fix = proposal("f1", { kind: "fix", runId: "x", field: "gyoshu" }, [gyoshuChange(r0, "01")])
  const todo = caseTodo(input([chat, fix], { shown: [], inclusion: new Map(), rowFixes: new Map(), exportRows: 0 }))
  expect(todo.answer.map((a) => a.kind === "proposal" && a.proposalId)).toEqual(["c1", "f1"])
  expect(awaitsAnswer(todo, "c1")).toBe(true)
  expect(todo.fix.rows).toBe(0)
  expect(todo.gyoshu.rows).toEqual([])
})

test("報告の聞き返し: 表ができてから。税は誰も決めていなければ聞き、決まるか「分からない」で答えた。計画の聞き返しは exclude・keep だけを答えと見なす", () => {
  const base = { hasTable: true, tax: "unknown" as const, taxBy: null, reportAnswers: {}, asks: [{ id: "plan-ask-0", key: "ask:doubtful:1:k" }] }
  expect(reportQuestionStates({ ...base, hasTable: false })).toEqual([])
  expect(reportQuestionStates(base)).toEqual([
    { id: "tax", answered: false },
    { id: "plan-ask-0", answered: false },
  ])
  // 計画が決めた税は聞かない
  expect(reportQuestionStates({ ...base, tax: "included", taxBy: "plan" }).map((q) => q.id)).toEqual(["plan-ask-0"])
  expect(reportQuestionStates({ ...base, tax: "excluded", taxBy: "staff", reportAnswers: { tax: "excluded", "ask:doubtful:1:k": "keep" } })).toEqual([
    { id: "tax", answered: true },
    { id: "plan-ask-0", answered: true },
  ])
  expect(reportQuestionStates({ ...base, taxBy: "staff", reportAnswers: { tax: "ask", "ask:doubtful:1:k": "other" } })).toEqual([
    { id: "tax", answered: true },
    { id: "plan-ask-0", answered: false },
  ])
})
