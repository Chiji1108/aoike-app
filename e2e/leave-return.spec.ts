import { expect, test, type Page } from "@playwright/test"
import { deleteCustomer, openNewCase, openTab } from "./helpers"

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname

test("計画を立てている途中で顧客の画面へ移ってすぐ戻っても、前の画面が保存してぶつかることはなく、変換して保存できる", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  const { customer } = await openNewCase(page)
  await page.getByTestId("chat-file-input").setInputFiles(FIXTURE)
  // 変換の元を読んで計画を立て始めたら（AI を待っている間に）離れる
  await expect(page.getByTestId("case-report")).toHaveAttribute("data-phase", /planning|converting/, { timeout: 60_000 })
  await page.getByRole("link", { name: customer }).click()
  await expect(page.getByRole("heading", { name: customer })).toBeVisible()
  await page.goBack()

  // 戻った画面が計画を立て直して変換する（前の画面の返事は入れない・保存しない）
  await attachAndConvertDone(page)
  await openTab(page, "selection")
  await page.getByTestId("rounding-round").click()
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 30_000 })
  // 前の画面の計画・変換が遅れて終わっても、保存はぶつからない
  await page.waitForTimeout(3_000)
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved")

  expect(errors).toEqual([])
  await deleteCustomer(page, customer)
})

/** 変換の報告が終わり、表が出るまで待つ */
async function attachAndConvertDone(page: Page) {
  await expect(page.getByTestId("case-report")).toHaveAttribute("data-phase", "done", { timeout: 300_000 })
  await expect(page.getByTestId("preview-table")).toBeVisible()
}
