import { describe, expect, test } from "vitest"
import { caseTableWireSchema } from "../wire"

describe("チャットに送る表の形", () => {
  test("7割の計算が無い前の形（デプロイの前から開いていた画面）も読み、税抜にする", () => {
    const old = { rows: [], added: [], edits: [], replacements: {}, manual: [], tax: "unknown", basis: {}, selection: "rule7" }
    const parsed = caseTableWireSchema.safeParse(old)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.rule7Tax).toBe("excluded")
    expect(caseTableWireSchema.parse({ ...old, rule7Tax: "included" }).rule7Tax).toBe("included")
  })

  test("載せる工事を誰が決めたかの無い前の形は分からない（undefined）と読み、まだ誰も決めていない（null）とは分ける", () => {
    const old = { rows: [], added: [], edits: [], replacements: {}, manual: [], tax: "unknown", basis: {}, selection: "rule7" }
    expect(caseTableWireSchema.parse(old).selectionBy).toBeUndefined()
    expect(caseTableWireSchema.parse({ ...old, selectionBy: null }).selectionBy).toBeNull()
    expect(caseTableWireSchema.parse({ ...old, selectionBy: "staff" }).selectionBy).toBe("staff")
  })
})
