import { describe, expect, test } from "vitest"
import { newWork, savedWorkSchema, toSavedWork } from "../state"
import { previousSelection, setSelection } from "../selection"

/** 保存した作業の JSON（今の形）。over で項目を差し替え・消す（undefined） */
const savedJson = (over: Record<string, unknown>) => {
  const json: Record<string, unknown> = { ...toSavedWork({ ...newWork("f"), converted: true }), ...over }
  for (const k of Object.keys(over)) if (over[k] === undefined) delete json[k]
  return JSON.parse(JSON.stringify(json))
}

describe("載せる工事を誰が決めたか（保存の読み方）", () => {
  test("今の形: 既定値のまま（selectionBy が null）なら決めていない、職員が決めたら決めた", () => {
    expect(savedWorkSchema.parse(savedJson({})).selectionBy).toBeNull()
    expect(savedWorkSchema.parse(toSavedWork(setSelection({ ...newWork("f"), converted: true }, "all", "staff"))).selectionBy).toBe("staff")
  })

  test("この項目より前の保存（selectionBy が無く、選び方はいつも書いてある）: 全件か前の形の alreadyApplied は職員が決めた値、7割ルールだけなら既定値のまま（聞く）", () => {
    // 本当の前の保存の形: selection はいつも書いてあり、selectionBy は無い
    const old = (over: Record<string, unknown>) => savedJson({ selectionBy: undefined, ...over })
    expect(old({ selection: "rule7" })).toMatchObject({ selection: "rule7" })
    expect(savedWorkSchema.parse(old({ selection: "rule7" }))).toMatchObject({ selection: "rule7", selectionBy: null })
    expect(savedWorkSchema.parse(old({ selection: "all" }))).toMatchObject({ selection: "all", selectionBy: "staff" })
    expect(savedWorkSchema.parse(old({ selection: undefined, alreadyApplied: true }))).toMatchObject({ selection: "all", selectionBy: "staff" })
    expect(savedWorkSchema.parse(old({ selection: undefined, alreadyApplied: false }))).toMatchObject({ selection: "rule7", selectionBy: "staff" })
    // 既定の7割ルールのまま保存した去年は引き継がない（今年は聞く）
    expect(previousSelection(savedWorkSchema.parse(old({ selection: "rule7" })))).toBeNull()
    expect(previousSelection(savedWorkSchema.parse(old({ selection: "all" })))).toBe("all")
  })

  test("翌年に引き継ぐのは、去年に変換して選び方を決めていたときだけ（既定値のままなら今年は聞く）", () => {
    const parse = (over: Record<string, unknown>) => savedWorkSchema.parse(savedJson(over))
    expect(previousSelection(parse({}))).toBeNull()
    expect(previousSelection(parse({ selection: "all", selectionBy: "staff" }))).toBe("all")
    expect(previousSelection(parse({ selection: "rule7", selectionBy: "previous" }))).toBe("rule7")
    expect(previousSelection(parse({ selection: "all", selectionBy: "staff", converted: false }))).toBeNull()
    expect(previousSelection(undefined)).toBeNull()
  })
})
