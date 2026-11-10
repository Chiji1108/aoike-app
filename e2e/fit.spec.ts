import ExcelJS from "exceljs"
import { expect, test, type Page } from "@playwright/test"
import { open } from "./helpers"

/** 申込を受け付け、案件の画面に移るまで待つ。共通ID・氏名は毎回違うもの（前の実行がローカルの D1 に残っていても混ざらない） */
async function receive(page: Page, { commonId, name, receivedOn = "2026-11-02" }: { commonId: string; name: string; receivedOn?: string }) {
  await open(page, "/fit")
  await page.getByTestId("fit-new").click()
  await page.getByTestId("fit-received").fill(receivedOn)
  await page.getByTestId("fit-common-id").fill(commonId)
  await page.getByTestId("fit-name").fill(name)
  await page.getByTestId("fit-kana").fill("ミホン タロウ")
  await page.getByTestId("fit-builder").fill("見本住建")
  await page.getByTestId("fit-create").click()
  await expect(page.getByTestId("fit-case-name")).toHaveText(name)
}

async function editProcedure(page: Page, fill: (dialog: Page) => Promise<void>) {
  await page.getByTestId("fit-procedure-edit").first().click()
  await fill(page)
  await page.getByTestId("proc-save").click()
}

/** 案件表の Excel をダウンロードして読む */
async function downloadWeekly(page: Page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("weekly-export").click()])
  expect(download.suggestedFilename()).toMatch(/^FIT案件表_行政書士青池事務所_\d{4}-\d{2}-\d{2}\.xlsx$/)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(await download.path())
  return wb
}

const findRow = (ws: ExcelJS.Worksheet, commonId: string) => {
  let found: ExcelJS.Row | undefined
  ws.eachRow((r) => {
    if (r.getCell(2).value === commonId) found = r
  })
  return found
}

test("FIT: 申込を受け付けると番号が付き、委任状で受任・報酬額が入る。不備は一覧と週次の案件表に出て、変わったセルに印が付く", async ({ page }) => {
  const stamp = Date.now()
  const commonId = `CP${stamp}`
  const name = `見本 太郎${stamp}`
  await receive(page, { commonId, name })
  const number = (await page.getByTestId("fit-procedure-number").textContent())!
  expect(number).toMatch(/^F8-\d{4}$/)
  await expect(page.getByTestId("fit-status")).toHaveText("受付")

  await editProcedure(page, async (p) => {
    await p.getByTestId("proc-poa").fill("2026-11-05")
  })
  await expect(page.getByTestId("fit-status")).toHaveText("受任・準備中")
  await expect(page.getByTestId("fit-procedure")).toContainText("11,000円")
  await expect(page.getByTestId("fit-procedure")).toContainText("2026/11/5")

  await page.getByTestId("defect-add").click()
  await page.getByTestId("defect-content").fill("委任状の押印漏れ")
  await page.getByTestId("defect-save").click()
  await expect(page.getByTestId("defect-row")).toContainText("委任状の押印漏れ")

  // 一覧：共通ID で探すと、この手続の行に不備が出る
  await open(page, "/fit")
  await page.getByTestId("fit-search").fill(commonId)
  const row = page.getByTestId("fit-row")
  await expect(row).toHaveCount(1)
  await expect(row).toContainText(number)
  await expect(row).toContainText("委任状の押印漏れ")
  await expect(row.getByTestId("fit-status")).toHaveText("受任・準備中")

  // 週次の案件表：出すと記録され、この行は「今週の変更」にも入る
  await open(page, "/fit/weekly")
  const first = await downloadWeekly(page)
  expect(first.worksheets.map((w) => w.name)).toEqual(["全件", "今週の変更"])
  const added = findRow(first.getWorksheet("今週の変更")!, commonId)!
  expect(added.getCell(5).value).toBe(number)
  expect(added.getCell(8).value).toBe("委任状の押印漏れ")
  expect((added.getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFDDEBF7")
  // 出したあとは、この行は前回から変わっていない
  await expect(page.getByTestId("weekly-row").filter({ hasText: commonId })).toHaveCount(0)

  // 申請して不備を解決すると、申請日・申請ID・不備内容のセルが変わった印になる
  await open(page, "/fit")
  await page.getByTestId("fit-search").fill(commonId)
  await page.getByTestId("fit-number").click()
  await page.getByTestId("defect-resolve").click()
  await expect(page.getByTestId("defect-row")).toContainText("解決")
  await editProcedure(page, async (p) => {
    await p.getByTestId("proc-applied").fill("2026-11-10")
    await p.getByTestId("proc-application-id").fill(`A-${stamp}`)
  })
  await expect(page.getByTestId("fit-status")).toHaveText("申請中")

  await open(page, "/fit/weekly")
  const changedRow = page.getByTestId("weekly-row").filter({ hasText: commonId })
  await expect(changedRow).toHaveCount(1)
  // 不備内容（8列目）・fit申請日（9列目）・申請ID（10列目）
  await expect(changedRow.locator("td[data-changed]")).toHaveCount(3)
  const second = await downloadWeekly(page)
  const updated = findRow(second.getWorksheet("今週の変更")!, commonId)!
  expect(updated.getCell(10).value).toBe(`A-${stamp}`)
  expect(updated.getCell(9).value).toBeInstanceOf(Date)
  expect((updated.getCell(10).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFFF2CC")
  expect((updated.getCell(1).fill as ExcelJS.FillPattern | undefined)?.fgColor).toBeUndefined()
})

test("FIT: 認定通知書を保存するまで完了通知日を入れられない。同じ共通ID の案件は作れない", async ({ page }) => {
  const stamp = Date.now()
  const commonId = `CP${stamp}`
  await receive(page, { commonId, name: `見本 花子${stamp}` })
  await editProcedure(page, async (p) => {
    await p.getByTestId("proc-poa").fill("2026-11-05")
    await p.getByTestId("proc-applied").fill("2026-11-10")
    await p.getByTestId("proc-approved").fill("2026-12-01")
    await p.getByTestId("proc-completed").fill("2026-12-02")
  })
  await expect(page.getByText("認定通知書を保存してから")).toBeVisible()
  await page.getByTestId("proc-notice-saved").click()
  await page.getByTestId("proc-save").click()
  await expect(page.getByTestId("fit-status")).toHaveText("完了通知済")

  await open(page, "/fit")
  await page.getByTestId("fit-new").click()
  await page.getByTestId("fit-common-id").fill(commonId)
  await page.getByTestId("fit-name").fill(`別の人${stamp}`)
  await page.getByTestId("fit-create").click()
  await expect(page.getByText(`共通ID ${commonId} の案件はもうあります`)).toBeVisible()
})
