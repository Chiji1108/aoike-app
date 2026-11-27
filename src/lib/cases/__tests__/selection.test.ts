import { describe, expect, test } from "vitest"
import { fromSaved, newWork, savedWorkSchema, toSavedWork } from "../state"
import { carrySelection, previousSelection, selectionQuestion, setSelection } from "../selection"
import { lastSelectionUndo, undo, undoEntry, type UndoEntry } from "../undo"
import { selectionAdvice } from "../selection-advice"

/** 保存した作業の JSON（今の形）。over で項目を差し替え・消す（undefined） */
const savedJson = (over: Record<string, unknown>) => {
  const json: Record<string, unknown> = { ...toSavedWork({ ...newWork("f"), converted: true }), ...over }
  for (const k of Object.keys(over)) if (over[k] === undefined) delete json[k]
  return JSON.parse(JSON.stringify(json))
}

describe("載せる工事を誰が決めたか（保存の読み方）", () => {
  test("今の形: 既定値のまま（selectionBy が null）なら決めていない、職員が決めたら決めた", () => {
    expect(fromSaved(savedWorkSchema.parse(savedJson({})), [], []).selectionBy).toBeNull()
    expect(fromSaved(savedWorkSchema.parse(toSavedWork(setSelection({ ...newWork("f"), converted: true }, "all", "staff"))), [], []).selectionBy).toBe("staff")
  })

  test("この項目より前の保存（selectionBy が無く、選び方はいつも書いてある）: 全件・前の形の alreadyApplied が true・ダウンロードの控えがあれば決めた値、ほかの7割ルールは聞く", () => {
    // 本当の前の保存の形: selection はいつも書いてあり、selectionBy は無い
    const old = (over: Record<string, unknown>) => savedJson({ selectionBy: undefined, ...over })
    const read = (over: Record<string, unknown>, files: { kind: string }[] = []) => fromSaved(savedWorkSchema.parse(old(over)), [], files)
    expect(old({ selection: "rule7" })).toMatchObject({ selection: "rule7" })
    expect(read({ selection: "rule7" })).toMatchObject({ selection: "rule7", selectionBy: null })
    expect(read({ selection: "all" })).toMatchObject({ selection: "all", selectionBy: "staff" })
    expect(read({ selection: undefined, alreadyApplied: true })).toMatchObject({ selection: "all", selectionBy: "staff" })
    // 前の形の alreadyApplied: false は既定値（7割）なので決めていない
    expect(read({ selection: undefined, alreadyApplied: false })).toMatchObject({ selection: "rule7", selectionBy: null })
    // ダウンロードの控え（CSV・最後の Excel）があれば、その選び方で出したので決めた値（開き直して聞き返さない）。問い合わせの Excel・届いたファイルは見ない
    expect(read({ selection: "rule7" }, [{ kind: "csv" }])).toMatchObject({ selection: "rule7", selectionBy: "staff" })
    expect(read({ selection: "rule7" }, [{ kind: "final_sheet" }])).toMatchObject({ selectionBy: "staff" })
    expect(read({ selection: "rule7" }, [{ kind: "source" }, { kind: "inquiry_sheet" }])).toMatchObject({ selectionBy: null })
    // 今の形（selectionBy がある）は控えがあってもそのまま
    expect(fromSaved(savedWorkSchema.parse(savedJson({ selectionBy: null })), [], [{ kind: "csv" }]).selectionBy).toBeNull()
    // 去年も同じ決まり: 既定の7割ルールのまま控えも無ければ引き継がない（今年は聞く）
    expect(previousSelection(savedWorkSchema.parse(old({ selection: "rule7" })), false)).toBeNull()
    expect(previousSelection(savedWorkSchema.parse(old({ selection: "rule7" })), true)).toBe("rule7")
    expect(previousSelection(savedWorkSchema.parse(old({ selection: "all" })), false)).toBe("all")
  })

  test("翌年に引き継ぐのは、去年に変換して選び方を決めていたときだけ（既定値のままなら今年は聞く）", () => {
    const parse = (over: Record<string, unknown>) => savedWorkSchema.parse(savedJson(over))
    expect(previousSelection(parse({}), false)).toBeNull()
    expect(previousSelection(parse({ selection: "all", selectionBy: "staff" }), false)).toBe("all")
    expect(previousSelection(parse({ selection: "rule7", selectionBy: "previous" }), false)).toBe("rule7")
    expect(previousSelection(parse({ selection: "all", selectionBy: "staff", converted: false }), false)).toBeNull()
    expect(previousSelection(undefined, false)).toBeNull()
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
    saved: () => fromSaved(savedWorkSchema.parse(savedJson({ selection: "rule7", selectionBy: null })), [], []),
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
    const previous = previousSelection(last, false)
    const w = carrySelection(now(), previous, isNew)
    expect(w).toMatchObject({ selection, selectionBy: by })
    expect(selectionQuestion(w.selectionBy)).toEqual(question)
    // おすすめは去年に決めた値（去年が無い・既定値のままなら行の数などで決める。ここは行が多いので7割ルール）
    const advice = selectionAdvice({ previous: last ? { selection: previous } : null, rows: 40, summary: [] })
    expect(advice.recommended).toBe(recommended ?? "rule7")
  })
})

describe("「答える」の載せる工事の行の取り消し（lastSelectionUndo）", () => {
  const entry = (proposalId: string, over: Partial<UndoEntry> = {}): UndoEntry => ({
    id: proposalId,
    proposalId,
    label: "",
    at: 0,
    edits: [],
    manual: [],
    added: [],
    external: [],
    selection: [
      { selection: "rule7", selectionBy: null },
      { selection: "all", selectionBy: "staff" },
    ],
    ...over,
  })
  test("選び方だけを変えた記録（答える・切り替え）は取り消せ、変更案の承認は出どころだけ（行からは取り消さない）", () => {
    expect(lastSelectionUndo([entry("report:selection")])).toEqual({ kind: "undo", proposalId: "report:selection" })
    expect(lastSelectionUndo([entry("report:selection"), entry("selection:1")])).toEqual({ kind: "undo", proposalId: "selection:1" })
    expect(lastSelectionUndo([entry("selection:1"), entry("p-chat")])).toEqual({ kind: "proposal" })
  })
  test("取り消した記録・中身を捨てた記録・選び方を変えていない記録は見ない", () => {
    expect(lastSelectionUndo([entry("selection:1"), entry("selection:2", { undone: true })])).toEqual({ kind: "undo", proposalId: "selection:1" })
    expect(lastSelectionUndo([entry("selection:1"), entry("selection:2", { tooLarge: true })])).toEqual({ kind: "undo", proposalId: "selection:1" })
    expect(lastSelectionUndo([entry("selection:1"), entry("report:tax", { selection: undefined, tax: [{ tax: "unknown", taxBy: null }, { tax: "included", taxBy: "staff" }] })])).toEqual({ kind: "undo", proposalId: "selection:1" })
    expect(lastSelectionUndo([])).toBeNull()
  })
})

test("前の版の取り消しの記録（値だけ）も、作業と同じ控えの有無で出どころを読むので、控えのある前の保存でも取り消すと戻る", () => {
  // 前の形: 全件から7割ルールに戻した記録（値だけ）があり、作業は7割ルール・selectionBy なし・ダウンロードの控えあり
  const legacyEntry = { id: "u1", proposalId: "selection:1", kind: "op", label: "載せる工事の切り替え", at: 0, edits: [], manual: [], added: [], external: [], selection: ["all", "rule7"] }
  const json = savedJson({ selectionBy: undefined, selection: "rule7", undo: [legacyEntry] })
  const w = fromSaved(savedWorkSchema.parse(json), [], [{ kind: "csv" }])
  expect(w).toMatchObject({ selection: "rule7", selectionBy: "staff" })
  expect(w.undo[0]!.selection).toEqual([
    { selection: "all", selectionBy: "staff" },
    { selection: "rule7", selectionBy: "staff" },
  ])
  const r = undo(w, "u1")!
  expect(r).toMatchObject({ reverted: 1, kept: 0 })
  expect(r.work).toMatchObject({ selection: "all", selectionBy: "staff" })
  // 控えが無ければ7割ルールは既定値（null）と読み、作業も記録も同じなので、やはり戻る
  const w2 = fromSaved(savedWorkSchema.parse(json), [], [])
  expect(undo(w2, "u1")).toMatchObject({ reverted: 1, work: { selection: "all", selectionBy: "staff" } })
})
