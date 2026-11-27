import { describe, expect, test } from "vitest"
import { fromSaved, newWork, savedWorkSchema, toSavedWork } from "../state"
import { setSelection } from "../selection"
import { selectionAdvice } from "../selection-advice"
import { reportQuestionStates } from "../todo"
import { undo, undoEntry } from "../undo"

/** 保存した作業の JSON（今の形）。over で項目を差し替え・消す（undefined） */
const savedJson = (over: Record<string, unknown>) => {
  const json: Record<string, unknown> = { ...toSavedWork({ ...newWork("f"), converted: true }), ...over }
  for (const k of Object.keys(over)) if (over[k] === undefined) delete json[k]
  return JSON.parse(JSON.stringify(json))
}

describe("載せる工事に答えたか（保存の読み方）", () => {
  test("今の形: 答えたかをそのまま読む", () => {
    expect(fromSaved(savedWorkSchema.parse(savedJson({})), []).selectionAnswered).toBe(false)
    expect(fromSaved(savedWorkSchema.parse(toSavedWork(setSelection({ ...newWork("f"), converted: true }, "all", true))), [])).toMatchObject({ selection: "all", selectionAnswered: true })
  })

  test("前の形（答えたかが無い・alreadyApplied の形・値だけの取り消しの記録・この PR の途中の selectionBy の形）は読めない（移行 drizzle/csv/0011 でそろえる）", () => {
    expect(savedWorkSchema.safeParse(savedJson({ selectionAnswered: undefined })).success).toBe(false)
    expect(savedWorkSchema.safeParse(savedJson({ selectionAnswered: undefined, selectionBy: "staff" })).success).toBe(false)
    expect(savedWorkSchema.safeParse(savedJson({ selectionAnswered: undefined, selection: undefined, alreadyApplied: true })).success).toBe(false)
    const legacyUndo = { id: "u1", proposalId: "selection:1", kind: "op", label: "", at: 0, edits: [], manual: [], added: [], external: [], selection: ["all", "rule7"] }
    expect(savedWorkSchema.safeParse(savedJson({ undo: [legacyUndo] })).success).toBe(false)
  })
})

describe("載せる工事の取り消し（数え方は税と同じ）", () => {
  const entryOf = () => {
    const before = newWork("f")
    const after = setSelection(before, "all", true)
    const entry = undoEntry(before, after, { id: "u1", proposalId: "selection:1", kind: "op", label: "載せる工事の切り替え", at: 0 })!
    return { after, entry }
  }

  test("そのまま取り消すと1件戻したと数え、答えたかも戻る", () => {
    const { after, entry } = entryOf()
    const r = undo({ ...after, undo: [entry] }, "u1")!
    expect(r).toMatchObject({ reverted: 1, kept: 0 })
    expect(r.work).toMatchObject({ selection: "rule7", selectionAnswered: false })
  })

  test("あとで職員が変えていれば戻さずに残し、残した件数に数える（警告が出る）", () => {
    const { after, entry } = entryOf()
    const changed = setSelection(after, "rule7", true)
    const r = undo({ ...changed, undo: [entry] }, "u1")!
    expect(r).toMatchObject({ reverted: 0, kept: 1 })
    expect(r.work).toMatchObject({ selection: "rule7", selectionAnswered: true })
  })
})

/**
 * 載せる工事は去年から引き継がず、どの案件でも1回聞く。去年の選び方はおすすめ（と理由）に出すだけ
 */
describe("載せる工事を聞くか・答えたか・おすすめ（組み合わせ）", () => {
  const base = { hasTable: true, tax: "included" as const, taxBy: "plan" as const, reportAnswers: {}, asks: [] }
  const cases = [
    { name: "去年なし", previous: null, answered: false, recommended: "rule7", reason: "初めての顧客は7割ルールから始めます" },
    { name: "去年は全件", previous: { selection: "all" }, answered: false, recommended: "all", reason: "去年は全件でした" },
    { name: "去年は7割ルール", previous: { selection: "rule7" }, answered: false, recommended: "rule7", reason: "去年は7割ルールでした" },
    { name: "去年は表を出していない", previous: { selection: null }, answered: false, recommended: "rule7", reason: "去年は表を出していなかったので、7割ルールから始めます" },
    { name: "去年は全件 × 今年に答えたあと", previous: { selection: "all" }, answered: true, recommended: "all", reason: "去年は全件でした" },
  ] as const
  test.each(cases)("$name", ({ previous, answered, recommended, reason }) => {
    // 新しい作業は去年に関わらず7割ルール（既定値）のまま、まだ答えていない
    const fresh = newWork("f")
    expect(fresh).toMatchObject({ selection: "rule7", selectionAnswered: false })
    const w = answered ? setSelection(fresh, "rule7", true) : fresh
    expect(reportQuestionStates({ ...base, selectionAnswered: w.selectionAnswered })[0]).toEqual({ id: "selection", answered })
    expect(selectionAdvice({ previous, rows: 40, summary: [] })).toEqual({ recommended, reason })
  })
})
