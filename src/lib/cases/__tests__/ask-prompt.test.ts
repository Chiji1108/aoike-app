import { describe, expect, test } from "vitest"
import { askPrompt } from "../ask-prompt"

describe("計画の聞き返しの「AI に聞く」", () => {
  test("「AI に聞く」の質問は聞き返しの文と、カードと同じ表の行の数・元の Excel の行番号（シートごと・重ねない・多ければ残りの数）を入れる", () => {
    // 記号の列で分けた行（同じ元の行が表の2行）も表の行で数える。行番号は場所なので重ねない
    expect(askPrompt("備考に注記のある行があります。", [{ sheet: "一覧", row: 11 }, { sheet: "一覧", row: 4 }, { sheet: "一覧", row: 4 }, { sheet: "別", row: 2 }])).toBe(
      "計画の聞き返し「備考に注記のある行があります。」は、どういうことですか？ 対象は表の 4 行（元の Excel の「一覧」5・12行目、「別」3行目）です。中身を見て、判断に要ることを教えてください。",
    )
    const many = [...Array.from({ length: 18 }, (_, row) => ({ sheet: "一覧", row })), ...Array.from({ length: 7 }, (_, row) => ({ sheet: "別", row }))]
    expect(askPrompt("x", many)).toContain("対象は表の 25 行（元の Excel の「一覧」1・2・3・4・5・6・7・8・9・10・11・12・13・14・15・16・17・18行目、「別」1・2行目、ほか 5 行）です。")
  })

  test("対象の行が無ければ質問を作らない（「AI に聞く」を出さない）", () => {
    expect(askPrompt("x", [])).toBeUndefined()
  })
})
