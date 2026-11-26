import { describe, expect, test } from "vitest"
import { decide, newProposal, type ChatChange } from "@/lib/chat/proposals"
import { createCaseStore, initialCaseState, putProposal, setWork } from "../create-case-store"
import { derive } from "../derive"

const change: ChatChange = { kind: "inquiryMail", subject: "確認のお願い", intro: "" }
const store = () => createCaseStore(initialCaseState({ state: null, proposals: [], settings: { rule7Tax: "excluded" } }))

describe("案件のストア", () => {
  test("変更案は中身と一緒に1回で入り、派生は同じ状態なら同じ参照を返す", () => {
    const s = store()
    const p = newProposal("p1", { kind: "excel", fileId: "f" }, [change], null)
    putProposal(s, { proposal: p, changes: [change] }, (ps) => [...ps, p])
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
  putProposal(a, { proposal: p, changes: [change] }, (ps) => [...ps, p])
  const da = derive(a.getState())
  const db = derive(b.getState())
  expect(derive(a.getState())).toBe(da)
  expect(derive(b.getState())).toBe(db)
  expect(da.panels.excel.length).toBe(1)
  expect(db.panels.excel.length).toBe(0)
})
