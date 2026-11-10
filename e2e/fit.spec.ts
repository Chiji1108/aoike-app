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
  await open(page, "/fit/procedures")
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
  await open(page, "/fit/procedures")
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

async function saveSealWarnDays(page: Page, days: string) {
  await open(page, "/fit/settings")
  await page.getByTestId("setting-sealWarnDays").fill(days)
  await page.getByTestId("settings-save").click()
  await expect(page.getByText("設定を保存しました")).toBeVisible()
}

/** 日本時間の今日から days 日・months か月ずらした日（YYYY-MM-DD） */
function shifted({ days = 0, months = 0 }: { days?: number; months?: number }) {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  d.setUTCMonth(d.getUTCMonth() + months)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

test("FIT: トップに期限が近いもの（印鑑証明）と住所確定待ちが出る。注意の日数は設定で変えられる", async ({ page }) => {
  const stamp = Date.now()
  const name = `見本 次郎${stamp}`
  await receive(page, { commonId: `CP${stamp}`, name, receivedOn: shifted({}) })
  // 印鑑証明は発行から3か月：期限まであと5日になるよう、3か月と5日前の発行にする
  await editProcedure(page, async (p) => {
    await p.getByTestId("proc-kind").selectOption("post_change")
    await p.getByTestId("proc-seal").fill(shifted({ months: -3, days: 5 }))
  })
  const number = (await page.getByTestId("fit-procedure-number").textContent())!

  await open(page, "/fit")
  const alert = page.getByTestId("fit-alerts").getByRole("link").filter({ hasText: number })
  await expect(alert.getByTestId("fit-alert")).toHaveAttribute("data-kind", "seal")
  await expect(alert.getByTestId("fit-alert")).toHaveAttribute("data-level", "warn")
  await expect(alert).toContainText("あと5日")
  // 件数から一覧を開くと、その状況で絞り込まれる
  await page.getByTestId("fit-count-received").click()
  await expect(page).toHaveURL(/\/fit\/procedures\?status=received/)
  await expect(page.getByTestId("fit-status-filter")).toHaveValue("received")

  // 注意の日数を3日にすると出なくなる（途中で落ちても、ローカルの設定は元の14日に戻す）
  try {
    await saveSealWarnDays(page, "3")
    await open(page, "/fit")
    await expect(page.getByTestId("fit-alerts").getByRole("link").filter({ hasText: number })).toHaveCount(0)
  } finally {
    await saveSealWarnDays(page, "14")
  }

  // 地番で申請した新規認定が認定されると、住所確定待ちに出る
  const lotName = `見本 三郎${stamp}`
  await open(page, "/fit")
  await page.getByTestId("fit-new").click()
  await page.getByTestId("fit-common-id").fill(`CP${stamp}9`)
  await page.getByTestId("fit-name").fill(lotName)
  await page.getByTestId("fit-site-kind").selectOption("lot")
  await page.getByTestId("fit-create").click()
  await expect(page.getByTestId("fit-case-name")).toHaveText(lotName)
  await editProcedure(page, async (p) => {
    await p.getByTestId("proc-poa").fill(shifted({}))
    await p.getByTestId("proc-applied").fill(shifted({}))
    await p.getByTestId("proc-approved").fill(shifted({}))
    await p.getByTestId("proc-notice-saved").click()
  })
  await expect(page.getByTestId("fit-status")).toHaveText("認定済")
  await open(page, "/fit")
  await expect(page.getByTestId("fit-address-pending")).toContainText(lotName)
})

test("FIT: 書類を置くと書類チェックが「届いた」になり、置き直すと版が上がる。ダウンロードは記録され、認定通知書を置くと保存済みになる", async ({ page }) => {
  const stamp = Date.now()
  await receive(page, { commonId: `CP${stamp}`, name: `見本 四郎${stamp}` })
  const docs = page.getByTestId("fit-documents")
  const poa = docs.getByTestId("doc-check").filter({ hasText: "委任状" })
  await expect(poa).toHaveAttribute("data-done", "0")

  const put = async (docType: string, name: string) => {
    await docs.getByTestId("doc-type").selectOption(docType)
    await docs.getByTestId("doc-input").setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4 ${name}`) })
    await expect(page.getByText("置きました").last()).toBeVisible()
  }
  await put("poa", "委任状.pdf")
  await expect(poa).toHaveAttribute("data-done", "1")
  await put("poa", "委任状_押印あり.pdf")
  await expect(docs.getByTestId("doc-file").filter({ hasText: "委任状_押印あり.pdf" })).toContainText("第2版")
  await expect(docs.getByTestId("doc-file")).toHaveCount(2)

  const latest = docs.getByTestId("doc-file").filter({ hasText: "委任状_押印あり.pdf" })
  const [download] = await Promise.all([page.waitForEvent("download"), latest.getByRole("button", { name: /をダウンロード/ }).click()])
  expect(download.suggestedFilename()).toBe("委任状_押印あり.pdf")
  await expect(latest.getByTestId("doc-downloads")).toContainText("1回ダウンロード")

  await put("approval_notice", "認定通知書.pdf")
  await expect(page.getByTestId("fit-procedure")).toContainText("保存済み")
  await page.getByTestId("fit-procedure-edit").click()
  await expect(page.getByTestId("proc-notice-saved")).toHaveAttribute("data-checked", "")
})
