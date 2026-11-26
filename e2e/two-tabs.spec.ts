import { expect, test } from "@playwright/test"
import { attachAndConvert, deleteCustomer, open, openNewCase, reload } from "./helpers"

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname

test("同じ案件を2つのタブで開くと互いに印が出て、片方で保存するともう片方に「保存された」の印が出る（再読み込みで消え、閉じれば外れる）", async ({ page, context }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  const { customer, caseUrl } = await openNewCase(page)
  await expect(page.getByTestId("peer-status")).toHaveCount(0)

  const other = await context.newPage()
  other.on("pageerror", (e) => errors.push(e.message))
  await open(other, caseUrl)
  await expect(page.getByTestId("peer-status")).toHaveAttribute("data-peer", "open")
  await expect(other.getByTestId("peer-status")).toHaveAttribute("data-peer", "open")

  await test.step("片方で変換して保存すると、もう片方に再読み込みを頼む印が出る（保存した側は開いている印のまま）", async () => {
    await attachAndConvert(page, FIXTURE)
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 30_000 })
    await expect(other.getByTestId("peer-status")).toHaveAttribute("data-peer", "saved")
    await expect(other.getByTestId("peer-status")).toContainText("再読み込み")
    await expect(page.getByTestId("peer-status")).toHaveAttribute("data-peer", "open")
  })

  await test.step("再読み込みすると保存された作業を読み、開いている印に戻る。閉じるともう片方の印が外れる", async () => {
    await reload(other)
    await expect(other.getByTestId("peer-status")).toHaveAttribute("data-peer", "open")
    await expect(other.locator('[data-testid="file-list"] [data-file="sample-messy.xlsx"]')).toContainText("変換の元")
    await other.close()
    await expect(page.getByTestId("peer-status")).toHaveCount(0)
  })

  expect(errors).toEqual([])
  await deleteCustomer(page, customer)
})
