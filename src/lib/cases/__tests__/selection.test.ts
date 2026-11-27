import { describe, expect, test } from "vitest"
import { fromSaved, newWork, savedWorkSchema, toSavedWork } from "../state"
import { carrySelection, previousSelection, selectionQuestion, setSelection } from "../selection"
import { undo, undoEntry } from "../undo"
import { selectionAdvice } from "../selection-advice"

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
    // 前の形の alreadyApplied: false は既定値（7割）なので決めていない
    expect(savedWorkSchema.parse(old({ selection: undefined, alreadyApplied: false }))).toMatchObject({ selection: "rule7", selectionBy: null })
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

describe("載せる工事の取り消し（数え方は税と同じ）", () => {
  const work = (selection: "rule7" | "all", by: "staff" | null) => ({ ...newWork("f"), selection, selectionBy: by })
  const entryOf = () => {
    const before = work("rule7", null)
    const after = setSelection(before, "all", "staff")
    const entry = undoEntry(before, after, { id: "u1", proposalId: "selection:1", kind: "op", label: "載せる工事の切り替え", at: 0 })!
    return { after, entry }
  }

  test("そのまま取り消すと1件戻したと数え、出どころも戻る", () => {
    const { after, entry } = entryOf()
    const r = undo({ ...after, undo: [entry] }, "u1")!
    expect(r).toMatchObject({ reverted: 1, kept: 0 })
    expect(r.work).toMatchObject({ selection: "rule7", selectionBy: null })
  })

  test("あとで職員が変えていれば戻さずに残し、残した件数に数える（警告が出る）", () => {
    const { after, entry } = entryOf()
    const changed = setSelection(after, "rule7", "staff")
    const r = undo({ ...changed, undo: [entry] }, "u1")!
    expect(r).toMatchObject({ reverted: 0, kept: 1 })
    expect(r.work).toMatchObject({ selection: "rule7", selectionBy: "staff" })
  })
})

/**
 * 聞くか・答えたか・引き継ぐかの組み合わせ（作業の selectionBy だけで決まる）。
 * 去年: 去年の保存から previousSelection で読む値。今年: 新しい案件（state なし）か、保存した作業（selectionBy が null）か、職員が変えたあと
 */
describe("載せる工事を聞くか・答えたか・引き継ぐか（組み合わせ）", () => {
  const lastYear = {
    none: undefined,
    decided: savedWorkSchema.parse(savedJson({ selection: "all", selectionBy: "staff" })),
    defaulted: savedWorkSchema.parse(savedJson({ selection: "rule7", selectionBy: null })),
  }
  const thisYear = {
    fresh: () => newWork("f"),
    saved: () => fromSaved(savedWorkSchema.parse(savedJson({ selection: "rule7", selectionBy: null })), []),
    staffChanged: () => setSelection(newWork("f"), "rule7", "staff"),
  }
  const cases = [
    { name: "去年なし × 今年は新規", last: lastYear.none, now: thisYear.fresh, isNew: true, selection: "rule7", by: null, question: { answered: false }, recommended: null },
    { name: "去年が決め済み × 今年は新規", last: lastYear.decided, now: thisYear.fresh, isNew: true, selection: "all", by: "previous", question: null, recommended: "all" },
    { name: "去年が決め済み × 今年は保存済み（null）: 変えずに聞き、去年の値をおすすめにする", last: lastYear.decided, now: thisYear.saved, isNew: false, selection: "rule7", by: null, question: { answered: false }, recommended: "all" },
    { name: "去年が既定値のまま × 今年は新規", last: lastYear.defaulted, now: thisYear.fresh, isNew: true, selection: "rule7", by: null, question: { answered: false }, recommended: null },
    { name: "去年が決め済み × 今年に職員が変えたあと", last: lastYear.decided, now: thisYear.staffChanged, isNew: false, selection: "rule7", by: "staff", question: { answered: true }, recommended: "all" },
  ] as const
  test.each(cases)("$name", ({ last, now, isNew, selection, by, question, recommended }) => {
    const previous = previousSelection(last)
    const w = carrySelection(now(), previous, isNew)
    expect(w).toMatchObject({ selection, selectionBy: by })
    expect(selectionQuestion(w.selectionBy)).toEqual(question)
    // おすすめは去年に決めた値（去年が無い・既定値のままなら行の数などで決める。ここは行が多いので7割ルール）
    const advice = selectionAdvice({ previous: last ? { selection: previous } : null, rows: 40, total: 0, basis: {} })
    expect(advice.recommended).toBe(recommended ?? "rule7")
  })
})
