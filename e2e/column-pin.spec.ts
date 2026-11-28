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
    // 背景色を 1px の canvas に塗って読み、アルファが 255 か（oklch(… / 0.5)・color-mix の半透明も見る）
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!
    const opaque = (color: string) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = "rgba(0, 0, 0, 0)"
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      return ctx.getImageData(0, 0, 1, 1).data[3] === 255
    }
    const cols = (tr: Element) =>
      [...tr.children].map((el) => {
        const r = el.getBoundingClientRect()
        const bg = getComputedStyle(el).backgroundColor
        return {
          left: Math.round(r.left - box),
          right: Math.round(r.right - box),
          pinned: (el as HTMLElement).dataset.pinned ?? null,
          opaque: opaque(bg),
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

  await test.step("横にスクロールして固定しない列の境目が固定の見出しの下に来ても、その上を押すと固定の列の ▼ が開き、隠れた列の幅は変わらない", async () => {
    // 注文者（業種のすぐ右）の境目を、業種の見出しの真ん中の下へ動かす
    const client = page.locator('[data-testid="column-resizer"][data-column="client"]')
    const gyoshu = page.locator('[data-testid="column-menu"][data-column="gyoshu"]')
    const g = (await gyoshu.boundingBox())!
    const c = (await client.boundingBox())!
    const target = g.x + g.width / 2
    await scrollX(page, Math.round(c.x + c.width / 2 - target))
    const r = (await client.boundingBox())!
    const x = r.x + r.width / 2
    const y = g.y + g.height / 2
    expect(Math.abs(x - target)).toBeLessThan(2)
    // その点のいちばん上は業種の見出し（注文者の境目ではない）
    const top = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y)!
      return { resizer: !!el.closest('[data-testid="column-resizer"]'), column: el.closest('[data-testid="column-menu"]')?.getAttribute("data-column") ?? null }
    }, [x, y] as const)
    expect(top).toEqual({ resizer: false, column: "gyoshu" })
    // ドラッグしても注文者の幅は変わらない
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 60, y, { steps: 4 })
    await expect(client).not.toHaveAttribute("data-resizing")
    await page.mouse.up()
    await expect(client).toHaveAttribute("aria-valuenow", "170")
    await page.keyboard.press("Escape")
    await expect(page.locator('[data-testid="column-panel"][data-open]')).toHaveCount(0)
    // 押すと業種の ▼ が開く
    await page.mouse.click(x, y)
    await expect(page.locator('[data-testid="column-panel"][data-open]')).toContainText("業種")
    await page.keyboard.press("Escape")
    await expect(page.locator('[data-testid="column-panel"][data-open]')).toHaveCount(0)
    await scrollX(page, 0)
  })

  await test.step("行にマウスを乗せると、固定の列の色の無いセルも行と同じ色になり、透けない", async () => {
    const row = page.locator('[data-testid="preview-table"] tbody tr[data-row-key][data-included="1"]').first()
    const origin = row.getByTestId("origin-cell")
    const before = await origin.evaluate((td) => getComputedStyle(td).backgroundColor)
    await origin.hover()
    await expect.poll(() => origin.evaluate((td) => getComputedStyle(td).backgroundColor)).not.toBe(before)
    expect((await layout(page)).row.filter((c) => c.pinned).every((c) => c.opaque)).toBe(true)
    await page.mouse.move(0, 0)
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

test("表の欄が狭い（スマートフォン）ときは載せるの列だけを固定し、横にスクロールしても見えたまま", async ({ page }) => {
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
