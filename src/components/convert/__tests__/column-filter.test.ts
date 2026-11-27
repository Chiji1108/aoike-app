import { describe, expect, test } from "vitest"
import type { CellResult } from "@/lib/convert/convert"
import { BLANK_LABEL, EMPTY_GRID, facetItems, matchesColumnFilter, toneCounts, withColumnFilter, withColumnVisibility } from "../column-filter"

const cell = (status: CellResult["status"], message = ""): CellResult => ({ value: "x", original: "x", source: "x", status, message })

describe("列のフィルター", () => {
  test("値で絞るは外す値に入っていないか（空白は \"\"）、色で絞るはセルの色（AI が補った値は要確認の黄色）", () => {
    expect(matchesColumnFilter("", undefined, { exclude: ["08"] })).toBe(true)
    expect(matchesColumnFilter("08", undefined, { exclude: ["", "08"] })).toBe(false)
    expect(matchesColumnFilter("x", cell("ai", "補った"), { tone: "warning" })).toBe(true)
    expect(matchesColumnFilter("x", cell("ai"), { tone: "warning" })).toBe(false)
    expect(matchesColumnFilter("x", undefined, { tone: "ai" })).toBe(false)
  })

  test("差しかえは足した順を保ち、null で外す", () => {
    let f = withColumnFilter([], "a", { exclude: ["1"] })
    f = withColumnFilter(f, "b", { tone: "error" })
    f = withColumnFilter(f, "a", { tone: "ai" })
    expect(f).toEqual([{ id: "a", value: { tone: "ai" } }, { id: "b", value: { tone: "error" } }])
    expect(withColumnFilter(f, "a", null)).toEqual([{ id: "b", value: { tone: "error" } }])
  })

  test("隠した列の絞り込みと並べ替えは外す", () => {
    const g = { ...EMPTY_GRID, sorting: [{ id: "a", desc: true }], columnFilters: withColumnFilter(withColumnFilter([], "a", { exclude: [] }), "b", { exclude: [] }) }
    const next = withColumnVisibility(g, { a: false, b: true })
    expect(next.columnFilters.map((f) => f.id)).toEqual(["b"])
    expect(next.sorting).toEqual([])
    expect(withColumnVisibility(g, { b: false }).sorting).toEqual([{ id: "a", desc: true }])
  })

  test("値の一覧は表示の値と件数で、数の順・空白は最後", () => {
    const items = facetItems(new Map<unknown, number>([["10", 1], ["", 2], ["2", 3]]), (v) => `名${v}`)
    expect(items).toEqual([
      { value: "2", label: "名2", count: 3 },
      { value: "10", label: "名10", count: 1 },
      { value: "", label: BLANK_LABEL, count: 2 },
    ])
  })

  test("色はその列にある色だけ（そのままは出さない）", () => {
    expect(toneCounts([cell("ok"), cell("error"), cell("error"), cell("changed")])).toEqual([
      { tone: "changed", count: 1 },
      { tone: "error", count: 2 },
    ])
  })
})
