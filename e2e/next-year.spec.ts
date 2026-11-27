import ExcelJS from "exceljs"
import { expect, test } from "@playwright/test"
import { fileBytes, attachAndConvert, callsServerFn, csvCount, deleteCustomer, openNewCase, openTab, showAllRows } from "./helpers"

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname

/**
 * 翌年の形の Excel（合成）: 見出しの名前を変え（発注者 → 注文者）、2つの列を入れ替え（工期 ⇄ 完成日）、列を足す（担当部署）
 */
async function nextYearWorkbook() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(fileBytes(FIXTURE))
  const ws = wb.getWorksheet("工事経歴")!
  const header = ws.getRow(3)
  const col = (h: string) => (header.values as unknown[]).findIndex((v) => v === h)
  const [period, end] = [col("工期"), col("完成日")]
  ws.getCell(3, col("発注者")).value = "注文者"
  for (let r = 3; r <= ws.rowCount; r++) {
    const a = ws.getCell(r, period).value
    ws.getCell(r, period).value = ws.getCell(r, end).value
    ws.getCell(r, end).value = a
    if (ws.getCell(r, 1).value !== null) ws.getCell(r, 12).value = r === 3 ? "担当部署" : "工務部"
  }
  return { name: "令和6年度_工事経歴.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await wb.xlsx.writeBuffer()) }
}


const created: string[] = []
const pageErrors: string[] = []
test.beforeEach(({ page }) => {
  pageErrors.length = 0
  page.on("pageerror", (e) => pageErrors.push(e.message))
})
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" })
  for (const customer of created.splice(0)) await deleteCustomer(page, customer)
  expect(pageErrors).toEqual([])
})

test("同じ顧客の2年度目は列の計画の AI に去年の列の対応を添える。全件の切り替えで載る件数が変わる", async ({ page }) => {
  const { customer } = await openNewCase(page, "2025")
  created.push(customer)
  await attachAndConvert(page, FIXTURE, { table: false })
  // 2025年度は載せる工事を聞かれ、7割ルールと答える（翌年はこの選び方をおすすめに出す）
  await page.locator('[data-testid="answer-section"] [data-question="selection"] [data-value="rule7"]').click()
  await expect(page.locator('[data-testid="answer-section"] [data-question="selection"]')).toHaveAttribute("data-answered", "7割ルール")
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 30_000 })

  await test.step("2026年度の案件で、形を変えた Excel を付けると列の計画の AI に去年の列の対応を添える", async () => {
    await page.getByRole("link", { name: customer }).click()
    await page.getByLabel("年度").fill("2026")
    await page.getByTestId("create-case").click()
    await expect(page.getByRole("heading", { name: `${customer} 2026年度` })).toBeVisible()
    // 列の計画の AI には、去年の列の対応を参考として添える
    const planBodies: string[] = []
    page.on("request", (r) => {
      if (callsServerFn(r.url(), ["planWithAi"])) planBodies.push(r.postData() ?? "")
    })
    await attachAndConvert(page, await nextYearWorkbook())
    expect(planBodies).toHaveLength(1)
    expect(planBodies[0]).toContain("去年（2025年度）の列の対応")
  })

  await test.step("載せる工事は去年から引き継がず今年も聞く。去年（2025年度）の選び方はおすすめと理由に出す", async () => {
    await openTab(page, "answer")
    const q = page.locator('[data-testid="answer-section"] [data-question="selection"]')
    await expect(q).toHaveAttribute("data-pending", "1")
    await expect(q.locator('[data-value="rule7"]')).toHaveText("7割ルール（おすすめ）")
    await expect(q.getByTestId("report-question-detail")).toContainText("去年は7割ルールでした")
  })

  await test.step("全件を載せる切り替えで、載る件数が変わり、戻すと元の件数", async () => {
    const rule7 = await csvCount(page)
    await openTab(page, "selection")
    await page.getByTestId("selection-all").click()
    await expect.poll(() => csvCount(page)).toBeGreaterThan(rule7)
    const all = await csvCount(page)
    await showAllRows(page)
    // 表はほかの段から戻ると描き直すので、描き終えるまで待つ
    await expect(page.locator('[data-testid="preview-table"] tbody tr[data-row-key][data-included="1"]')).toHaveCount(all)
    await openTab(page, "selection")
    await page.getByTestId("selection-rule7").click()
    await expect.poll(() => csvCount(page)).toBe(rule7)
  })
})
