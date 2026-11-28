import { readFileSync } from "node:fs"
import type { Page } from "@playwright/test"
import { expect, test } from "./fake-ai"
import * as XLSX from "xlsx"
import { GYOSHU } from "../src/lib/spec/code-sets"
import { attachAndConvert, convertFixture, deleteCustomer, openNewCase, openTab, showAllRows } from "./helpers"

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname

/** 表のセルの色の種類（セルの data-tone） */
const tableTones = (page: Page) =>
  page.locator('[data-testid="preview-table"] td[data-tone]').evaluateAll((tds) => [...new Set(tds.map((td) => (td as HTMLElement).dataset.tone!))])

test("色の凡例は表にある色だけを出し、黄色の意味を添える", async ({ page }) => {
  const { customer } = await convertFixture(page, FIXTURE)
  await showAllRows(page)
  const legend = page.getByTestId("color-legend")
  await expect(legend).toBeVisible()
  // 凡例は全行で数えるので、全行が描かれている（仮想化で外れていない）ことを確かめてから表のセルと比べる
  const all = Number(/(\d+)/.exec((await page.getByTestId("tab-table").textContent()) ?? "")![1])
  await expect(page.locator('[data-testid="preview-table"] tbody tr[data-row-key]')).toHaveCount(all)
  const tones = await tableTones(page)
  const shown = await legend.locator("li").evaluateAll((lis) => lis.map((li) => (li as HTMLElement).dataset.tone!))
  // 色なし（そのまま）は凡例に出さない。出す種類は表のセルの色とちょうど同じ
  expect(shown.sort()).toEqual(tones.filter((t) => t !== "ok").sort())
  expect(shown.length).toBeGreaterThan(0)
  if (shown.includes("warning")) await expect(legend.locator('li[data-tone="warning"]')).toHaveAttribute("title", /AI が補った値/)
  // 絞り込みを変えても凡例は動かない（全行で数える）
  await openTab(page, "fix")
  await expect(legend.locator("li")).toHaveCount(shown.length)
  await deleteCustomer(page, customer)
})

/** 合成のサンプルのシート名を長くした Excel（シート名が長い顧客の表） */
function longSheetFixture(name: string) {
  const wb = XLSX.read(readFileSync(FIXTURE))
  const first = wb.SheetNames[0]!
  wb.Sheets[name] = wb.Sheets[first]!
  delete wb.Sheets[first]
  wb.SheetNames[0] = name
  return { name: "合成_長いシート名.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer }
}

test("シート名が長くても、元の行と業種のセルは隣の列にはみ出さない（行番号は見え、業種は折り返さない）", async ({ page }) => {
  const sheet = "2025年（令和7年）記入用フォーム"
  const { customer } = await openNewCase(page)
  await attachAndConvert(page, longSheetFixture(sheet))
  await showAllRows(page)
  const origin = page.getByTestId("origin-cell").first()
  await expect(origin).toHaveAttribute("title", new RegExp(`^${sheet.replace(/[()（）]/g, ".")}!\\d+$`))
  // 行番号は切らずに見える
  await expect(origin.locator("span > span").last()).toHaveText(/^!\d+$/)
  const overflow = await page.getByTestId("preview-table").evaluate((table, labels) => {
    const bad: string[] = []
    const right = (el: Element) => el.getBoundingClientRect().right
    for (const td of table.querySelectorAll<HTMLElement>('td[data-testid="origin-cell"], td[data-field="gyoshu"]')) {
      const inner = td.querySelector("span")
      if (inner && right(inner) > right(td) + 0.5) bad.push(`はみ出し: ${td.textContent}`)
    }
    // 業種はいちばん長い名前でも「コード 名前」が折り返さず切れない（列の中に同じ形を置いて測る）
    const cell = table.querySelector<HTMLElement>('td[data-field="gyoshu"] [data-code]')!
    for (const g of labels) {
      const probe = cell.cloneNode(true) as HTMLElement
      probe.querySelector(".num")!.textContent = g.code
      probe.querySelector(".truncate")!.textContent = g.label
      cell.parentElement!.appendChild(probe)
      const name = probe.querySelector<HTMLElement>(".truncate")!
      if (name.scrollWidth > name.clientWidth || right(probe) > right(cell.closest("td")!) + 0.5) bad.push(`切れる: ${g.code} ${g.label}`)
      probe.remove()
    }
    return bad
  }, GYOSHU.map((g) => ({ code: g.code, label: g.label })))
  expect(overflow).toEqual([])
  // ツールチップはセルのボタンに1つだけ（決まった値の中には付けない。注意書きが無ければ「コード 名前」）
  await expect(page.locator('[data-testid="preview-table"] [data-code][title]')).toHaveCount(0)
  const gyoshu = page.locator('[data-testid="preview-table"] td[data-field="gyoshu"]:not([data-tone="warning"]) > button').first()
  await expect(gyoshu).toHaveAttribute("title", /^\d+ \S/)
  await deleteCustomer(page, customer)
})

test("見出しの境目をドラッグすると列が広がって省略が消え、ダブルクリックで元の幅に戻る（キーボード・タッチでも変えられ、直すの段と同じ幅）", async ({ page }) => {
  const sheet = "2025年（令和7年）記入用フォーム"
  const { customer } = await openNewCase(page)
  await attachAndConvert(page, longSheetFixture(sheet))
  await showAllRows(page)
  const table = page.getByTestId("preview-table")
  const head = table.locator("thead th").filter({ has: page.locator('[data-testid="column-resizer"][data-column="origin"]') })
  const resizer = page.locator('[data-testid="column-resizer"][data-column="origin"]')
  const width = async () => Math.round((await head.boundingBox())!.width)
  /** 見えている元の行のセルで、シート名が「…」で切れている数 */
  const truncated = () =>
    table.locator('td[data-testid="origin-cell"] .truncate').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).length)

  await test.step("「表示する列」のボタンには「列」と文字が出る", async () => {
    await expect(page.getByRole("button", { name: "表示する列" })).toHaveText("列")
  })

  const initial = await width()
  expect(initial).toBe(84)
  expect(await truncated()).toBeGreaterThan(0)

  await test.step("境目をドラッグすると、離したときに列が広がり、シート名が全部見える。境目と見出しの ▼ はぶつからない", async () => {
    const box = (await resizer.boundingBox())!
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, y, { steps: 6 })
    // ドラッグの間は境目の線だけが動き、幅は離したときに決める
    await expect(resizer).toHaveAttribute("data-resizing", "1")
    expect(await width()).toBe(initial)
    await page.mouse.move(box.x + box.width / 2 + 200, y, { steps: 4 })
    await page.mouse.up()
    await expect(resizer).not.toHaveAttribute("data-resizing")
    await expect.poll(width).toBe(initial + 200)
    expect(await truncated()).toBe(0)
    await expect(resizer).toHaveAttribute("aria-valuenow", String(initial + 200))
    await expect(page.locator('[data-testid="column-panel"][data-open]')).toHaveCount(0)
  })

  await test.step("直すの段でも同じ幅", async () => {
    await openTab(page, "fix")
    await expect.poll(width).toBe(initial + 200)
    await openTab(page, "table")
  })

  await test.step("境目にフォーカスして ←→ で変えられる（Shift で大きく）", async () => {
    await resizer.focus()
    await page.keyboard.press("ArrowLeft")
    await expect.poll(width).toBe(initial + 200 - 16)
    await page.keyboard.press("Shift+ArrowRight")
    await expect.poll(width).toBe(initial + 200 - 16 + 64)
  })

  await test.step("境目をダブルクリックで元の幅に戻り、シート名はまた「…」で切れる", async () => {
    await resizer.dblclick()
    await expect.poll(width).toBe(initial)
    expect(await truncated()).toBeGreaterThan(0)
  })

  await test.step("タッチで引いても広がる", async () => {
    const box = (await resizer.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
    for (const dx of [40, 80, 120]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y }] })
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await expect.poll(width).toBe(initial + 120)
  })

  await test.step("下限より狭く引いても、ドラッグの間の線と離したあとの幅は下限で止まる", async () => {
    const box = (await resizer.boundingBox())!
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - 400, y, { steps: 6 })
    const shift = await resizer.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)
    expect(Math.round(shift)).toBe(48 - (initial + 120))
    await page.mouse.up()
    await expect.poll(width).toBe(48)
    await resizer.dblclick()
    await expect.poll(width).toBe(initial)
  })

  await test.step("列を隠して表が欄より狭くても、どの列も決めた幅のまま（余りは表の右の空白）", async () => {
    await page.getByRole("button", { name: "表示する列" }).click()
    // 元の行と業種だけを残す
    for (const name of ["注文者", "元請下請", "JV", "工事名", "都道府県名", "場所名", "配置技術者", "請負代金（千円）", "うちPC・法面・鋼橋上部（千円）", "着工年月", "完成年月", "主任技術者", "監理技術者"])
      await page.getByRole("menuitemcheckbox", { name, exact: true }).click()
    await page.keyboard.press("Escape")
    const fit = await table.evaluate((t) => ({
      table: t.getBoundingClientRect().width,
      box: t.parentElement!.clientWidth,
      bad: [...t.querySelectorAll<HTMLElement>('[data-testid="column-resizer"]')].filter((r) => Math.abs(r.closest("th")!.getBoundingClientRect().width - Number(r.getAttribute("aria-valuenow"))) > 0.5).length,
    }))
    expect(fit.table).toBeLessThan(fit.box)
    expect(fit.bad).toBe(0)
    expect(await width()).toBe(initial)
  })
  await deleteCustomer(page, customer)
})

test.describe("タッチの画面", () => {
  test.use({ hasTouch: true })
  test("太い境目のつまみがあっても、見出しの ▼ をタップすると開く（つまみと ▼ が重ならない）", async ({ page }) => {
    const { customer } = await openNewCase(page)
    await attachAndConvert(page, longSheetFixture("2025年（令和7年）記入用フォーム"))
    await showAllRows(page)
    const resizers = page.locator('[data-testid="column-resizer"]')
    // タッチ（pointer: coarse）では指で押しやすい太いつまみ
    expect(Math.round((await resizers.first().boundingBox())!.width)).toBe(20)
    const overlaps = await page.getByTestId("preview-table").evaluate((t) =>
      [...t.querySelectorAll<HTMLElement>('[data-testid="column-resizer"]')].filter((r) => {
        const menu = r.closest("th")!.querySelector('[data-testid="column-menu"]')
        return menu && menu.getBoundingClientRect().right > r.getBoundingClientRect().left + 0.5
      }).length,
    )
    expect(overlaps).toBe(0)
    for (const column of ["origin", "gyoshu"]) {
      const menu = page.locator(`[data-testid="column-menu"][data-column="${column}"]`)
      const box = (await menu.boundingBox())!
      // ▼ はボタンの右端
      await page.touchscreen.tap(box.x + box.width - 4, box.y + box.height / 2)
      await expect(page.locator('[data-testid="column-panel"][data-open]')).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(page.locator('[data-testid="column-panel"][data-open]')).toHaveCount(0)
    }
    await deleteCustomer(page, customer)
  })
})
