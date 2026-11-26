import { describe, expect, test } from "vitest"
import { layoutOf, type LayoutInput } from "../layout"

const input = (over: Partial<LayoutInput> = {}): LayoutInput => ({ wide: true, hasTable: true, workReady: true, workChoice: null, ...over })

describe("layoutOf（チャットと作業の画面の並べ方）", () => {
  test("表が無い間は作業の画面を置かず、チャットを中央に大きく出す（広さ・開いたかによらない）", () => {
    for (const wide of [true, false])
      for (const workChoice of [null, true, false]) {
        const l = layoutOf(input({ wide, hasTable: false, workChoice }))
        expect(l).toEqual({ work: null, workShown: false, chat: "full", covered: false })
      }
  })

  test("広い画面: 決めるまでは作業の画面をチャットの右に並べ、チャットは細い列", () => {
    expect(layoutOf(input())).toEqual({ work: { place: "side", shown: true }, workShown: true, chat: "column", covered: false })
  })

  test("広い画面で閉じると、作業の画面は置いたまま隠し、チャットを中央に戻す", () => {
    expect(layoutOf(input({ workChoice: false }))).toEqual({ work: { place: "side", shown: false }, workShown: false, chat: "full", covered: false })
  })

  test("狭い画面: 決めるまでは作業の画面を閉じておき（チャットを覆わない）、開くと上に重ねてうしろを触れなくする", () => {
    expect(layoutOf(input({ wide: false }))).toEqual({ work: { place: "overlay", shown: false }, workShown: false, chat: "full", covered: false })
    expect(layoutOf(input({ wide: false, workChoice: true }))).toEqual({ work: { place: "overlay", shown: true }, workShown: true, chat: "full", covered: true })
  })

  test("幅が変わっても作業の画面は同じものを置いたまま、置き方だけが変わる", () => {
    const wide = layoutOf(input({ workChoice: true }))
    const narrow = layoutOf(input({ wide: false, workChoice: true }))
    expect(wide.work?.shown && narrow.work?.shown).toBe(true)
    expect([wide.work?.place, narrow.work?.place]).toEqual(["side", "overlay"])
  })

  test("表はあるが行がまだ揃っていない間は置かない（開いているかは表があるかで決まる）", () => {
    expect(layoutOf(input({ workReady: false }))).toEqual({ work: null, workShown: true, chat: "full", covered: false })
  })
})
