import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { SaveRequest, SaveResponse } from "@/lib/cases/autosave"
import type { CaseFile } from "@/lib/cases/types"
import { decisionOf, newProposal, type ChatChange } from "@/lib/chat/proposals"
import { fixture } from "@/lib/convert/__tests__/helpers"
import type { MappingPlan } from "@/lib/convert/plan"
import type { KojiFieldId } from "@/lib/spec/koji-keireki"
import { receiveProposal } from "../actions/proposals"
import { setRuntime, setWork } from "../create-case-store"
import type { CaseDeps } from "../deps"
import type { SessionPage } from "../env"
import { createCaseSession } from "../session"
import type { PeerChannel } from "../sync"

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

const file = (id: string): CaseFile => ({ id, caseId: "c", kind: "source", name: "sample-messy.xlsx", contentType: "application/octet-stream", size: 1, createdAt: 0 })
const FILES = [file("f1"), file("f2")]
const NO_AI = { ok: false as const, reason: "error" as const, message: "偽の AI は使えません", usd: 0 }

function page(): SessionPage {
  return {
    kase: { id: "c", status: "converting", costUsd: 0 },
    files: FILES,
    state: null,
    proposals: [],
    unreadableProposals: [],
    closedMissing: 0,
    settings: { rule7Tax: "excluded" },
    chatEnabled: true,
    excelKey: "k",
    previous: null,
  }
}

/** 偽の外の処理（ファイルはどれも合成のサンプル。AI は使えない。住所は空の結果） */
function fakeDeps(over: Partial<CaseDeps> = {}): CaseDeps {
  return {
    saveState: async (req) => ({ ok: true, version: req.version + 1 }),
    planWithAi: async () => NO_AI,
    runAiBatch: async () => NO_AI,
    recordProposal: async () => undefined,
    approveRule: async () => undefined,
    approveLocations: async () => undefined,
    updateStatus: async () => undefined,
    uploadFile: async (kind, _f, name) => ({ ...file(crypto.randomUUID()), kind, name }),
    fetchFile: async () => fixture("sample-messy.xlsx"),
    lookupAddresses: async () => new Map(),
    ...over,
  }
}

const noChannel = () => null

describe("待つ処理（偽の deps）", () => {
  test("計画を待つ間に元を変えたら、前の元の計画は捨てる（費用は足す）", async () => {
    const first = deferred<Awaited<ReturnType<CaseDeps["planWithAi"]>>>()
    const planWithAi = vi.fn<CaseDeps["planWithAi"]>().mockReturnValueOnce(first.promise).mockResolvedValue({ ...NO_AI, usd: 0.01 })
    const s = createCaseSession(page(), fakeDeps({ planWithAi }), noChannel)
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
    const s = createCaseSession(page(), fakeDeps({ fetchFile }), noChannel)
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
    const s = createCaseSession(page(), fakeDeps({ runAiBatch }), noChannel)
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
    const rule = (text: string): ChatChange => ({ kind: "rule", scope: "customer", text, source: "chat" })
    const approveRule = vi.fn<CaseDeps["approveRule"]>().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("書けませんでした"))
    const s = createCaseSession(page(), fakeDeps({ approveRule }), noChannel)
    const changes = [rule("一"), rule("二"), rule("三")]
    receiveProposal(s.store, { proposal: newProposal("p", { kind: "chat", messageId: "m" }, changes, null), changes }, "replace")
    const deciding = s.actions.decideProposal("p", [0, 1, 2], "applied")
    expect(s.store.getState().runtime.busy.rule).toBe(true)
    await deciding
    const p = s.store.getState().work.proposals[0]!
    if (p.state !== "open") throw new Error("開いたままのはず")
    expect([0, 1, 2].map((i) => decisionOf(p, i))).toEqual(["applied", "pending", "pending"])
    expect(approveRule.mock.calls.map(([, item]) => item)).toEqual([0, 1])
    expect(s.store.getState().work.undo.map((e) => [e.proposalId, e.items, e.external])).toEqual([["p", [0], ["rule"]]])
    expect(s.store.getState().runtime.busy.rule).toBe(false)
  })

  test("状態の変更が失敗したら、その後に変えていなければ元に戻す。完了にしたら振り返りを案内する", async () => {
    const failing = deferred<unknown>()
    const updateStatus = vi.fn<CaseDeps["updateStatus"]>().mockReturnValueOnce(failing.promise).mockResolvedValue(undefined)
    const s = createCaseSession(page(), fakeDeps({ updateStatus }), noChannel)
    const first = s.actions.changeStatus("inquiring")
    await s.actions.changeStatus("done")
    failing.reject(new Error("送れませんでした"))
    await first
    expect(s.store.getState().runtime.status).toBe("done")
    expect(s.store.getState().runtime.hints.review).toBe(true)
  })
})

/** 同じブラウザのタブの間の道（BroadcastChannel の代わり。送った知らせは、ほかのタブに届く） */
function channelBus() {
  const tabs = new Set<(data: unknown) => void>()
  return (): PeerChannel => {
    let receive: ((data: unknown) => void) | null = null
    const deliver = (data: unknown) => receive?.(data)
    tabs.add(deliver)
    return {
      post: (m) => {
        for (const t of tabs) if (t !== deliver) t(structuredClone(m))
      },
      listen: (r) => {
        receive = r
      },
      close: () => void tabs.delete(deliver),
    }
  }
}

describe("保存・同期（sync.ts）", () => {
  beforeEach(() => {
    vi.stubGlobal("window", new EventTarget())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("作業が変わったときだけ保存し、保存の状態をストアに入れる（保存しない状態の変化では送らない）", async () => {
    const saves: SaveRequest[] = []
    const saveState = async (req: SaveRequest): Promise<SaveResponse> => (saves.push(req), { ok: true, version: req.version + 1 })
    const s = createCaseSession(page(), fakeDeps({ saveState }), noChannel)
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

  test("同じ案件を別のタブで開くと互いに印を付け、片方が保存するともう片方に「保存された」の印。閉じたら印を外す", async () => {
    const bus = channelBus()
    const a = createCaseSession(page(), fakeDeps(), bus)
    const b = createCaseSession(page(), fakeDeps(), bus)
    const offA = a.connect()
    expect(a.store.getState().sync.peer).toBe("none")
    const offB = b.connect()
    expect(a.store.getState().sync.peer).toBe("open")
    expect(b.store.getState().sync.peer).toBe("open")

    setWork(a.store, (w) => ({ ...w, rounding: "round" }))
    await a.settle()
    expect(b.store.getState().sync.peer).toBe("saved")
    expect(a.store.getState().sync.peer).toBe("open")

    offB()
    expect(a.store.getState().sync.peer).toBe("none")
    offA()
  })

  test("形の違う知らせは無視する", () => {
    let send: ((data: unknown) => void) | null = null
    const s = createCaseSession(page(), fakeDeps(), () => ({ post: () => undefined, listen: (r) => void (send = r), close: () => undefined }))
    const off = s.connect()
    send!({ kind: "saved" })
    send!({ kind: "reload", tab: "x" })
    send!("saved")
    expect(s.store.getState().sync.peer).toBe("none")
    off()
  })

})
