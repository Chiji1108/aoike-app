import { expect, test, type Page } from "@playwright/test"
import { callsServerFn, deleteCustomer, openNewCase, openTab, reload, showAllRows } from "./helpers"

/**
 * 表から「全件を載せる」: 「載せる」の見出しのチェックで7割と金額のタブの「載せる工事」を切り替え（取り消せる）、
 * 行の Shift＋クリック（Shift＋Space）で範囲をまとめて入れ外しし（1回で取り消しの記録1件）、
 * 7割ルールのまま手で載せた行が多くなると「全件にしますか？」を出す。列の対応は見出しからの推定にする（計画の AI を断る）
 */

const LARGE = new URL("../fixtures/sample-large.xlsx", import.meta.url).pathname
const ROWS = '[data-testid="preview-table"] tbody tr[data-row-key]'

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

async function convert(page: Page) {
  const { customer } = await openNewCase(page)
  created.push(customer)
  await page.route((url) => callsServerFn(url.href, ["planWithAi"]), (route) => route.fulfill({ status: 500, body: "計画の AI を使わない" }))
  await page.getByTestId("chat-file-input").setInputFiles(LARGE)
  await expect(page.getByTestId("next-steps")).toBeVisible({ timeout: 180_000 })
  await expect(page.getByTestId("case-report")).toHaveAttribute("data-phase", "done")
  await openTab(page, "table")
}

const header = (page: Page) => page.getByTestId("include-all")
const row = (page: Page, i: number) => page.locator(`${ROWS}[data-index="${i}"]`)
const rowBox = (page: Page, i: number) => row(page, i).getByRole("checkbox", { name: "CSVに載せる" })
/** 最後に出た通知の「取り消す」 */
const undoToast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text }).last().getByRole("button", { name: "取り消す" })
/** 今描いている行のうち、載せる（"1"）か載せない（"0"）行の data-index */
const renderedIndices = (page: Page, included: "0" | "1") =>
  page.locator(ROWS).evaluateAll((trs, v) => trs.flatMap((tr) => ((tr as HTMLElement).dataset.included === v ? [Number((tr as HTMLElement).dataset.index)] : [])), included)
/** 今描いている行の [key, data-included]（並びのまま） */
const rowStates = (page: Page) => page.locator(ROWS).evaluateAll((trs) => trs.map((tr) => [(tr as HTMLElement).dataset.rowKey!, (tr as HTMLElement).dataset.included!] as [string, string]))
const scrollTable = (page: Page, to: "top" | number) =>
  page.getByTestId("preview-table").evaluate((table, to) => {
    table.parentElement!.scrollTop = to === "top" ? 0 : to
  }, to)

test("見出しのチェックで全件と7割ルールを切り替え（7割と金額のタブも同じ・取り消せる）、Shift で範囲をまとめて入れ外しし、手で載せた行が多いと全件を勧める", async ({ page }) => {
  await convert(page)
  await showAllRows(page)

  await test.step("はじめは7割ルール: 見出しは一部（−）", async () => {
    await expect(header(page)).toHaveAttribute("data-selection", "rule7")
    await expect(header(page)).toHaveAttribute("aria-checked", "mixed")
    await expect(header(page)).toHaveAccessibleName("全件を載せる（今は7割ルール）")
  })

  await test.step("見出しを押すと全件になり、7割と金額のタブも全件。もう一度押すと7割ルールに戻り、通知の「取り消す」で全件に戻る", async () => {
    await header(page).click()
    await expect(header(page)).toHaveAttribute("data-selection", "all")
    await expect(header(page)).toHaveAttribute("aria-checked", "true")
    await openTab(page, "selection")
    await expect(page.getByTestId("selection-all")).toHaveAttribute("aria-pressed", "true")
    await openTab(page, "table")
    await header(page).click()
    await expect(header(page)).toHaveAttribute("data-selection", "rule7")
    await undoToast(page, "7割ルールにしました").click()
    await expect(header(page)).toHaveAttribute("data-selection", "all")
    await openTab(page, "selection")
    await expect(page.getByTestId("selection-all")).toHaveAttribute("aria-pressed", "true")
    // タブで7割ルールに戻す（同じ設定）
    await page.getByTestId("selection-rule7").click()
    await openTab(page, "table")
    await expect(header(page)).toHaveAttribute("data-selection", "rule7")
  })

  await test.step("全件で行を外すと、見出しはチェックのまま「外す N」を添える", async () => {
    await header(page).click()
    await rowBox(page, 0).click()
    await expect(page.getByTestId("include-all-off")).toBeVisible()
    await expect(page.getByTestId("include-all-off")).toHaveText(/^外す\d+$/)
    await expect(header(page)).toHaveAttribute("aria-checked", "true")
    await rowBox(page, 0).click()
    await header(page).click()
    await expect(header(page)).toHaveAttribute("data-selection", "rule7")
  })

  await test.step("Shift＋クリックで、前に押した行から今の行までを今の向きにそろえる（1回の取り消しで戻る）", async () => {
    await scrollTable(page, "top")
    // 載せていない行から始め、下へ 8 行分を Shift＋クリック
    const start = (await renderedIndices(page, "0"))[0]!
    expect(start).toBeGreaterThanOrEqual(0)
    await rowBox(page, start).click()
    const was = await Promise.all(Array.from({ length: 8 }, (_, i) => row(page, start + 1 + i).getAttribute("data-included")))
    await rowBox(page, start + 8).click({ modifiers: ["Shift"] })
    for (let i = start; i <= start + 8; i++) await expect(row(page, i)).toHaveAttribute("data-included", "1")
    await undoToast(page, "載せました").click()
    // 範囲の分だけが戻り、はじめに1行だけ押した行は残る
    await expect(row(page, start)).toHaveAttribute("data-included", "1")
    for (let i = 0; i < 8; i++) await expect(row(page, start + 1 + i)).toHaveAttribute("data-included", was[i]!)
  })

  await test.step("キーボードの Shift＋Space でも範囲になる", async () => {
    await scrollTable(page, "top")
    await rowBox(page, 2).focus()
    await page.keyboard.press("Space")
    const target = (await row(page, 5).getAttribute("data-included")) === "0"
    await rowBox(page, 5).focus()
    await page.keyboard.press("Shift+Space")
    for (let i = 2; i <= 5; i++) await expect(row(page, i)).toHaveAttribute("data-included", target ? "1" : "0")
  })

  await test.step("絞り込み（検索）中は、見えている行だけが範囲になり、検索で隠れた間の行は変えない", async () => {
    await scrollTable(page, "top")
    const before = await rowStates(page)
    const search = page.getByLabel("表の中を検索")
    await search.fill("東京都")
    const keys = await page.locator(ROWS).evaluateAll((trs) => trs.slice(0, 4).map((tr) => (tr as HTMLElement).dataset.rowKey!))
    expect(keys).toHaveLength(4)
    // 検索を外した並びで、見えている4行の間にあって検索で隠れた行
    const order = before.map(([k]) => k)
    const [lo, hi] = [order.indexOf(keys[0]!), order.indexOf(keys[3]!)]
    expect(lo).toBeGreaterThanOrEqual(0)
    expect(hi).toBeGreaterThan(lo)
    const hidden = before.slice(lo, hi + 1).filter(([k]) => !keys.includes(k))
    expect(hidden.length).toBeGreaterThan(0)
    await rowBox(page, 0).click()
    // 向きは Shift＋クリックした行を押した向き
    const target = (await row(page, 3).getAttribute("data-included")) === "0"
    await rowBox(page, 3).click({ modifiers: ["Shift"] })
    for (const k of keys) await expect(page.locator(`${ROWS}[data-row-key="${k}"]`)).toHaveAttribute("data-included", target ? "1" : "0")
    await search.fill("")
    await scrollTable(page, "top")
    for (const [k, v] of hidden) await expect(page.locator(`${ROWS}[data-row-key="${k}"]`)).toHaveAttribute("data-included", v)
  })

  await test.step("検索・絞り込みを変えたら起点を捨てる: 変えたあとの Shift＋クリックは1行だけ", async () => {
    const search = page.getByLabel("表の中を検索")
    await search.fill("東京都")
    await rowBox(page, 0).click()
    await search.fill("")
    await scrollTable(page, "top")
    const was = await Promise.all([1, 2, 3, 4].map((i) => row(page, i).getAttribute("data-included")))
    const last = await row(page, 5).getAttribute("data-included")
    await rowBox(page, 5).click({ modifiers: ["Shift"] })
    await expect(row(page, 5)).toHaveAttribute("data-included", last === "1" ? "0" : "1")
    for (const [j, i] of [1, 2, 3, 4].entries()) await expect(row(page, i)).toHaveAttribute("data-included", was[j]!)
  })

  await test.step("7割ルールのまま手で載せた行が10行以上になると「全件にしますか？」。「全件にする」で全件になり、案内は消える", async () => {
    await expect(page.getByTestId("all-hint")).toHaveCount(0)
    // 描いている行のうち載せていない行の最初から最後までを Shift＋クリックで載せる（10行以上になるまで、下へ進めながら）
    for (let i = 0; i < 6 && !(await page.getByTestId("all-hint").isVisible()); i++) {
      const off = await renderedIndices(page, "0")
      if (off.length >= 2) {
        await rowBox(page, off[0]!).click()
        await rowBox(page, off.at(-1)!).click({ modifiers: ["Shift"] })
      }
      await scrollTable(page, (i + 1) * 1200)
    }
    await expect(page.getByTestId("all-hint")).toBeVisible()
    await expect(page.getByTestId("all-hint")).toContainText("全件にしますか？")
    await page.getByTestId("all-hint-apply").click()
    await expect(header(page)).toHaveAttribute("data-selection", "all")
    await expect(page.getByTestId("all-hint")).toHaveCount(0)
  })

  await test.step("閉じると、7割ルールに戻しても案件ではもう出さない（開き直しても）", async () => {
    await header(page).click()
    await expect(page.getByTestId("all-hint")).toBeVisible()
    await page.getByTestId("all-hint-close").click()
    await expect(page.getByTestId("all-hint")).toHaveCount(0)
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 30_000 })
    await reload(page)
    await expect(page.getByTestId("next-steps")).toBeVisible({ timeout: 60_000 })
    await showAllRows(page)
    await expect(header(page)).toHaveAttribute("data-selection", "rule7")
    await expect(page.getByTestId("all-hint")).toHaveCount(0)
  })
})

test("ほかの段を開いて表に戻っても、表のスクロールの位置はずれない（隠れている間は行の高さを測らない）", async ({ page }) => {
  await convert(page)
  const top = () => page.getByTestId("preview-table").evaluate((t) => t.parentElement!.scrollTop)
  await expect(row(page, 0)).toBeVisible()
  for (const view of ["gyoshu", "inquiry", "export", "answer"] as const) {
    await openTab(page, view)
    await openTab(page, "table")
    await expect(row(page, 0)).toBeVisible()
    expect(await top()).toBe(0)
  }
  // 下へスクロールしてから離れて戻っても、ほぼ同じ位置（下へずれていかない。1行の高さより小さい違いだけ）
  await scrollTable(page, 1200)
  const at = await top()
  await openTab(page, "gyoshu")
  await openTab(page, "table")
  await expect.poll(async () => Math.abs((await top()) - at)).toBeLessThan(36)
})
