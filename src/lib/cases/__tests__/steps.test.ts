import { expect, test } from "vitest"
import { selectionAdvice } from "../selection-advice"
import { activeView, currentStep, stepDone, tableKindOf } from "../steps"
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

test("載せる工事の案: 去年で決まっていれば聞かない。少ない行・決算書の額より小さい合計は全件、ほかは7割ルール", () => {
  expect(selectionAdvice({ previous: "all", rows: 50, total: 0, basis: {} })).toEqual({ ask: false, mode: "all", note: "去年と同じ: 全件" })
  expect(selectionAdvice({ previous: null, rows: 8, total: 0, basis: {} })).toMatchObject({ ask: true, recommended: "all" })
  expect(selectionAdvice({ previous: null, rows: 40, total: 700, basis: { "01": { total: 1000 } } })).toMatchObject({ ask: true, recommended: "all" })
  expect(selectionAdvice({ previous: null, rows: 40, total: 1000, basis: { "01": { total: 1000 } } })).toMatchObject({ ask: true, recommended: "rule7" })
  expect(selectionAdvice({ previous: null, rows: 40, total: 1000, basis: {} })).toMatchObject({ ask: true, recommended: "rule7" })
})
