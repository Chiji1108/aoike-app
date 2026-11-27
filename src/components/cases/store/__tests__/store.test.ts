import { describe, expect, test } from "vitest"
import { newWork, savedWorkSchema, toSavedAiCache, toSavedWork, type CaseWork } from "@/lib/cases/state"
import { GYOSHU_UNDO, UNDO_LIMITS } from "@/lib/cases/undo"
import { approvedChatProposals } from "@/lib/chat/carryover"
import { applyChanges, closeUnrecorded, decide, newProposal, type ChatChange, type ProposalRecord } from "@/lib/chat/proposals"
import { reviewTurnsFromUi } from "@/lib/chat/review"
import type { ChatMessage } from "@/lib/chat/messages"
import { commit, receiveProposal, undoGroup } from "../actions/proposals"
import { createCaseStore, initialCaseState, setWork, type CaseStore } from "../create-case-store"
import { derive } from "../derive"

const change: ChatChange = { kind: "inquiryMail", subject: "確認のお願い", intro: "" }
const store = () => createCaseStore(initialCaseState({ kase: { status: "converting", costUsd: 0 }, files: [], previousUnsaved: false, state: null, proposals: [], unreadableProposals: [], closedMissing: 0, settings: { rule7Tax: "excluded" } }))

describe("案件のストア", () => {
  test("載せる工事は、新しい案件にだけ去年の案件で決めた選び方を引き継ぐ（無ければ7割ルール）。保存した作業は開いただけでは変えない", () => {
    const base = { kase: { status: "converting" as const, costUsd: 0 }, files: [], previousUnsaved: false, proposals: [], unreadableProposals: [], closedMissing: 0, settings: { rule7Tax: "excluded" as const } }
    expect(initialCaseState({ ...base, state: null, previous: { selection: "all" } }).work).toMatchObject({ selection: "all", selectionBy: "previous" })
    expect(initialCaseState({ ...base, state: null, previous: { selection: null } }).work.selection).toBe("rule7")
    expect(initialCaseState({ ...base, state: null }).work.selection).toBe("rule7")
    // 前に保存した今年の作業は、まだ誰も決めていなくても変えない（「答える」で聞き、去年の値をおすすめにする）。職員が決めた値も変えない
    const saved = (by: "staff" | null) => ({ work: toSavedWork({ ...newWork("f"), converted: true, selection: "rule7", selectionBy: by }), aiCache: [] })
    expect(initialCaseState({ ...base, state: saved(null), previous: { selection: "all" } }).work).toMatchObject({ selection: "rule7", selectionBy: null })
    expect(initialCaseState({ ...base, state: saved("staff"), previous: { selection: "all" } }).work).toMatchObject({ selection: "rule7", selectionBy: "staff" })
  })

  test("変更案は中身と一緒に1回で入り、派生は同じ状態なら同じ参照を返す", () => {
    const s = store()
    const p = newProposal("p1", { kind: "excel", fileId: "f" }, [change], null)
    receiveProposal(s, { proposal: p, changes: [change] }, "replace")
    const d = derive(s.getState())
    expect(s.getState().contents.get("p1")).toEqual([change])
    expect(d.panels.excel.map((x) => x.id)).toEqual(["p1"])
    expect(d.pendingInquiryText).toBe(true)
    expect(derive(s.getState())).toBe(d)
    // 変更案と関係ない作業の変更では作り直さない。変更案が変われば作り直す
    setWork(s, (w) => ({ ...w, rounding: "round" }))
    expect(derive(s.getState())).toBe(d)
    setWork(s, (w) => ({ ...w, proposals: w.proposals.map((x) => decide(x, [0], "rejected")) }))
    const after = derive(s.getState())
    expect(after).not.toBe(d)
    expect(after.pendingInquiryText).toBe(false)
    expect(after.panels.excel).toEqual([])
  })
  test("サーバーが記録した変更案のうち作業に無いものは、中身と一緒に作業に入れる", () => {
    const p = newProposal("p1", { kind: "chat", messageId: "m" }, [change], null)
    const init = initialCaseState({ kase: { status: "converting", costUsd: 0 }, files: [], previousUnsaved: false, state: null, proposals: [{ proposal: p, changes: [change] }], unreadableProposals: [], closedMissing: 0, settings: { rule7Tax: "included" } })
    expect(init.work.proposals).toEqual([p])
    expect(init.work.rule7Tax).toBe("included")
    expect(init.contents.get("p1")).toEqual([change])
  })
})

test("派生の memo はストアごとに取り合わない（2つのストアを交互に読んでも同じ参照）", () => {
  const a = store()
  const b = store()
  const p = newProposal("p1", { kind: "excel", fileId: "f" }, [change], null)
  receiveProposal(a, { proposal: p, changes: [change] }, "replace")
  const da = derive(a.getState())
  const db = derive(b.getState())
  expect(derive(a.getState())).toBe(da)
  expect(derive(b.getState())).toBe(db)
  expect(da.panels.excel.length).toBe(1)
  expect(db.panels.excel.length).toBe(0)
})

const cell = (rowKey: string, value: string): ChatChange => ({ kind: "cell", rowKey, field: "workName", edit: { value, by: "chat" } })
const chatRecord = (id: string, changes: ChatChange[]): ProposalRecord => ({ proposal: newProposal(id, { kind: "chat", messageId: `m-${id}` }, changes, null), changes })
/** 保存して開き直す（作業の JSON を通し、サーバーが読めた変更案の記録を渡す） */
const reopen = (s: CaseStore, records: ProposalRecord[] = [], unreadable: string[] = []) => {
  const w = s.getState().work
  const work = savedWorkSchema.parse(JSON.parse(JSON.stringify(toSavedWork(w))))
  return createCaseStore(initialCaseState({ kase: { status: "converting", costUsd: 0 }, files: [], previousUnsaved: false, state: { work, aiCache: toSavedAiCache(w.aiCache) }, proposals: records, unreadableProposals: unreadable, closedMissing: 0, settings: { rule7Tax: "excluded" } }))
}
/** 画面の承認と同じく、表に重ねる部分を承認の記録にして入れる */
const approve = (s: CaseStore, id: string, items: number[]) =>
  commit(s, { group: id, kind: "approval", items }, ({ work: w, contents }) => ({
    ...applyChanges(w, [], items.map((i) => contents.get(id)![i]!)),
    proposals: w.proposals.map((p) => (p.id === id ? decide(p, items, "applied") : p)),
  }))
/** 業種の一覧で決めるのと同じ操作の記録 */
const op = (s: CaseStore, i: number) => commit(s, { group: `${GYOSHU_UNDO}${i}`, kind: "op" }, ({ work: w }) => ({ ...w, manual: new Map(w.manual).set(`op${i}`, i % 2 === 0) }))

describe("変更案を足す（receiveProposal）", () => {
  test("ifUnknown は作業にもうある変更案を置き換えない（決め終わったものを開き直さない）。replace は置き換えて最後に回す", () => {
    const s = store()
    const a = chatRecord("a", [change])
    receiveProposal(s, a, "replace")
    receiveProposal(s, chatRecord("b", [change]), "replace")
    setWork(s, (w) => ({ ...w, proposals: w.proposals.map((p) => (p.id === "a" ? decide(p, [0], "rejected") : p)) }))
    receiveProposal(s, a, "ifUnknown")
    expect(s.getState().work.proposals.map((p) => [p.id, p.state])).toEqual([
      ["a", "closed"],
      ["b", "open"],
    ])
    receiveProposal(s, a, "replace")
    expect(s.getState().work.proposals.map((p) => [p.id, p.state])).toEqual([
      ["b", "open"],
      ["a", "open"],
    ])
  })
})

describe("開いたときの中身の無い変更案", () => {
  test("記録の無い開いた変更案は閉じて数える（記録がある・読めないものは閉じない）。閉じた形を保存すれば次は閉じたまま", () => {
    const s = store()
    receiveProposal(s, chatRecord("lost", [cell("r1", "x"), cell("r2", "y")]), "replace")
    receiveProposal(s, chatRecord("kept", [change]), "replace")
    receiveProposal(s, chatRecord("broken", [change]), "replace")
    approve(s, "lost", [0])
    const closed = closeUnrecorded(s.getState().work.proposals, new Set(["kept", "broken"]))
    expect(closed.closed).toBe(1)
    expect(closed.proposals.map((p) => [p.id, p.state])).toEqual([
      ["lost", "closed"],
      ["kept", "open"],
      ["broken", "open"],
    ])
    expect(closed.proposals[0]).toMatchObject({ applied: 1, rejected: 1 })
    expect(closeUnrecorded(closed.proposals, new Set(["kept", "broken"])).closed).toBe(0)
  })

  test("サーバーが閉じた数と読めない記録（作業に無いものも）を報告のために数える", () => {
    const r = createCaseStore(initialCaseState({ kase: { status: "converting", costUsd: 0 }, files: [], previousUnsaved: false, state: null, proposals: [], unreadableProposals: ["in-work", "only-in-r2"], closedMissing: 2, settings: { rule7Tax: "excluded" } }))
    expect(r.getState().runtime).toMatchObject({ closedMissing: 2, unreadable: 2 })
  })

  test("閉じた変更案の承認は、中身が無くても記録から取り消せる", () => {
    const s = store()
    receiveProposal(s, chatRecord("lost", [cell("r1", "x"), cell("r2", "y")]), "replace")
    approve(s, "lost", [0])
    setWork(s, (w) => ({ ...w, proposals: closeUnrecorded(w.proposals, new Set()).proposals }))
    const again = reopen(s)
    expect(derive(again.getState()).undoStates.get("lost")?.can).toBe(true)
    expect(undoGroup(again, "lost")).toMatchObject({ reverted: 1, kept: 0 })
  })
})

describe("取り消し（commit・undoGroup）", () => {
  test("積むのは commit の1か所。変わったときだけ記録を積み、枠（kind）を記録に書く", () => {
    const s = store()
    receiveProposal(s, chatRecord("p", [cell("r1", "x")]), "replace")
    expect(approve(s, "p", [0])).toBe("undoable")
    expect(op(s, 0)).toBe("undoable")
    expect(commit(s, { group: `${GYOSHU_UNDO}none`, kind: "op" }, ({ work: w }) => w)).toBe("none")
    expect(s.getState().work.undo.map((e) => [e.proposalId, e.kind, e.items])).toEqual([
      ["p", "approval", [0]],
      [`${GYOSHU_UNDO}0`, "op", []],
    ])
    // 承認の記録に残した項目は変更案にも書く
    expect(s.getState().work.proposals[0]!.logged).toEqual([0])
  })

  test("記録が大きすぎて取り消せない変更は tooLarge を返す", () => {
    const s = store()
    const huge = commit(s, { group: `${GYOSHU_UNDO}huge`, kind: "op" }, ({ work: w }) => ({
      ...w,
      edits: new Map(Array.from({ length: 3000 }, (_, i) => [`r${i}:workName`, { value: "あ".repeat(80), by: "staff" as const }])),
    }))
    expect(huge).toBe("tooLarge")
    expect(derive(s.getState()).undoStates.get(`${GYOSHU_UNDO}huge`)).toMatchObject({ can: false, tooLarge: true })
    expect(undoGroup(s, `${GYOSHU_UNDO}huge`)).toBeNull()
  })

  test("logged の無い前の変更案は、取り消すときに記録の項目から logged を書く（そのあと記録が捨てられても取り消したまま）", () => {
    const s = store()
    receiveProposal(s, chatRecord("old", [cell("r1", "x"), cell("r2", "y")]), "replace")
    approve(s, "old", [0])
    approve(s, "old", [1])
    // この PR の前の形: 変更案に logged が無く、記録に kind が無い
    setWork(s, (w) => ({ ...w, proposals: w.proposals.map(({ logged: _l, ...p }) => p), undo: w.undo.map(({ kind: _k, ...e }) => e) }))
    expect(s.getState().work.proposals[0]!.logged).toBeUndefined()
    undoGroup(s, "old")
    expect(s.getState().work.proposals[0]).toMatchObject({ logged: [0, 1], undone: [0, 1] })
    expect([...approvedChatProposals(s.getState().work.proposals, [])]).toEqual([])
    // 項目の分からない記録があれば書かず、記録で見る
    const t = store()
    receiveProposal(t, chatRecord("older", [cell("r1", "x")]), "replace")
    approve(t, "older", [0])
    setWork(t, (w) => ({ ...w, proposals: w.proposals.map(({ logged: _l, ...p }) => p), undo: w.undo.map(({ kind: _k, items: _i, ...e }) => e) }))
    undoGroup(t, "older")
    expect(t.getState().work.proposals[0]!.logged).toBeUndefined()
    expect([...approvedChatProposals(t.getState().work.proposals, t.getState().work.undo)]).toEqual([])
  })

  test("表を変えなかった承認の項目は記録に残らず、記録に残した項目をすべて取り消せば去年のやり方に添えない", () => {
    const s = store()
    // 項目 1 は今の値と同じ include（表は変わらない）
    receiveProposal(s, chatRecord("p", [cell("r1", "x"), { kind: "include", rowKey: "r2", include: true }]), "replace")
    setWork(s, (w) => ({ ...w, manual: new Map([["r2", true]]) }))
    approve(s, "p", [0])
    expect(approve(s, "p", [1])).toBe("none")
    expect(s.getState().work.proposals[0]).toMatchObject({ state: "closed", applied: 2, logged: [0] })
    expect([...approvedChatProposals(s.getState().work.proposals, s.getState().work.undo)]).toEqual(["p"])
    undoGroup(s, "p")
    expect([...approvedChatProposals(s.getState().work.proposals, s.getState().work.undo)]).toEqual([])
    // 記録が捨てられても同じ
    expect([...approvedChatProposals(reopen(s).getState().work.proposals, [])]).toEqual([])
  })

  test("承認 → 業種の一覧で50回決める → 承認を取り消せる（操作が承認の記録を押し出さない）", () => {
    const s = store()
    receiveProposal(s, chatRecord("p", [cell("r1", "承認した値")]), "replace")
    approve(s, "p", [0])
    for (let i = 0; i < 50; i++) op(s, i)
    expect(s.getState().work.undo.filter((e) => e.kind === "op")).toHaveLength(UNDO_LIMITS.op.entries)
    expect(derive(s.getState()).undoStates.get("p")?.can).toBe(true)
    expect(undoGroup(s, "p")).toEqual({ reverted: 1, kept: 0, planChanged: false })
    expect(s.getState().work.edits.has("r1:workName")).toBe(false)
    // 変更案は開き直さず、取り消した項目を書く
    expect(s.getState().work.proposals[0]).toMatchObject({ state: "closed", applied: 1, undone: [0] })
    expect(derive(s.getState()).undoStates.get("p")).toMatchObject({ can: false, undone: true })
    expect(undoGroup(s, "p")).toBeNull()
  })

  test("承認を取り消した事実は記録が上限で捨てられても残り、振り返り・去年のやり方の数え方が変わらない", () => {
    const s = store()
    receiveProposal(s, chatRecord("p", [cell("r1", "a"), cell("r2", "b")]), "replace")
    approve(s, "p", [0])
    approve(s, "p", [1])
    // 変更案の承認の記録（2件）をまとめて取り消す
    undoGroup(s, "p")
    const ui: ChatMessage[] = [
      { id: "u", role: "user", parts: [{ type: "text", text: "直して" }] },
      { id: "a", role: "assistant", parts: [{ type: "data-proposal", data: { id: "p" } }] },
    ]
    const count = (w: CaseWork) => ({ review: reviewTurnsFromUi(ui, w.proposals, w.undo)[0]!.proposal, carryover: [...approvedChatProposals(w.proposals, w.undo)] })
    const before = count(s.getState().work)
    expect(before).toEqual({ review: { applied: 2, undone: 2, undoneUnknown: false, count: 2, open: false }, carryover: [] })
    // ほかの承認で承認の枠が溢れ、p の記録が捨てられる
    for (let i = 0; i < UNDO_LIMITS.approval.entries; i++) {
      receiveProposal(s, chatRecord(`q${i}`, [cell(`q${i}`, "v")]), "replace")
      approve(s, `q${i}`, [0])
    }
    expect(s.getState().work.undo.some((e) => e.proposalId === "p")).toBe(false)
    const after = reopen(s).getState().work
    expect(count({ ...after, proposals: after.proposals.filter((p) => p.id === "p") })).toEqual(before)
  })

  test("2つのタブ: 片方で承認して保存し、もう片方が開き直して取り消すと、取り消した事実も保存に入る", () => {
    const a = store()
    receiveProposal(a, chatRecord("p", [cell("r1", "x")]), "replace")
    approve(a, "p", [0])
    const b = reopen(a)
    expect(derive(b.getState()).undoStates.get("p")?.can).toBe(true)
    expect(undoGroup(b, "p")).toMatchObject({ reverted: 1 })
    const a2 = reopen(b)
    expect(a2.getState().work.proposals[0]!.undone).toEqual([0])
    expect(a2.getState().work.edits.has("r1:workName")).toBe(false)
    expect(derive(a2.getState()).undoStates.get("p")).toMatchObject({ can: false, undone: true })
  })
})
