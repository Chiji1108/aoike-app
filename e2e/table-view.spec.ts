import { readFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import * as XLSX from "xlsx"
import { GYOSHU } from "../src/lib/spec/code-sets"
import { attachAndConvert, convertFixture, deleteCustomer, openNewCase, showAllRows } from "./helpers"

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
  const all = Number(/(\d+)\s*$/.exec((await page.getByTestId("row-filters-all").textContent()) ?? "")![1])
  await expect(page.locator('[data-testid="preview-table"] tbody tr[data-row-key]')).toHaveCount(all)
  const tones = await tableTones(page)
  const shown = await legend.locator("li").evaluateAll((lis) => lis.map((li) => (li as HTMLElement).dataset.tone!))
  // 色なし（そのまま）は凡例に出さない。出す種類は表のセルの色とちょうど同じ
  expect(shown.sort()).toEqual(tones.filter((t) => t !== "ok").sort())
  expect(shown.length).toBeGreaterThan(0)
  if (shown.includes("warning")) await expect(legend.locator('li[data-tone="warning"]')).toHaveAttribute("title", /AI が補った値/)
  // 絞り込みを変えても凡例は動かない（全行で数える）
  await page.getByTestId("row-filters-fix").click()
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
