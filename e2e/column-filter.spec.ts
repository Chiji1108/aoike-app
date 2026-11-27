import type { Page } from "@playwright/test"
import { expect, test } from "./fake-ai"
import { convertFixture, deleteCustomer, openTab, showAllRows } from "./helpers"

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname
const ROWS = '[data-testid="preview-table"] tbody tr[data-row-key]'

const menu = (page: Page, column: string) => page.locator(`[data-testid="column-menu"][data-column="${column}"]`)
/** 開いている ▼ の中（閉じる途中のものは数えない） */
const panel = (page: Page) => page.locator('[data-testid="column-panel"][data-open]')
const rowCount = (page: Page) => page.locator(ROWS).count()
/** 表の行の数（仮想スクロールで描いていない行も）: 表の段の「表」の数 */
const total = async (page: Page) => Number(/(\d+)/.exec((await page.getByTestId("tab-table").textContent()) ?? "")?.[1] ?? 0)

const pageErrors: string[] = []
const created: string[] = []
test.beforeEach(({ page }) => {
  pageErrors.length = 0
  page.on("pageerror", (e) => pageErrors.push(e.message))
})
test.afterEach(async ({ page }) => {
  for (const customer of created.splice(0)) await deleteCustomer(page, customer)
  expect(pageErrors).toEqual([])
})

test("表の見出しの ▼ で、値・色で絞り、並べ替え、じょうごの印と「すべて解除」、キーボードで使える", async ({ page }) => {
  created.push((await convertFixture(page, FIXTURE)).customer)
  await showAllRows(page)
  const all = await total(page)
  expect(all).toBeGreaterThan(3)
  await expect(page.locator(ROWS)).toHaveCount(all)

  await test.step("値で絞る: 全選択を外すと行が無くなり、1つ選ぶとその件数の行だけ。▼ はじょうごになり、表の上に「絞り込み中」", async () => {
    await menu(page, "gyoshu").click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page)).toContainText("CSV の")
    const values = panel(page).getByTestId("filter-value")
    expect(await values.count()).toBeGreaterThan(1)
    await panel(page).getByTestId("filter-all").click()
    await expect(page.getByTestId("no-match")).toContainText("列の絞り込みに合う")
    const first = values.first()
    const count = Number(await first.locator(".num").textContent())
    await first.getByRole("checkbox").click()
    await expect(page.locator(ROWS)).toHaveCount(count)
    const code = (await first.getAttribute("data-value"))!
    for (const td of await page.locator(`${ROWS} td[data-field="gyoshu"]`).all()) {
      if (code) await expect(td.locator("[data-code]")).toHaveAttribute("data-code", code)
      else await expect(td).toContainText("—")
    }
    await page.keyboard.press("Escape")
    await expect(panel(page)).toBeHidden()
    await expect(menu(page, "gyoshu")).toHaveAttribute("data-filtered", "1")
    await expect(page.getByTestId("column-filters")).toContainText("絞り込み中: 業種")
    await expect(page.getByTestId("column-filters-count")).toHaveText(`（${all}行のうち ${count}行を表示）`)
  })

  await test.step("検索で一覧が狭まっているときに外した値だけが隠れ、一覧に無かった値は隠れない", async () => {
    await page.getByTestId("column-filters-clear").click()
    await expect(page.locator(ROWS)).toHaveCount(all)
    const row = page.locator(ROWS).first()
    const origin = (await row.getByTestId("origin-cell").getAttribute("title"))!
    // 業種が空の行は data-code が無いので、待たずにその場で読む
    const code = await row.locator('td[data-field="gyoshu"]').evaluate((td) => td.querySelector("[data-code]")?.getAttribute("data-code") ?? "")
    const sameCode = await page.locator(`${ROWS} td[data-field="gyoshu"]`).evaluateAll((tds, code) => tds.filter((td) => (td.querySelector("[data-code]")?.getAttribute("data-code") ?? "") === code).length, code)
    await page.getByLabel("表の中を検索").fill(origin)
    await expect(page.locator(ROWS)).toHaveCount(1)
    await menu(page, "gyoshu").click()
    await expect(panel(page).getByTestId("filter-value")).toHaveCount(1)
    await panel(page).getByTestId("filter-value").getByRole("checkbox").click()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("no-match")).toBeVisible()
    await page.getByLabel("表の中を検索").fill("")
    await expect(page.locator(ROWS)).toHaveCount(all - sameCode)
    // ほかの業種の行だけに検索すると、外した値は一覧に無い: 「すべて選択」は一部の印で、外していることを1行出す。押すとこの列の絞り込みを外す
    const other = await page.locator(ROWS).evaluateAll(
      (trs, code) => trs.map((tr) => [tr.querySelector('[data-testid="origin-cell"]')!.getAttribute("title")!, tr.querySelector('td[data-field="gyoshu"] [data-code]')?.getAttribute("data-code") ?? ""] as const).find(([, c]) => c !== code)![0],
      code,
    )
    await page.getByLabel("表の中を検索").fill(other)
    await menu(page, "gyoshu").click()
    await expect(panel(page).getByTestId("filter-hidden-excluded")).toHaveText("一覧に無い値 1件を外しています")
    await expect(panel(page).getByTestId("filter-all")).toHaveAttribute("aria-checked", "mixed")
    await panel(page).getByTestId("filter-all").click()
    await expect(menu(page, "gyoshu")).not.toHaveAttribute("data-filtered", /./)
    await page.keyboard.press("Escape")
    await page.getByLabel("表の中を検索").fill("")
    await expect(page.locator(ROWS)).toHaveCount(all)
  })

  await test.step("色で絞る: その列にある色だけ出し、選ぶとその色のセルの行だけ（ほかの列の絞り込みと重なる）", async () => {
    await expect(page.getByTestId("column-filters")).toHaveCount(0)
    await expect(page.locator(ROWS)).toHaveCount(all)
    // 色のセルがある列を選ぶ
    const colored = page.locator(`${ROWS} td[data-tone="warning"], ${ROWS} td[data-tone="error"], ${ROWS} td[data-tone="ai"], ${ROWS} td[data-tone="changed"]`).first()
    const field = (await colored.getAttribute("data-field"))!
    const tone = (await colored.getAttribute("data-tone"))!
    await menu(page, field).click()
    const tones = panel(page).getByTestId("filter-tone")
    // 色の一覧が描かれてから読む（evaluateAll は待たない）
    await expect(panel(page).locator(`[data-testid="filter-tone"][data-tone="${tone}"]`)).toBeVisible()
    // 出すのはこの列にある色だけ
    const shownTones = await tones.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tone!))
    const present = await page.locator(`${ROWS} td[data-field="${field}"]`).evaluateAll((tds) => [...new Set(tds.map((td) => (td as HTMLElement).dataset.tone!))])
    expect(shownTones.every((t) => present.includes(t))).toBe(true)
    expect(shownTones).not.toContain("ok")
    const button = panel(page).locator(`[data-testid="filter-tone"][data-tone="${tone}"]`)
    const count = Number(await button.locator(".num").textContent())
    await button.click()
    await expect(button).toHaveAttribute("aria-pressed", "true")
    await expect(page.locator(ROWS)).toHaveCount(count)
    for (const td of await page.locator(`${ROWS} td[data-field="${field}"]`).all()) await expect(td).toHaveAttribute("data-tone", tone)
    await page.keyboard.press("Escape")
    await expect(menu(page, field)).toHaveAttribute("data-filtered", "1")
    // 「すべて解除」で元に戻る
    await page.getByTestId("column-filters-clear").click()
    await expect(page.getByTestId("column-filters")).toHaveCount(0)
    await expect(menu(page, field)).not.toHaveAttribute("data-filtered", /./)
    await expect(page.locator(ROWS)).toHaveCount(all)
  })

  await test.step("並べ替えは ▼ の中: 昇順・降順、同じ向きをもう一度押すと元の並び", async () => {
    const header = page.locator("th").filter({ has: menu(page, "amount") })
    const amounts = async () => (await page.locator('td[data-field="amount"] > button > span:first-child').evaluateAll((s) => s.map((e) => Number(e.textContent)))).filter((n) => !Number.isNaN(n))
    await menu(page, "amount").click()
    await panel(page).getByTestId("sort-asc").click()
    await expect(header).toHaveAttribute("aria-sort", "ascending")
    const asc = await amounts()
    expect(asc).toEqual([...asc].sort((a, b) => a - b))
    await panel(page).getByTestId("sort-asc").click()
    await expect(header).not.toHaveAttribute("aria-sort", /./)
    await page.keyboard.press("Escape")
  })

  await test.step("キーボード: Enter で開き、Tab で値の一覧へ、Space で選び、Escape で閉じて見出しに戻る", async () => {
    await menu(page, "gyoshu").focus()
    await page.keyboard.press("Enter")
    await expect(panel(page)).toBeVisible()
    for (let i = 0; i < 20; i++) {
      if (await panel(page).getByTestId("filter-all").evaluate((el) => el === document.activeElement)) break
      await page.keyboard.press("Tab")
    }
    await expect(panel(page).getByTestId("filter-all")).toBeFocused()
    await page.keyboard.press("Space")
    await expect(page.getByTestId("no-match")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(panel(page)).toBeHidden()
    await expect(menu(page, "gyoshu")).toBeFocused()
    await expect(menu(page, "gyoshu")).toHaveAttribute("data-filtered", "1")
  })

  await test.step("列の表示で隠した列の絞り込みは外れる", async () => {
    await page.getByRole("button", { name: "表示する列" }).click()
    await page.getByRole("menuitemcheckbox", { name: "業種" }).click()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("column-filters")).toHaveCount(0)
    await expect(page.locator(ROWS)).toHaveCount(all)
    await page.getByRole("button", { name: "表示する列" }).click()
    await page.getByRole("menuitemcheckbox", { name: "業種" }).click()
    await page.keyboard.press("Escape")
  })

  await test.step("手直しで絞り込みから外れた行は、「更新」を押すまで残る（止めた並び）。直すの段でも同じ絞り込みが効く", async () => {
    await menu(page, "place").click()
    // 1つの値を外し、見えている行の場所名をその値に直す
    const value = panel(page).getByTestId("filter-value").first()
    const excluded = (await value.getAttribute("data-value"))!
    const count = Number(await value.locator(".num").textContent())
    await value.getByRole("checkbox").click()
    await page.keyboard.press("Escape")
    await expect(page.locator(ROWS)).toHaveCount(all - count)
    const row = page.locator(ROWS).first()
    const key = (await row.getAttribute("data-row-key"))!
    await row.locator('td[data-field="place"] button').click()
    await page.getByLabel("セルの値").fill(excluded)
    await page.getByLabel("セルの値").press("Enter")
    await expect(page.locator(`${ROWS}[data-row-key="${key}"]`).getByTestId("row-unmatched")).toBeVisible()
    await page.getByTestId("outdated").getByRole("button", { name: "更新" }).click()
    await expect(page.locator(`${ROWS}[data-row-key="${key}"]`)).toHaveCount(0)
    await expect(page.locator(ROWS)).toHaveCount(all - count - 1)
    await openTab(page, "fix")
    await expect(page.getByTestId("column-filters")).toContainText("場所名")
    await page.getByTestId("column-filters-clear").click()
  })
})

test("狭い画面（390px）でも ▼ を開いて絞れる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  created.push((await convertFixture(page, FIXTURE)).customer)
  await showAllRows(page)
  await menu(page, "gyoshu").scrollIntoViewIfNeeded()
  await menu(page, "gyoshu").click()
  const box = (await panel(page).boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  const before = await rowCount(page)
  await panel(page).getByTestId("filter-all").click()
  await expect(page.getByTestId("no-match")).toBeVisible()
  await panel(page).getByTestId("filter-all").click()
  await page.keyboard.press("Escape")
  await expect(page.locator(ROWS)).toHaveCount(before)
})
