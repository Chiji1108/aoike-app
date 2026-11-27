import { expect, test } from "vitest"
import { selectionAdvice } from "../selection-advice"
import { FEW_ROWS, FILTERED_RATIO } from "../selection-advice"
import { activeView, currentStep, nextStep, stepDone, tableKindOf } from "../steps"
import type { CaseTodo } from "../todo"

const todo = (over: Partial<{ answer: number; gyoshu: number; fix: number; inquiry: CaseTodo["inquiry"]["state"] }>): CaseTodo =>
  ({
    answer: Array.from({ length: over.answer ?? 0 }, (_, i) => ({ kind: "question", id: `q${i}` })),
    gyoshu: { rows: Array.from({ length: over.gyoshu ?? 0 }), pending: new Map() },
    fix: { rows: over.fix ?? 0, all: 10, byKind: {} },
    fixActions: [],
    inquiry: { active: 1, left: 1, state: over.inquiry ?? "done" },
    location: { open: 0 },
    exportRows: 5,
    badges: { gyoshu: 0, inquiry: 0, location: 0 },
  }) as unknown as CaseTodo

test("今の段は最初の済んでいない段。選ぶまでは今の段を開き、選べばどの段でも開ける", () => {
  expect(currentStep(todo({ answer: 1, fix: 2 }))).toBe("answer")
  expect(currentStep(todo({ fix: 2 }))).toBe("fix")
  expect(currentStep(todo({ inquiry: "waiting" }))).toBe("inquiry")
  expect(currentStep(todo({}))).toBe("export")
  expect(stepDone(todo({}), "export")).toBe(false)
  expect(activeView(null, todo({ gyoshu: 3 }))).toBe("gyoshu")
  expect(activeView("table", todo({ gyoshu: 3 }))).toBe("table")
  expect(tableKindOf("fix")).toBe("fix")
  expect(tableKindOf("table")).toBe("all")
})

test("載せる工事のおすすめ: 少ない行・決算書の額より小さい合計は全件、ほかは7割ルール", () => {
  expect(selectionAdvice({ previous: null, rows: 8, total: 0, basis: {} })).toMatchObject({ recommended: "all" })
  expect(selectionAdvice({ previous: null, rows: 40, total: 700, basis: { "01": { total: 1000 } } })).toMatchObject({ recommended: "all" })
  expect(selectionAdvice({ previous: null, rows: 40, total: 1000, basis: { "01": { total: 1000 } } })).toMatchObject({ recommended: "rule7" })
  expect(selectionAdvice({ previous: null, rows: 40, total: 1000, basis: {} })).toMatchObject({ recommended: "rule7" })
})

test("載せる工事のおすすめの理由は去年に合わせる: 去年に決めていれば去年の値、去年があって決めていなければ「初めての顧客」と言わない", () => {
  expect(selectionAdvice({ previous: { selection: "all" }, rows: 40, total: 0, basis: {} })).toEqual({ recommended: "all", reason: "去年は全件でした" })
  expect(selectionAdvice({ previous: { selection: "rule7" }, rows: 3, total: 0, basis: {} })).toEqual({ recommended: "rule7", reason: "去年は7割ルールでした" })
  expect(selectionAdvice({ previous: { selection: null }, rows: 40, total: 0, basis: {} }).reason).toBe("去年は選び方を決めていなかったので、7割ルールから始めます")
  expect(selectionAdvice({ previous: null, rows: 40, total: 0, basis: {} }).reason).toBe("初めての顧客は7割ルールから始めます")
})

test("次の段は、その段より後ろの最初の済んでいない段（前の段が残っていても戻らない）。無ければダウンロード", () => {
  expect(nextStep(todo({ fix: 2 }), "answer")).toBe("fix")
  expect(nextStep(todo({ answer: 1, inquiry: "todo" }), "gyoshu")).toBe("inquiry")
  expect(nextStep(todo({ answer: 1 }), "fix")).toBe("export")
  expect(nextStep(todo({}), "inquiry")).toBe("export")
})

test("全件をすすめる閾値: 行が FEW_ROWS 行以下、または表の合計が決算書の額の FILTERED_RATIO 以下", () => {
  expect([FEW_ROWS, FILTERED_RATIO]).toEqual([12, 0.85])
  expect(selectionAdvice({ previous: null, rows: FEW_ROWS, total: 0, basis: {} })).toMatchObject({ recommended: "all" })
  expect(selectionAdvice({ previous: null, rows: FEW_ROWS + 1, total: 0, basis: {} })).toMatchObject({ recommended: "rule7" })
  expect(selectionAdvice({ previous: null, rows: 40, total: 850, basis: { "01": { total: 1000 } } })).toMatchObject({ recommended: "all" })
  expect(selectionAdvice({ previous: null, rows: 40, total: 851, basis: { "01": { total: 1000 } } })).toMatchObject({ recommended: "rule7" })
})
