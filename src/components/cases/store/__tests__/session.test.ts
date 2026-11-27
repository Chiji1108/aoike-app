import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { SaveRequest, SaveResponse } from "@/lib/cases/autosave"
import { decisionOf, newProposal, type ChatChange } from "@/lib/chat/proposals"
import { fixture } from "@/lib/convert/__tests__/helpers"
import type { MappingPlan } from "@/lib/convert/plan"
import type { KojiFieldId } from "@/lib/spec/koji-keireki"
import { receiveProposal } from "../actions/proposals"
import { fakeDeps, FILES, NO_AI, page } from "./helpers"
import { setRuntime, setWork } from "../create-case-store"
import type { CaseDeps } from "../deps"
import { createCaseSession } from "../session"
import { savesSettled } from "../sync"

/** 待たせておき、あとで返す（外の処理の返事の順を決める） */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
/** 待っている処理（microtask・タイマー）を進める */
const settle = () => new Promise((r) => setTimeout(r, 0))


// 画面につなぐ（connect）と window の beforeunload を見る
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("待つ処理（偽の deps）", () => {
  test("計画を待つ間に元を変えたら、前の元の計画は捨てる（費用は足す）", async () => {
    const first = deferred<Awaited<ReturnType<CaseDeps["planWithAi"]>>>()
    const planWithAi = vi.fn<CaseDeps["planWithAi"]>().mockReturnValueOnce(first.promise).mockResolvedValue({ ...NO_AI, usd: 0.01 })
    const s = createCaseSession(page(), fakeDeps({ planWithAi }))
    const opening = s.actions.openSource(FILES[0]!, true)
    await vi.waitFor(() => expect(planWithAi).toHaveBeenCalledTimes(1))
    expect(s.store.getState().runtime.planDraft).not.toBeNull()

    await s.actions.openSource(FILES[1]!, true)
    const planned = s.store.getState().work.plan
    expect(s.store.getState().work.sourceFileId).toBe("f2")
    expect(planned?.notice).toContain("偽の AI は使えません")

    // 前の元の計画の返事は、あとから届いても入れない
    first.resolve({ ...NO_AI, message: "前の元の返事", usd: 0.02 })
    await opening
    const { work, runtime } = s.store.getState()
    expect(work.sourceFileId).toBe("f2")
    expect(work.plan).toBe(planned)
    expect(work.plan?.notice).not.toContain("前の元の返事")
    expect(runtime.source?.fileId).toBe("f2")
    expect(runtime.planDraft).toBeNull()
    expect(runtime.costUsd).toBeCloseTo(0.03)
  })

  test("読んでいる間に別の元を読み始めたら、前の元は入れない", async () => {
    const slow = deferred<Uint8Array>()
    const fetchFile = vi.fn<CaseDeps["fetchFile"]>().mockReturnValueOnce(slow.promise).mockResolvedValue(fixture("sample-messy.xlsx"))
    const s = createCaseSession(page(), fakeDeps({ fetchFile }))
    const opening = s.actions.openSource(FILES[0]!, false)
    await vi.waitFor(() => expect(fetchFile).toHaveBeenCalledTimes(1))
    await s.actions.openSource(FILES[1]!, false)
    slow.resolve(fixture("sample-messy.xlsx"))
    await opening
    expect(s.store.getState().runtime.source?.fileId).toBe("f2")
    expect(s.store.getState().runtime.loading).toBeNull()
  })

  test("計画が決まると自動で変換し、変換の途中で計画が変わったら、その結果は使わず新しい計画で変換し直す", async () => {
    const blocked = deferred<Awaited<ReturnType<CaseDeps["runAiBatch"]>>>()
    let blocking = true
    const runAiBatch = vi.fn<CaseDeps["runAiBatch"]>(async () => (blocking ? blocked.promise : NO_AI))
    const s = createCaseSession(page(), fakeDeps({ runAiBatch }))
    s.connect()
    /** 変換を終えた（converted になった）ときの計画 */
    const convertedWith: unknown[] = []
    s.store.subscribe((now, prev) => {
      if (now.work.converted && !prev.work.converted) convertedWith.push(now.work.plan?.plan)
    })
    await s.actions.openSource(FILES[0]!, true)
    await vi.waitFor(() => expect(runAiBatch).toHaveBeenCalled())
    expect(s.store.getState().runtime.converting).toBe(true)

    // 変換の途中で計画を変える（新しい計画で変換し直す）
    blocking = false
    const next: MappingPlan<KojiFieldId> = { ...s.store.getState().work.plan!.plan }
    s.actions.changePlan(next)
    await vi.waitFor(() => expect(s.store.getState().work.converted).toBe(true))
    // 前の変換の返事があとから届いても、表は新しい計画のまま
    blocked.resolve(NO_AI)
    await settle()
    expect(convertedWith).toEqual([next])
    expect(s.store.getState().work.plan?.plan).toBe(next)
    expect(s.store.getState().runtime.converting).toBe(false)
  })

  test("ルールの書き込みが途中で失敗したら、書けた分だけ承認する（承認の記録も書けた分）", async () => {
    const rule = (text: string): ChatChange => ({ kind: "rule", scope: "customer", text })
    const approveRule = vi.fn<CaseDeps["approveRule"]>().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("書けませんでした"))
    const s = createCaseSession(page(), fakeDeps({ approveRule }))
    const changes = [rule("一"), rule("二"), rule("三")]
    receiveProposal(s.store, { proposal: newProposal("p", { kind: "chat", messageId: "m" }, changes, null), changes }, "replace")
    const deciding = s.actions.decideProposal("p", [0, 1, 2], "applied")
    expect(s.store.getState().runtime.busy.rule).toBe(true)
    await deciding
    const p = s.store.getState().work.proposals[0]!
    if (p.state !== "open") throw new Error("開いたままのはず")
    expect([0, 1, 2].map((i) => decisionOf(p, i))).toEqual(["applied", "pending", "pending"])
    expect(approveRule.mock.calls.map(([, item]) => item)).toEqual([0, 1])
    expect(s.store.getState().work.undo.map((e) => [e.proposalId, e.external])).toEqual([["p", ["rule"]]])
    expect(s.store.getState().runtime.busy.rule).toBe(false)
  })

  test("状態の変更が失敗したら、その後に変えていなければ元に戻す", async () => {
    const failing = deferred<unknown>()
    const updateStatus = vi.fn<CaseDeps["updateStatus"]>().mockReturnValueOnce(failing.promise).mockResolvedValue(undefined)
    const s = createCaseSession(page(), fakeDeps({ updateStatus }))
    const first = s.actions.changeStatus("inquiring")
    await s.actions.changeStatus("done")
    failing.reject(new Error("送れませんでした"))
    await first
    expect(s.store.getState().runtime.status).toBe("done")
  })
})

describe("画面を離れる・待っている間に変わる（PR #24 の指摘）", () => {
  test("画面を離れたら、待っている計画の結果を入れず、自動の変換も始めず、そのあとの変更は保存しない。最後の保存は savesSettled で待てる", async () => {
    const plan = deferred<Awaited<ReturnType<CaseDeps["planWithAi"]>>>()
    const planWithAi = vi.fn<CaseDeps["planWithAi"]>().mockReturnValueOnce(plan.promise).mockResolvedValue(NO_AI)
    const saving = deferred<SaveResponse>()
    const saveState = vi.fn<CaseDeps["saveState"]>().mockReturnValueOnce(saving.promise).mockImplementation(async (req) => ({ ok: true, version: req.version + 1 }))
    const runAiBatch = vi.fn<CaseDeps["runAiBatch"]>(async () => NO_AI)
    const s = createCaseSession(page(), fakeDeps({ planWithAi, saveState, runAiBatch }))
    const disconnect = s.connect()
    const opening = s.actions.openSource(FILES[0]!, true)
    await vi.waitFor(() => expect(planWithAi).toHaveBeenCalledTimes(1))
    // 一覧へ移る: 待っている変更（元を変えた作業）はすぐに送る
    disconnect()
    expect(saveState).toHaveBeenCalledTimes(1)
    let settled = false
    void savesSettled("c").then(() => (settled = true))
    plan.resolve({ ...NO_AI, message: "離れたあとの返事" })
    await opening
    await settle()
    expect(s.store.getState().work.plan).toBeNull()
    expect(s.store.getState().runtime.planDraft).toBeNull()
    expect(settled).toBe(false)
    saving.resolve({ ok: true, version: 1 })
    await vi.waitFor(() => expect(settled).toBe(true))
    // 離れたあとに作業が変わっても（計画が決まっても）、変換も保存もしない
    setWork(s.store, (w) => ({ ...w, rounding: "round" }))
    await settle()
    expect(runAiBatch).not.toHaveBeenCalled()
    expect(saveState).toHaveBeenCalledTimes(1)
  })

  test("外してすぐつなぎ直すと（React の StrictMode・同じ画面に戻る）、捨てた元の読み込みと計画をやり直す", async () => {
    const s = createCaseSession(page(), fakeDeps())
    setWork(s.store, (w) => ({ ...w, sourceFileId: "f1" }))
    s.connect()()
    s.connect()
    await vi.waitFor(() => expect(s.store.getState().work.plan).not.toBeNull())
    expect(s.store.getState().runtime.source?.fileId).toBe("f1")
    await vi.waitFor(() => expect(s.store.getState().work.converted).toBe(true))
  })

  test("離れるときに保存できなければ最後の1回であきらめ、savesSettled が false を返す（送り直して新しい画面とぶつからない）。新しい画面は報告に出す", async () => {
    const saveState = vi.fn<CaseDeps["saveState"]>(async () => {
      throw new Error("つながりません")
    })
    const s = createCaseSession(page(), fakeDeps({ saveState }))
    const off = s.connect()
    setWork(s.store, (w) => ({ ...w, rounding: "round" }))
    off()
    expect(await savesSettled("c")).toBe(false)
    const calls = saveState.mock.calls.length
    await new Promise((r) => setTimeout(r, 1_100))
    expect(saveState.mock.calls.length).toBe(calls)
    const next = createCaseSession({ ...page(), previousUnsaved: true }, fakeDeps())
    expect(next.store.getState().runtime.previousUnsaved).toBe(true)
  })

  test("状態の変更が続けて失敗したら、サーバーが最後に受け付けた状態に戻す（前の楽観的な値に戻さない）", async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    const updateStatus = vi.fn<CaseDeps["updateStatus"]>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const s = createCaseSession(page(), fakeDeps({ updateStatus }))
    const a = s.actions.changeStatus("inquiring")
    const b = s.actions.changeStatus("done")
    second.reject(new Error("送れませんでした"))
    await b
    expect(s.store.getState().runtime.status).toBe("converting")
    first.reject(new Error("送れませんでした"))
    await a
    expect(s.store.getState().runtime.status).toBe("converting")
  })

  test("ルールを外に書いている間に変更案が閉じたら、表に重ねず承認の印も付けない", async () => {
    const writing = deferred<undefined>()
    const approveRule = vi.fn<CaseDeps["approveRule"]>().mockReturnValueOnce(writing.promise)
    const s = createCaseSession(page(), fakeDeps({ approveRule }))
    const location = {
      kind: "location",
      prefecture: "東京都",
      place: "千代田区",
      urls: [],
      source: "knowledge",
      confident: true,
      note: "",
      site: { key: "k", workName: "合成の工事", client: "合成の会社" },
      rowKeys: ["add-1"],
    } satisfies ChatChange
    const changes: ChatChange[] = [location, { kind: "rule", scope: "customer", text: "一" }]
    receiveProposal(s.store, { proposal: newProposal("p", { kind: "chat", messageId: "m" }, changes, null), changes }, "replace")
    const deciding = s.actions.decideProposal("p", [0, 1], "applied")
    await vi.waitFor(() => expect(approveRule).toHaveBeenCalled())
    // 待っている間に元を変える（変更案は閉じる）
    await s.actions.openSource(FILES[0]!, true)
    writing.resolve(undefined)
    await deciding
    const { work } = s.store.getState()
    expect(work.undo).toEqual([])
    expect(work.proposals[0]!.state).toBe("closed")
    expect(s.store.getState().runtime.busy.rule).toBe(false)
  })

  test("計画が同じまま変換を終えたとき、待っている間にほかの処理が足した AI の結果を消さない", async () => {
    const blocked = deferred<Awaited<ReturnType<CaseDeps["runAiBatch"]>>>()
    let blocking = true
    const runAiBatch = vi.fn<CaseDeps["runAiBatch"]>(async () => (blocking ? blocked.promise : NO_AI))
    const s = createCaseSession(page(), fakeDeps({ runAiBatch }))
    s.connect()
    await s.actions.openSource(FILES[0]!, true)
    await vi.waitFor(() => expect(runAiBatch).toHaveBeenCalled())
    const other = { id: 0, value: "取り込みで聞いた値", persons: [], needsReview: false, note: "" }
    setWork(s.store, (w) => ({ ...w, aiCache: new Map(w.aiCache).set("取り込み:値", other) }))
    blocking = false
    blocked.resolve(NO_AI)
    await vi.waitFor(() => expect(s.store.getState().work.converted).toBe(true))
    expect(s.store.getState().work.aiCache.get("取り込み:値")).toBe(other)
  })
})

describe("保存・同期（sync.ts）", () => {
  test("作業が変わったときだけ保存し、保存の状態をストアに入れる（保存しない状態の変化では送らない）", async () => {
    const saves: SaveRequest[] = []
    const saveState = async (req: SaveRequest): Promise<SaveResponse> => (saves.push(req), { ok: true, version: req.version + 1 })
    const s = createCaseSession(page(), fakeDeps({ saveState }))
    const disconnect = s.connect()
    setRuntime(s.store, () => ({ costUsd: 1 }))
    expect(s.store.getState().sync.status.kind).toBe("saved")
    setWork(s.store, (w) => ({ ...w, rounding: "round" }))
    expect(s.store.getState().sync.status.kind).toBe("pending")
    await s.settle()
    expect(saves.map((r) => [r.version, r.work.rounding])).toEqual([[0, "round"]])
    expect(s.store.getState().sync.status.kind).toBe("saved")
    disconnect()
  })
})
