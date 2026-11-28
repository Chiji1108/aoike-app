import type { Page } from "@playwright/test"
import { expect, test } from "./fake-ai"
import { convertFixture, deleteCustomer, openTab, showAllRows } from "./helpers"

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname

/**
 * 見出しと見えている最初の行の、列ごとの左端と右端（表の欄の左からの px）と、固定の列か・背景が透けないか。
 * 固定の列は data-pinned、背景は計算した色の不透明度で見る
 */
const layout = (page: Page) =>
  page.getByTestId("preview-table").evaluate((table) => {
    // 欄の枠線の内側から
    const box = table.parentElement!.getBoundingClientRect().left + table.parentElement!.clientLeft
    const cols = (tr: Element) =>
      [...tr.children].map((el) => {
        const r = el.getBoundingClientRect()
        const bg = getComputedStyle(el).backgroundColor
        return {
          left: Math.round(r.left - box),
          right: Math.round(r.right - box),
          pinned: (el as HTMLElement).dataset.pinned ?? null,
          opaque: !/rgba\(.*,\s*0(\.\d+)?\)$/.test(bg) && bg !== "transparent",
        }
      })
    return { head: cols(table.querySelector("thead tr")!), row: cols(table.querySelector("tbody tr[data-row-key]")!) }
  })
const scrollX = (page: Page, x: number) =>
  page.getByTestId("preview-table").evaluate((table, x) => {
    table.parentElement!.scrollLeft = x
  }, x)
const pinnedIds = (page: Page) => page.locator('[data-testid="preview-table"] thead th[data-pinned]').evaluateAll((ths) => ths.map((th) => th.querySelector("[data-column]")?.getAttribute("data-column") ?? "include"))

test("載せる・元の行・業種の列は左に固定し、横にスクロールしても同じ位置に見え、幅を変えても隠しても重ならない", async ({ page }) => {
  const { customer } = await convertFixture(page, FIXTURE)
  await showAllRows(page)
  expect(await pinnedIds(page)).toEqual(["include", "origin", "gyoshu"])

  await test.step("横にスクロールしても固定の列は同じ位置（見出しも行も）。ほかの列は動き、境目の影が付く", async () => {
    const before = await layout(page)
    const scroller = page.getByTestId("preview-table").locator("..")
    await expect(scroller).not.toHaveAttribute("data-scrolled-x")
    await scrollX(page, 400)
    await expect(scroller).toHaveAttribute("data-scrolled-x", "")
    const after = await layout(page)
    for (const part of ["head", "row"] as const) {
      const pinned = before[part].map((c, i) => [c, after[part][i]!] as const).filter(([c]) => c.pinned)
      expect(pinned).toHaveLength(3)
      for (const [b, a] of pinned) expect(a.left).toBe(b.left)
      expect(pinned.map(([b]) => b.left)).toEqual([0, 40, 124])
      // 固定の列の背景は透けない（状態の色のセルも、色の無いセルも）
      expect(after[part].filter((c) => c.pinned).every((c) => c.opaque)).toBe(true)
      // 固定していない列は左へ動いた
      const moved = before[part].findIndex((c) => !c.pinned)
      expect(after[part][moved]!.left).toBe(before[part][moved]!.left - 400)
    }
    const shadow = await page.locator('[data-testid="preview-table"] thead th[data-pinned="last"]').evaluate((th) => getComputedStyle(th).boxShadow)
    expect(shadow).not.toBe("none")
    await scrollX(page, 0)
    await expect(scroller).not.toHaveAttribute("data-scrolled-x")
  })

  await test.step("固定の列（元の行）の幅を変えると、右の固定の列（業種）の位置が追従し、重ならない（スクロールしていても）", async () => {
    const resizer = page.locator('[data-testid="column-resizer"][data-column="origin"]')
    await resizer.click()
    await page.keyboard.press("Shift+ArrowRight")
    await page.keyboard.press("Shift+ArrowRight")
    await expect(resizer).toHaveAttribute("aria-valuenow", String(84 + 128))
    await scrollX(page, 300)
    const { head, row } = await layout(page)
    for (const cols of [head, row]) {
      const pinned = cols.filter((c) => c.pinned)
      expect(pinned.map((c) => c.left)).toEqual([0, 40, 40 + 84 + 128])
      for (let i = 1; i < pinned.length; i++) expect(pinned[i]!.left).toBeGreaterThanOrEqual(pinned[i - 1]!.right)
    }
    await scrollX(page, 0)
    await resizer.dblclick()
    await expect(resizer).toHaveAttribute("aria-valuenow", "84")
  })

  await test.step("元の行の列を隠すと、業種が載せるのすぐ右に固定される", async () => {
    await page.getByRole("button", { name: "表示する列" }).click()
    await page.getByRole("menuitemcheckbox", { name: "元の行", exact: true }).click()
    await page.keyboard.press("Escape")
    expect(await pinnedIds(page)).toEqual(["include", "gyoshu"])
    const { head } = await layout(page)
    expect(head.filter((c) => c.pinned).map((c) => c.left)).toEqual([0, 40])
    await page.getByRole("button", { name: "表示する列" }).click()
    await page.getByRole("menuitemcheckbox", { name: "元の行", exact: true }).click()
    await page.keyboard.press("Escape")
  })

  await test.step("直すの段では、直す理由と直し方の列は固定の列のすぐ右（固定しない）", async () => {
    await openTab(page, "fix")
    const heads = await page.locator('[data-testid="preview-table"] thead th').evaluateAll((ths) => ths.slice(0, 4).map((th) => [th.textContent?.trim(), (th as HTMLElement).dataset.pinned ?? null]))
    expect(heads[3]).toEqual(["直す理由と直し方", null])
    expect(heads.slice(0, 3).every(([, p]) => p)).toBe(true)
  })
  await deleteCustomer(page, customer)
})

test("狭い画面では載せるの列だけを固定し、横にスクロールしても見えたまま", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { customer } = await convertFixture(page, FIXTURE)
  await showAllRows(page)
  expect(await pinnedIds(page)).toEqual(["include"])
  const before = await layout(page)
  await scrollX(page, 300)
  const after = await layout(page)
  expect(after.head[0]!.left).toBe(before.head[0]!.left)
  expect(after.row[0]!.left).toBe(before.row[0]!.left)
  expect(after.row[1]!.left).toBe(before.row[1]!.left - 300)
  await deleteCustomer(page, customer)
})
