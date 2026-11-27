import { expect, test } from "vitest"
import { kojiRow } from "../../convert/__tests__/helpers"
import { summarizeKoji } from "../../convert/koji-selection"
import { selectionAdvice } from "../selection-advice"

/** 業種ごとの集計の1行（表の合計 total と、決算書の額 book〔無ければ入れていない〕。どちらも7割の計算の税の千円） */
const g = (total: number, book?: number) => ({ total, basis: { total: book ?? total, motouke: 0 }, fromBook: { total: book !== undefined, motouke: false } })
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
  expect(selectionAdvice({ previous: null, rows: 8, summary: [] })).toMatchObject({ recommended: "all" })
  expect(selectionAdvice({ previous: null, rows: 40, summary: [g(700, 1000)] })).toMatchObject({ recommended: "all" })
  expect(selectionAdvice({ previous: null, rows: 40, summary: [g(1000, 1000)] })).toMatchObject({ recommended: "rule7" })
  expect(selectionAdvice({ previous: null, rows: 40, summary: [g(1000)] })).toMatchObject({ recommended: "rule7" })
})

test("載せる工事のおすすめの理由は去年に合わせる: 去年に決めていれば去年の値、去年があって決めていなければ「初めての顧客」と言わない", () => {
  expect(selectionAdvice({ previous: { selection: "all" }, rows: 40, summary: [] })).toEqual({ recommended: "all", reason: "去年は全件でした" })
  expect(selectionAdvice({ previous: { selection: "rule7" }, rows: 3, summary: [] })).toEqual({ recommended: "rule7", reason: "去年は7割ルールでした" })
  expect(selectionAdvice({ previous: { selection: null }, rows: 40, summary: [] }).reason).toBe("去年は選び方を決めていなかったので、7割ルールから始めます")
  expect(selectionAdvice({ previous: null, rows: 40, summary: [] }).reason).toBe("初めての顧客は7割ルールから始めます")
})

test("次の段は、その段より後ろの最初の済んでいない段（前の段が残っていても戻らない）。無ければダウンロード", () => {
  expect(nextStep(todo({ fix: 2 }), "answer")).toBe("fix")
  expect(nextStep(todo({ answer: 1, inquiry: "todo" }), "gyoshu")).toBe("inquiry")
  expect(nextStep(todo({ answer: 1 }), "fix")).toBe("export")
  expect(nextStep(todo({}), "inquiry")).toBe("export")
})

test("決算書の額と比べるのは、決算書の額を入れた業種の行だけ（入れていない業種の合計は足さない）", () => {
  // 入れた業種は 850／1000（85%）。入れていない業種の 5000 を足すと 85% を超えてしまうが、足さない
  expect(selectionAdvice({ previous: null, rows: 40, summary: [g(850, 1000), g(5000)] })).toMatchObject({ recommended: "all" })
  expect(selectionAdvice({ previous: null, rows: 40, summary: [g(400, 500), g(451, 500)] })).toMatchObject({ recommended: "rule7" })
  expect(selectionAdvice({ previous: null, rows: 40, summary: [g(400, 500), g(450, 500)] })).toMatchObject({ recommended: "all" })
})

test("決算書の額と比べる金額は7割の計算の税にそろえる（表が税込・基準が税抜なら 1.1 で割ってから比べる）", () => {
  // 税込 935 千円 ＝ 税抜 850 千円。決算書の額（税抜）1000 千円の 85% ちょうどなので全件をすすめる（税込のまま比べると 93.5% で7割ルールになる）
  const rows = Array.from({ length: 20 }, (_, i) => kojiRow({ gyoshu: "8", motoukeShitauke: "1", amount: i === 0 ? "935" : "0" }, i))
  const summary = (amountTax: "included" | "excluded") => summarizeKoji(rows, new Map(), { tax: amountTax, basis: { "8": { total: 1000 } }, rule7Tax: "excluded" })
  expect(selectionAdvice({ previous: null, rows: 20, summary: summary("included") })).toMatchObject({ recommended: "all" })
  expect(selectionAdvice({ previous: null, rows: 20, summary: summary("excluded") })).toMatchObject({ recommended: "rule7" })
})

test("全件をすすめる閾値: 行が FEW_ROWS 行以下、または表の合計が決算書の額の FILTERED_RATIO 以下", () => {
  expect([FEW_ROWS, FILTERED_RATIO]).toEqual([12, 0.85])
  expect(selectionAdvice({ previous: null, rows: FEW_ROWS, summary: [] })).toMatchObject({ recommended: "all" })
  expect(selectionAdvice({ previous: null, rows: FEW_ROWS + 1, summary: [] })).toMatchObject({ recommended: "rule7" })
  expect(selectionAdvice({ previous: null, rows: 40, summary: [g(850, 1000)] })).toMatchObject({ recommended: "all" })
  expect(selectionAdvice({ previous: null, rows: 40, summary: [g(851, 1000)] })).toMatchObject({ recommended: "rule7" })
})
