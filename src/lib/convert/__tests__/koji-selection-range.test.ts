import { describe, expect, test } from "vitest"
import { manualIncludedCount, rangeToggle, type Inclusion } from "../koji-selection"

const inc = (entries: [string, Inclusion][]) => new Map(entries)
const ON_RULE7: Inclusion = { included: true, reason: "rule7" }
const OFF: Inclusion = { included: false, reason: "unselected" }
const EXCLUDED: Inclusion = { included: false, reason: "excluded" }
const MANUAL_ON: Inclusion = { included: true, reason: "manual" }

describe("rangeToggle（Shift＋クリックの範囲）", () => {
  const order = ["a", "b", "c", "d", "e"]
  const inclusion = inc([
    ["a", ON_RULE7],
    ["b", OFF],
    ["c", EXCLUDED],
    ["d", OFF],
    ["e", ON_RULE7],
  ])

  test("前に押した行から今の行までを今の向きにそろえる。もうその向きの行は手動にしない", () => {
    expect(rangeToggle(order, "a", "d", true, inclusion)).toEqual({ keys: ["b", "d"], skippedExcluded: 1 })
  })
  test("下から上へ押しても同じ範囲", () => {
    expect(rangeToggle(order, "e", "b", false, inclusion)).toEqual({ keys: ["e"], skippedExcluded: 0 })
  })
  test("外す向きでは除外の行はもう外れているので数えない", () => {
    expect(rangeToggle(order, "a", "e", false, inclusion)).toEqual({ keys: ["a", "e"], skippedExcluded: 0 })
  })
  test("前に押した行が今の並びに無ければ（絞り込みで消えた）範囲にしない", () => {
    expect(rangeToggle(["b", "d"], "a", "d", true, inclusion)).toBeNull()
  })
})

test("manualIncludedCount は手で載せた行だけを数える", () => {
  expect(manualIncludedCount(inc([["a", MANUAL_ON], ["b", ON_RULE7], ["c", { included: false, reason: "manual" }], ["d", MANUAL_ON]]))).toBe(2)
})
