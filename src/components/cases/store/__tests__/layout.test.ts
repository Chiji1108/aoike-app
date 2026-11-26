import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { fixture } from "@/lib/convert/__tests__/helpers"
import { createCaseSession } from "../session"
import { fakeDeps, FILES, page } from "./helpers"

const noChannel = () => null
/** 待っている処理（microtask・タイマー）を進める */
const settle = () => new Promise((r) => setTimeout(r, 0))

// 画面につなぐ（connect）と window の beforeunload・pagehide を見る
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** 合成のサンプルを変換し終えた画面の1回分（wide は画面の幅） */
async function converted(wide: boolean) {
  const s = createCaseSession(page(), fakeDeps(), noChannel)
  s.connect()
  s.actions.setWide(wide)
  await s.actions.openSource(FILES[0]!, true)
  await vi.waitFor(() => expect(s.view(s.store.getState()).layout.work).not.toBeNull())
  return s
}
const layout = (s: Awaited<ReturnType<typeof converted>>) => s.view(s.store.getState()).layout

describe("並べ方と画面の action（ui）", () => {
  test("広い画面: 表ができると作業の画面を横に開き、閉じる・道具の結果（auto）は開き直さない・押したら（click）開く", async () => {
    const s = await converted(true)
    expect(layout(s)).toMatchObject({ work: { place: "side", shown: true }, chat: "column" })
    s.actions.setWorkShown(false)
    expect(layout(s)).toMatchObject({ work: { place: "side", shown: false }, chat: "full" })
    s.actions.openTab("inquiry", "auto")
    expect(s.store.getState().ui.tab).toBe("inquiry")
    expect(layout(s).workShown).toBe(false)
    s.actions.openTab("table", "click")
    expect(layout(s)).toMatchObject({ work: { shown: true }, chat: "column" })
  })

  test("狭い画面: 表ができても重ねて開かず、道具の結果ではタブだけ切り替える。開くとうしろを覆う", async () => {
    const s = await converted(false)
    expect(layout(s)).toMatchObject({ work: { place: "overlay", shown: false }, covered: false })
    s.actions.openTab("location", "auto")
    expect(s.store.getState().ui.tab).toBe("location")
    expect(layout(s).covered).toBe(false)
    s.actions.showTab("table")
    expect(layout(s)).toMatchObject({ work: { place: "overlay", shown: true }, covered: true })
  })

  test("狭い画面でその場でチャットへ移る（次にやることの「答える」）: 作業の画面を閉じてから、チャットの答えを待つものへの頼みを書く", async () => {
    const s = await converted(false)
    s.actions.showTab("table")
    const before = s.store.getState().ui.focus
    s.actions.goStep("answer")
    expect(layout(s).covered).toBe(false)
    expect(layout(s).workShown).toBe(false)
    const focus = s.store.getState().ui.focus
    expect(focus).toEqual({ kind: "chat", target: "[data-pending]" })
    // 同じ移り先でも、もう一度頼めば新しい頼み（もう一度動かす）
    s.actions.goStep("answer")
    expect(s.store.getState().ui.focus).not.toBe(focus)
    expect(before).toBeNull()
  })

  test("広い画面でチャットへ移っても、作業の画面は閉じない", async () => {
    const s = await converted(true)
    s.actions.goChat({ target: '[data-proposal="p"]' })
    expect(layout(s)).toMatchObject({ work: { shown: true }, chat: "column" })
    expect(s.store.getState().ui.focus).toEqual({ kind: "chat", target: '[data-proposal="p"]' })
  })

  test("ダウンロードの前の確認からチャットへ移ると、確認を閉じて閉じたあとのフォーカス先を残し、開き直すと外す", async () => {
    const s = await converted(false)
    s.actions.openExport()
    const to = { target: '[data-proposal="p"]' }
    s.actions.exportToChat(to)
    expect(s.store.getState().ui.dialogs.export).toEqual({ open: false, returnTo: to })
    expect(s.store.getState().ui.focus).toEqual({ kind: "chat", ...to })
    s.actions.openExport()
    expect(s.store.getState().ui.dialogs.export).toEqual({ open: true, returnTo: null })
  })

  test("業種の直し方を1行から押すと、業種のタブを開いてその行への頼みを書く（2行以上は頼まない）", async () => {
    const s = await converted(true)
    s.actions.runFixAction("decideGyoshu", ["r1"])
    expect(s.store.getState().ui).toMatchObject({ tab: "gyoshu", workChoice: true, focus: { kind: "gyoshuRow", key: "r1" } })
    const focus = s.store.getState().ui.focus
    s.actions.runFixAction("decideGyoshu", ["r1", "r2"])
    expect(s.store.getState().ui.focus).toBe(focus)
  })

  test("作業の画面で問い合わせのタブを見たら、問い合わせのメールの下書きの案内を出し、送ったらこの画面では出さない", async () => {
    const s = await converted(false)
    s.actions.setTab("inquiry")
    await settle()
    // 狭い画面で閉じたまま（見ていない）
    expect(s.store.getState().runtime.hints.inquiry).toBe("hidden")
    s.actions.showTab("inquiry")
    await settle()
    expect(s.store.getState().runtime.hints.inquiry).toBe("shown")
    s.actions.suggestionSent("inquiry-text")
    s.actions.setTab("table")
    s.actions.setTab("inquiry")
    await settle()
    expect(s.store.getState().runtime.hints.inquiry).toBe("sent")
  })

  test("並べ方は同じ状態なら同じもの（selector が描画ごとに新しいものを返さない）", async () => {
    const s = await converted(true)
    const a = layout(s)
    s.actions.setDragging(true)
    expect(layout(s)).toBe(a)
  })

  test("変換の元があるときに表を付けると「変換の元にしますか」を開き、付けるだけなら元を変えない（ダイアログは action で開く）", async () => {
    const s = await converted(true)
    const bytes = fixture("sample-messy.xlsx")
    await s.actions.attach([new File([bytes as BlobPart], "合成の追加.xlsx")])
    const pending = s.store.getState().ui.dialogs.pendingSource
    expect(pending?.name).toBe("合成の追加.xlsx")
    s.actions.confirmSource(false)
    expect(s.store.getState().ui.dialogs.pendingSource).toBeNull()
    expect(s.store.getState().work.sourceFileId).toBe("f1")
    expect(s.store.getState().runtime.files.map((f) => f.name)).toContain("合成の追加.xlsx")
  })

  test("税込・税抜の答えはその時点の作業に重ね、取り消すと戻る", async () => {
    const s = await converted(true)
    const before = s.store.getState().work.tax
    s.actions.answerReport("tax", "excluded")
    expect(s.store.getState().work).toMatchObject({ tax: "excluded", reportAnswers: { tax: "excluded" } })
    s.actions.undoWithNotice("report:tax", "答え")
    expect(s.store.getState().work.tax).toBe(before)
    expect(s.store.getState().work.reportAnswers.tax).toBeUndefined()
  })
})
