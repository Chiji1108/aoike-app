import { expect, test } from "@playwright/test"
import { attachAndConvert, deleteCustomer, open, openNewCase, reload, showAllRows } from "./helpers"

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname

test("同じ案件を2つのタブで開いて両方で変えると、あとから保存した方は止めて再読み込みを頼む（再読み込みすると先に保存した作業を読む）", async ({ page, context }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  const { customer, caseUrl } = await openNewCase(page)
  await attachAndConvert(page, FIXTURE)
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 30_000 })

  const other = await context.newPage()
  other.on("pageerror", (e) => errors.push(e.message))
  await open(other, caseUrl)
  await expect(other.getByTestId("next-steps")).toBeVisible({ timeout: 60_000 })
  await showAllRows(other)
  await showAllRows(page)

  // 先のタブで載せる工事を切り替えて保存する
  const before = await page.getByTestId("include-all").getAttribute("data-selection")
  const flipped = before === "all" ? "rule7" : "all"
  await page.getByTestId("include-all").click()
  await expect(page.getByTestId("include-all")).toHaveAttribute("data-selection", flipped)
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 30_000 })

  // 古いまま開いているタブで変えると、保存はぶつかり、再読み込みを頼む
  await other.getByTestId("include-all").click()
  await expect(other.getByTestId("save-status")).toHaveAttribute("data-status", "conflict", { timeout: 30_000 })
  await expect(other.getByTestId("save-status")).toContainText("再読み込み")

  await reload(other)
  await expect(other.getByTestId("next-steps")).toBeVisible({ timeout: 60_000 })
  await showAllRows(other)
  await expect(other.getByTestId("include-all")).toHaveAttribute("data-selection", flipped)
  await expect(other.getByTestId("save-status")).toHaveAttribute("data-status", "saved")
  await other.close()

  expect(errors).toEqual([])
  await deleteCustomer(page, customer)
})
