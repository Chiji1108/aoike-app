import { expect, test } from "vitest"
import { downloadHistory, receivedFiles, type CaseFile } from "../types"

const file = (name: string, kind: CaseFile["kind"] = "source", createdAt = 0): CaseFile => ({ id: name, caseId: "c", kind, name, contentType: "", size: 1, createdAt })

test("ファイルの行には届いた（アップロードした）ファイルだけを出し、ダウンロードの控えは履歴に新しい順で出す", () => {
  const files = [
    file("元.xlsx", "source", 1),
    file("工事経歴書_1.csv", "csv", 2),
    file("工事経歴書_1.xlsx", "final_sheet", 3),
    file("返ってきた.xlsx", "source", 4),
    file("工事経歴書_2.csv", "csv", 7),
  ]
  expect(receivedFiles(files).map((f) => f.name)).toEqual(["元.xlsx", "返ってきた.xlsx"])
  expect(downloadHistory(files).map((f) => f.name)).toEqual(["工事経歴書_2.csv", "工事経歴書_1.xlsx", "工事経歴書_1.csv"])
  // 元の並びは変えない
  expect(files[0]!.name).toBe("元.xlsx")
})

test("同じ時刻に残した控えは、後から足したものを先に出す", () => {
  const files = [file("工事経歴書.csv", "csv", 5), file("工事経歴書.xlsx", "final_sheet", 5)]
  expect(downloadHistory(files).map((f) => f.name)).toEqual(["工事経歴書.xlsx", "工事経歴書.csv"])
})
