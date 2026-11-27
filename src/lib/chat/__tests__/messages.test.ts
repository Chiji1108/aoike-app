import { describe, expect, test } from "vitest"
import { chatDataSchemas, currentAction } from "../messages"

describe("保存した会話のボタン", () => {
  test("前の edit_excel（編集用の Excel）も読め、ダウンロードの前の確認のボタンになる", () => {
    expect(chatDataSchemas.action.parse({ action: "edit_excel" })).toEqual({ action: "edit_excel" })
    expect(currentAction("edit_excel")).toBe("export")
    expect(currentAction("export")).toBe("export")
    expect(chatDataSchemas.action.safeParse({ action: "nope" }).success).toBe(false)
  })
})
