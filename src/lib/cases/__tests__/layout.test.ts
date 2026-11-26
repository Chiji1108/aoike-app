import { describe, expect, test } from "vitest"
import { layoutOf, type LayoutInput } from "../layout"

const input = (over: Partial<LayoutInput> = {}): LayoutInput => ({ wide: true, hasTable: true, workReady: true, workChoice: null, chatCollapsed: false, ...over })

describe("layoutOf（チャットと作業の画面の並べ方）", () => {
  test("表が無い間は作業の画面を置かず、チャットを中央に大きく出す（広さ・開いたか・たたんだかによらない）", () => {
    for (const wide of [true, false])
      for (const workChoice of [null, true, false])
        for (const chatCollapsed of [true, false]) {
          const l = layoutOf(input({ wide, hasTable: false, workChoice, chatCollapsed }))
          expect(l).toEqual({ work: null, workShown: false, chat: "full", chatCollapsed: false, covered: false })
        }
  })

  test("広い画面: 決めるまでは作業の画面を横幅いっぱいに置き、チャットは右下の窓", () => {
    expect(layoutOf(input())).toEqual({ work: { place: "inline", shown: true }, workShown: true, chat: "window", chatCollapsed: false, covered: false })
  })

  test("広い画面で窓をたたむと、右下のボタンだけ（作業の画面はそのまま）", () => {
    expect(layoutOf(input({ chatCollapsed: true }))).toEqual({ work: { place: "inline", shown: true }, workShown: true, chat: "window", chatCollapsed: true, covered: false })
  })

  test("広い画面で作業の画面を閉じると、置いたまま隠し、チャットを中央に戻す（たたんだ設定は窓のときだけ効く）", () => {
    expect(layoutOf(input({ workChoice: false }))).toEqual({ work: { place: "inline", shown: false }, workShown: false, chat: "full", chatCollapsed: false, covered: false })
    expect(layoutOf(input({ workChoice: false, chatCollapsed: true })).chatCollapsed).toBe(false)
  })

  test("狭い画面: 窓にしない。決めるまでは作業の画面を閉じておき（チャットを覆わない）、開くと上に重ねてうしろを触れなくする", () => {
    expect(layoutOf(input({ wide: false }))).toEqual({ work: { place: "overlay", shown: false }, workShown: false, chat: "full", chatCollapsed: false, covered: false })
    expect(layoutOf(input({ wide: false, workChoice: true }))).toEqual({ work: { place: "overlay", shown: true }, workShown: true, chat: "full", chatCollapsed: false, covered: true })
    expect(layoutOf(input({ wide: false, workChoice: true, chatCollapsed: true })).chatCollapsed).toBe(false)
  })

  test("幅が変わっても作業の画面は同じものを置いたまま、置き方だけが変わる", () => {
    const wide = layoutOf(input({ workChoice: true }))
    const narrow = layoutOf(input({ wide: false, workChoice: true }))
    expect(wide.work?.shown && narrow.work?.shown).toBe(true)
    expect([wide.work?.place, narrow.work?.place]).toEqual(["inline", "overlay"])
  })

  test("表はあるが行がまだ揃っていない間は置かない（開いているかは表があるかで決まる）。チャットは中央", () => {
    expect(layoutOf(input({ workReady: false, chatCollapsed: true }))).toEqual({ work: null, workShown: true, chat: "full", chatCollapsed: false, covered: false })
  })
})
