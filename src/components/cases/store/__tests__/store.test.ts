import { describe, expect, test } from "vitest"
import { savedWorkSchema, toSavedAiCache, toSavedWork, type CaseWork } from "@/lib/cases/state"
import { GYOSHU_UNDO, UNDO_LIMITS } from "@/lib/cases/undo"
import { approvedChatProposals } from "@/lib/chat/carryover"
import { applyChanges, decide, newProposal, type ChatChange, type ProposalRecord } from "@/lib/chat/proposals"
import { reviewTurnsFromUi } from "@/lib/chat/review"
import type { ChatMessage } from "@/lib/chat/messages"
import { commit, receiveProposal, undoGroup } from "../actions/proposals"
import { createCaseStore, initialCaseState, setWork, type CaseStore } from "../create-case-store"
import { derive } from "../derive"

const change: ChatChange = { kind: "inquiryMail", subject: "確認のお願い", intro: "" }
const store = () => createCaseStore(initialCaseState({ state: null, proposals: [], settings: { rule7Tax: "excluded" } }))

describe("案件のストア", () => {
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
    const init = initialCaseState({ state: null, proposals: [{ proposal: p, changes: [change] }], settings: { rule7Tax: "included" } })
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
const reopen = (s: CaseStore, records: ProposalRecord[] = []) => {
  const w = s.getState().work
  const work = savedWorkSchema.parse(JSON.parse(JSON.stringify(toSavedWork(w))))
  return createCaseStore(initialCaseState({ state: { work, aiCache: toSavedAiCache(w.aiCache) }, proposals: records, settings: { rule7Tax: "excluded" } }))
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

describe("開いたときの中身の無い変更案（reconcile）", () => {
  test("開いているのに中身を読めなかった変更案は閉じて数え、保存して開き直しても開いた案に戻らない", () => {
    const s = store()
    receiveProposal(s, chatRecord("lost", [cell("r1", "x"), cell("r2", "y")]), "replace")
    const kept = chatRecord("kept", [change])
    receiveProposal(s, kept, "replace")
    approve(s, "lost", [0])
    // R2 の記録が lost だけ読めなかった
    const r = reopen(s, [kept])
    expect(r.getState().runtime.closedUnreadable).toBe(1)
    const lost = r.getState().work.proposals.find((p) => p.id === "lost")!
    expect(lost).toMatchObject({ state: "closed", applied: 1, rejected: 1 })
    expect(r.getState().work.proposals.find((p) => p.id === "kept")!.state).toBe("open")
    // 閉じた形が保存に入るので、次に開いたときは閉じたまま（数えない）
    const again = reopen(r, [kept])
    expect(again.getState().runtime.closedUnreadable).toBe(0)
    expect(again.getState().work.proposals.find((p) => p.id === "lost")!.state).toBe("closed")
    // 閉じた変更案の取り消しは中身が無くてもできる（表の値は取り消しの記録から戻す）
    expect(derive(again.getState()).undoStates.get("lost")?.can).toBe(true)
    expect(undoGroup(again, "lost")).toMatchObject({ reverted: 1, kept: 0 })
  })
})

describe("取り消し（commit・undoGroup）", () => {
  test("積むのは commit の1か所。変わったときだけ記録を積み、枠（kind）を記録に書く", () => {
    const s = store()
    receiveProposal(s, chatRecord("p", [cell("r1", "x")]), "replace")
    expect(approve(s, "p", [0])).toBe(true)
    expect(op(s, 0)).toBe(true)
    expect(commit(s, { group: `${GYOSHU_UNDO}none`, kind: "op" }, ({ work: w }) => w)).toBe(false)
    expect(s.getState().work.undo.map((e) => [e.proposalId, e.kind, e.items])).toEqual([
      ["p", "approval", [0]],
      [`${GYOSHU_UNDO}0`, "op", []],
    ])
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
