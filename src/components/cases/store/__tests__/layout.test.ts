import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { fixture } from "@/lib/convert/__tests__/helpers"
import type { ChatPrefs } from "../create-case-store"
import type { CaseDeps } from "../deps"
import { createCaseSession } from "../session"
import { currentStep, nextStep, stepDone } from "@/lib/cases/steps"
import { newProposal } from "@/lib/chat/proposals"
import { lastSelectionUndo } from "@/lib/cases/undo"
import { receiveProposal } from "../actions/proposals"
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
    expect(layout(s)).toMatchObject({ work: { place: "inline", shown: true }, chat: "window" })
    s.actions.setWorkShown(false)
    expect(layout(s)).toMatchObject({ work: { place: "inline", shown: false }, chat: "full" })
    s.actions.openTab("inquiry", "auto")
    expect(s.store.getState().ui.tab).toBe("inquiry")
    expect(layout(s).workShown).toBe(false)
    s.actions.openTab("table", "click")
    expect(layout(s)).toMatchObject({ work: { shown: true }, chat: "window" })
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

  test("狭い画面で「答える」の段の「AI に聞く」: 作業の画面を閉じ、チャットに送る指示とチャットの入力欄への頼みを書く（受け取ったら外す）", async () => {
    const s = await converted(false)
    s.actions.showTab("answer")
    // 送れない間は受け付けない（頼みを残さない）
    s.actions.askChat("説明して")
    expect(s.store.getState().ui.chatSend).toBeNull()
    s.actions.setChatCanSend(true)
    s.actions.askChat("説明して")
    expect(layout(s)).toMatchObject({ covered: false, workShown: false })
    const ui = s.store.getState().ui
    expect(ui.chatSend).toEqual({ text: "説明して" })
    expect(ui.focus).toEqual({ kind: "chatWindow" })
    // 同じ指示でも、もう一度頼めば新しい頼み（もう一度送る）
    s.actions.askChat("説明して")
    expect(s.store.getState().ui.chatSend).not.toBe(ui.chatSend)
    s.actions.takeChatSend()
    expect(s.store.getState().ui.chatSend).toBeNull()
  })

  test("広い画面でチャットへ移っても、作業の画面は閉じない", async () => {
    const s = await converted(true)
    s.actions.goChat({ target: '[data-proposal="p"]' })
    expect(layout(s)).toMatchObject({ work: { shown: true }, chat: "window" })
    expect(s.store.getState().ui.focus).toEqual({ kind: "chat", target: '[data-proposal="p"]' })
  })

  test("ダウンロードは段として開く（ダイアログでない）。表ができたら今の段に決める", async () => {
    const s = await converted(false)
    await settle()
    expect(s.store.getState().ui.tab).toBe(currentStep(s.view(s.store.getState()).todo))
    s.actions.openExport()
    expect(s.store.getState().ui).toMatchObject({ tab: "export", workChoice: true })
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
    const pending = s.store.getState().ui.dialogs.pendingSources
    expect(pending.map((f) => f.name)).toEqual(["合成の追加.xlsx"])
    s.actions.confirmSource(pending[0]!.id, false)
    expect(s.store.getState().ui.dialogs.pendingSources).toEqual([])
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

describe("チャットの窓（広い画面で表があるとき）", () => {
  /** 端末に覚えた設定の偽物（書いた値を読み返す） */
  function memoryPrefs(initial: ChatPrefs | null = null) {
    const saved: { current: ChatPrefs | null; writes: number } = { current: initial, writes: 0 }
    const prefs: CaseDeps["chatPrefs"] = {
      load: () => saved.current,
      save: (p) => {
        saved.current = p
        saved.writes++
      },
    }
    return { saved, prefs }
  }
  async function convertedWith(prefs: CaseDeps["chatPrefs"]) {
    const s = createCaseSession(page(), fakeDeps({ chatPrefs: prefs }), noChannel)
    s.connect()
    s.actions.setWide(true)
    await s.actions.openSource(FILES[0]!, true)
    await vi.waitFor(() => expect(s.view(s.store.getState()).layout.work).not.toBeNull())
    return s
  }
  const chat = (s: Awaited<ReturnType<typeof converted>>) => s.store.getState().ui.chat

  test("たたんだ設定は端末に覚えた値から始め、表ができたら窓はたたんだまま、変換の報告に未読の印を付ける", async () => {
    const { prefs } = memoryPrefs({ collapsed: true, size: { w: 500, h: 400 }, hintShown: true })
    const s = await convertedWith(prefs)
    expect(layout(s)).toMatchObject({ chat: "window", chatCollapsed: true })
    expect(chat(s)).toEqual({ collapsed: true, unread: "new", size: { w: 500, h: 400 }, hint: false })
  })

  test("職員が開くと未読の印を消して覚え、窓の入力欄への頼みを書く。たたむと右下のボタンへの頼み", async () => {
    const { saved, prefs } = memoryPrefs({ collapsed: true, size: null, hintShown: true })
    const s = await convertedWith(prefs)
    s.actions.setChatOpen(true)
    await settle()
    expect(chat(s)).toMatchObject({ collapsed: false, unread: null })
    expect(saved.current).toEqual({ collapsed: false, size: null, hintShown: true })
    expect(s.store.getState().ui.focus).toEqual({ kind: "chatWindow" })
    s.actions.setChatOpen(false)
    expect(saved.current).toEqual({ collapsed: true, size: null, hintShown: true })
    expect(s.store.getState().ui.focus).toEqual({ kind: "chatLauncher" })
  })

  test("未読の印はたたんでいる間に届いたものだけ。失敗（赤）は開くまで残る。開いている窓・職員の表の手直しでは付けない", async () => {
    const s = await converted(true)
    s.actions.chatArrived("new")
    expect(chat(s).unread).toBeNull()
    s.actions.setChatOpen(false)
    const row = s.table(s.store.getState()).shown![0]!
    s.actions.toggleRow(row.key, false)
    s.actions.editCells(row.key, [["workName", { value: "合成の工事", by: "staff" }]])
    expect(chat(s).unread).toBeNull()
    s.actions.chatArrived("error")
    s.actions.chatArrived("new")
    expect(chat(s).unread).toBe("error")
    s.actions.setChatOpen(true)
    await settle()
    expect(chat(s).unread).toBeNull()
  })

  test("アップロードの結果を報告に残すと印を付け（読めなかったものは赤）、作業の画面を閉じて中央にチャットを出すと消す", async () => {
    const s = await converted(true)
    s.actions.setChatOpen(false)
    s.actions.note({ name: "合成.pdf", text: "届いたファイルとして保存しました" })
    expect(chat(s).unread).toBe("new")
    s.actions.note({ name: "合成.xlsx", text: "読めませんでした", tone: "error" })
    expect(chat(s).unread).toBe("error")
    s.actions.setWorkShown(false)
    await settle()
    expect(layout(s).chat).toBe("full")
    expect(chat(s).unread).toBeNull()
  })

  test("「答える」の段の「AI に聞く」でチャットへ移るとき、たたんでいれば覚えた設定は変えずにその場だけ開き、作業の画面は閉じない", async () => {
    const { saved, prefs } = memoryPrefs({ collapsed: true, size: null, hintShown: true })
    const s = await convertedWith(prefs)
    const writes = saved.writes
    s.actions.setChatCanSend(true)
    s.actions.askChat("説明して")
    expect(layout(s)).toMatchObject({ chat: "window", chatCollapsed: false, workShown: true })
    expect(s.store.getState().ui.chatSend).toEqual({ text: "説明して" })
    expect(saved.writes).toBe(writes)
    expect(saved.current?.collapsed).toBe(true)
  })

  test("大きさは引いている間は覚えず、離したときに覚える（たたんだ設定はそのまま）", async () => {
    const { saved, prefs } = memoryPrefs({ collapsed: true, size: null, hintShown: true })
    const s = await convertedWith(prefs)
    s.actions.goChat({ target: "[data-pending]" })
    s.actions.resizeChat({ w: 480, h: 500 }, false)
    expect(chat(s).size).toEqual({ w: 480, h: 500 })
    expect(saved.current).toEqual({ collapsed: true, size: null, hintShown: true })
    s.actions.resizeChat({ w: 500, h: 520 }, true)
    expect(saved.current).toEqual({ collapsed: true, size: { w: 500, h: 520 }, hintShown: true })
    s.actions.resizeChat(null, true)
    expect(saved.current).toEqual({ collapsed: true, size: null, hintShown: true })
  })

  test("「チャットはここにあります」は初めて窓にしたときに出して端末に覚え（次は出さない）、消す・窓を開く／たたむと消える", async () => {
    const { saved, prefs } = memoryPrefs()
    const s = await convertedWith(prefs)
    expect(chat(s).hint).toBe(true)
    await settle()
    expect(saved.current?.hintShown).toBe(true)
    s.actions.dismissChatHint()
    expect(chat(s).hint).toBe(false)
    const again = await convertedWith(prefs)
    expect(chat(again).hint).toBe(false)
    const other = await convertedWith(memoryPrefs().prefs)
    other.actions.setChatOpen(false)
    expect(chat(other).hint).toBe(false)
  })

  test("並べ方の selector は窓の大きさを変えても同じもの（作業の画面・チャットを描き直さない）", async () => {
    const s = await converted(true)
    const a = layout(s)
    s.actions.resizeChat({ w: 480, h: 500 }, false)
    expect(layout(s)).toBe(a)
  })
})

describe("段（済んでも勝手に移らない）", () => {
  test("表ができたら今の段（答える）に決め、答え終えて段が済んでもそのまま。「次は」を押したときだけ次の段へ移り、その段の中身へのフォーカスを頼む", async () => {
    const s = await converted(true)
    await settle()
    const ui = () => s.store.getState().ui
    const todo = () => s.view(s.store.getState()).todo
    expect(ui().tab).toBe("answer")
    s.actions.answerReport("selection", "all")
    s.actions.answerReport("tax", "included")
    await settle()
    expect(stepDone(todo(), "answer")).toBe(true)
    expect(ui().tab).toBe("answer")
    expect(ui().focus).toBeNull()
    const next = nextStep(todo(), "answer")
    s.actions.goNextStep("answer")
    expect(ui()).toMatchObject({ tab: next, focus: { kind: "step", id: next } })
  })

  test("載せる工事は答えるの最初に聞き、答えると作業の載せる工事も変わる（取り消すと出どころも戻る）", async () => {
    const s = await converted(true)
    expect(s.view(s.store.getState()).questionStates[0]).toEqual({ id: "selection", answered: false })
    s.actions.answerReport("selection", "all")
    expect(s.store.getState().work).toMatchObject({ selection: "all", selectionBy: "staff" })
    s.actions.undoWithNotice("report:selection", "答え")
    expect(s.store.getState().work).toMatchObject({ selection: "rule7", selectionBy: null })
    expect(s.view(s.store.getState()).questionStates[0]).toEqual({ id: "selection", answered: false })
  })
})

describe("載せる工事を誰が決めたか（selectionBy）", () => {
  test("表の見出し・7割と金額（changeSelection）で選んでも答えたことになり、取り消すと聞き直す", async () => {
    const s = await converted(true)
    s.actions.changeSelection("all")
    expect(s.store.getState().work).toMatchObject({ selection: "all", selectionBy: "staff" })
    expect(s.view(s.store.getState()).questionStates[0]).toEqual({ id: "selection", answered: true })
  })

  test("今と同じ7割ルール（既定値）を7割と金額で選んでも、職員が決めた値になって答えたことになる。もう職員が決めた同じ値なら何もしない", async () => {
    const s = await converted(true)
    expect(s.store.getState().work).toMatchObject({ selection: "rule7", selectionBy: null })
    s.actions.changeSelection("rule7")
    expect(s.store.getState().work).toMatchObject({ selection: "rule7", selectionBy: "staff" })
    // 「答える」の載せる工事の行の「取り消す」は、この記録を指す
    expect(lastSelectionUndo(s.store.getState().work.undo)).toEqual({ kind: "undo", proposalId: expect.stringMatching(/^selection:/) })
    expect(s.view(s.store.getState()).questionStates[0]).toEqual({ id: "selection", answered: true })
    const undo = s.store.getState().work.undo.length
    s.actions.changeSelection("rule7")
    expect(s.store.getState().work.undo).toHaveLength(undo)
  })

  test("チャットの変更案（settings.selection）を承認すると答えたことになり、承認を取り消すと聞き直す", async () => {
    const s = await converted(true)
    const change = { kind: "settings" as const, selection: "all" as const }
    receiveProposal(s.store, { proposal: newProposal("p-sel", { kind: "chat", messageId: "m" }, [change], null), changes: [change] }, "replace")
    await s.actions.decideProposal("p-sel", [0], "applied")
    expect(s.store.getState().work).toMatchObject({ selection: "all", selectionBy: "staff" })
    // 変更案の承認は、ほかの変更も一緒に戻るので「答える」の行からは取り消さない（出どころだけ書く）
    expect(lastSelectionUndo(s.store.getState().work.undo)).toEqual({ kind: "proposal" })
    expect(s.view(s.store.getState()).questionStates[0]).toEqual({ id: "selection", answered: true })
    s.actions.undoWithNotice("p-sel")
    expect(s.store.getState().work).toMatchObject({ selection: "rule7", selectionBy: null })
    expect(lastSelectionUndo(s.store.getState().work.undo)).toBeNull()
    expect(s.view(s.store.getState()).questionStates[0]).toEqual({ id: "selection", answered: false })
  })
})
