import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { fixture } from "@/lib/convert/__tests__/helpers"
import { askKey, type PlanAsk } from "@/lib/convert/plan"
import { setWork } from "../create-case-store"
import { createCaseSession } from "../session"
import { fakeDeps, FILES, page } from "./helpers"

const noChannel = () => null

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** 合成のサンプルを変換し終えた画面の1回分 */
async function converted() {
  const s = createCaseSession(page(), fakeDeps(), noChannel)
  s.connect()
  await s.actions.openSource(FILES[0]!, true)
  await vi.waitFor(() => expect(s.table(s.store.getState()).hasTable).toBe(true))
  return s
}
type Session = Awaited<ReturnType<typeof converted>>

/** 合成の聞き返し（工種〔B列〕・C列に値のある行＝ほぼ全行が当たる） */
const ASK_B: PlanAsk = { kind: "doubtful", text: "B列に値のある行があります。", column: 1, values: [] }
const ASK_C: PlanAsk = { kind: "unfinished", text: "C列に値のある行があります。", column: 2, values: [] }
/** 計画の聞き返しを入れ替える（計画を立て直したのと同じ: 並びが変わる） */
const setAsks = (s: Session, asks: PlanAsk[]) => setWork(s.store, (w) => ({ ...w, plan: w.plan && { ...w.plan, plan: { ...w.plan.plan, asks } } }))
const questions = (s: Session) => s.view(s.store.getState()).questionStates

describe("計画の聞き返しの答えは並び順ではなく聞き返しの鍵で持つ", () => {
  test("答えたあとに聞き返しの並びが変わっても、答えはその聞き返しに残り、取り消しも同じ聞き返しに当たる", async () => {
    const s = await converted()
    setAsks(s, [ASK_B])
    s.actions.answerReport("plan-ask-0", "keep")
    expect(s.store.getState().work.reportAnswers).toEqual({ [askKey(ASK_B)]: "keep" })
    setAsks(s, [ASK_C, ASK_B])
    // 載せる工事（去年の案件が無いので聞く）は最初
    expect(questions(s)).toEqual([
      { id: "selection", answered: false },
      { id: "tax", answered: false },
      { id: "plan-ask-0", answered: false },
      { id: "plan-ask-1", answered: true },
    ])
    s.actions.undoWithNotice(`report:${askKey(ASK_B)}`, "答え")
    expect(s.store.getState().work.reportAnswers).toEqual({})
  })

  test("確かめを開いている間に計画が立て直されたら、確かめの「載せない」は別の聞き返しに当てない", async () => {
    const s = await converted()
    setAsks(s, [ASK_B])
    s.actions.answerReport("plan-ask-0", "exclude")
    const confirm = s.store.getState().ui.dialogs.askConfirm
    expect(confirm?.key).toBe(askKey(ASK_B))
    const rowFilter = s.store.getState().work.plan!.plan.rowFilter
    setAsks(s, [ASK_C])
    s.actions.closeAskConfirm(true)
    const { work, ui } = s.store.getState()
    expect(ui.dialogs.askConfirm).toBeNull()
    expect(work.reportAnswers).toEqual({})
    expect(work.plan!.plan.rowFilter).toEqual(rowFilter)
    expect(work.undo).toEqual([])
  })

  test("鍵は値の順・前後の空白・全角半角を見ない", () => {
    expect(askKey({ kind: "doubtful", column: 3, values: ["Ａ ", "b"] })).toBe(askKey({ kind: "doubtful", column: 3, values: ["b", "A"] }))
    expect(askKey({ kind: "doubtful", column: 3, values: ["a"] })).not.toBe(askKey({ kind: "doubtful", column: 4, values: ["a"] }))
    expect(askKey({ kind: "doubtful", column: 3, values: ["a"] })).not.toBe(askKey({ kind: "unfinished", column: 3, values: ["a"] }))
  })
})

describe("「変換の元にしますか」の待ちの列", () => {
  test("一度に複数の表を付けると1つずつ聞き、答えた順に外す（閉じる知らせが続けて来ても次のものを飛ばさない）", async () => {
    const s = await converted()
    const bytes = fixture("sample-messy.xlsx")
    await s.actions.attach([new File([bytes as BlobPart], "合成の一.xlsx"), new File([bytes as BlobPart], "合成の二.xlsx")])
    const pending = s.store.getState().ui.dialogs.pendingSources
    expect(pending.map((f) => f.name)).toEqual(["合成の一.xlsx", "合成の二.xlsx"])
    // 「付けるだけ」→ ダイアログが閉じる知らせ（同じファイル）
    s.actions.confirmSource(pending[0]!.id, false)
    s.actions.confirmSource(pending[0]!.id, false)
    expect(s.store.getState().ui.dialogs.pendingSources.map((f) => f.name)).toEqual(["合成の二.xlsx"])
    s.actions.confirmSource(pending[1]!.id, true)
    expect(s.store.getState().ui.dialogs.pendingSources).toEqual([])
    await vi.waitFor(() => expect(s.store.getState().work.sourceFileId).toBe(pending[1]!.id))
  })
})
