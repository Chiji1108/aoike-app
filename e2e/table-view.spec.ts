import { readFileSync } from "node:fs"
import { expect, test, type Page, type Route } from "@playwright/test"
import { createUIMessageStream, createUIMessageStreamResponse } from "ai"
import * as XLSX from "xlsx"
import { GYOSHU } from "../src/lib/spec/code-sets"
import type { ChatMetadata } from "../src/lib/chat/messages"
import { attachAndConvert, convertFixture, deleteCustomer, openNewCase, reload, showAllRows } from "./helpers"

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname
const KEY = "csv-table-expanded"

/** チャットのサーバーの代わりに、delayMs 待ってから決まった文の返事を返す（会話を読む GET はサーバーのまま）。fail なら断る */
async function fakeReply(page: Page, text: string, delayMs: number, fail = false) {
  await page.unroute("**/api/csv/cases/*/chat")
  await page.route("**/api/csv/cases/*/chat", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback()
    if (fail) {
      await new Promise((r) => setTimeout(r, delayMs))
      return route.fulfill({ status: 500, body: text })
    }
    const metadata: ChatMetadata = { usd: 0.01, caseUsd: 0.01, ms: 1000, inputTokens: 100, outputTokens: 10, toolCalls: 0 }
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "start", messageId: `a-${Date.now()}` })
        writer.write({ type: "text-start", id: "t" })
        writer.write({ type: "text-delta", id: "t", delta: text })
        writer.write({ type: "text-end", id: "t" })
        writer.write({ type: "message-metadata", messageMetadata: metadata })
        writer.write({ type: "finish" })
      },
    })
    const res = createUIMessageStreamResponse({ stream })
    await new Promise((r) => setTimeout(r, delayMs))
    await route.fulfill({ status: 200, headers: Object.fromEntries(res.headers), body: await res.text() })
  })
}

/** 表のセルの色の種類（status.ts の cellTone と同じ: AI が補った〔注意書きのある AI の〕セルは要確認） */
const tableTones = (page: Page) =>
  page.locator('[data-testid="preview-table"] td[data-status]').evaluateAll((tds) => {
    const tones = new Set<string>()
    for (const td of tds) {
      const status = (td as HTMLElement).dataset.status!
      tones.add(status === "ai" && td.querySelector("button[title]") ? "warning" : status)
    }
    return [...tones]
  })

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

test("表を広げるとチャットをたたみ、たたんでいる間に返事が来ると印を出す。押すとチャットに戻り、端末ごとに覚える", async ({ page }) => {
  const { customer } = await convertFixture(page, FIXTURE)
  const chat = page.getByTestId("chat-column")
  const frame = page.getByTestId("work-frame")
  const toggle = page.getByTestId("table-expand")
  const before = (await frame.boundingBox())!.width

  // 返事を待っている間にたたむ（キーボードで押す）
  await fakeReply(page, "合成の返事です", 1500)
  await page.getByTestId("chat-input").fill("確かめて")
  await page.getByTestId("chat-send").click()
  await toggle.focus()
  await page.keyboard.press("Enter")
  await expect(chat).toBeHidden()
  await expect(toggle).toHaveAttribute("aria-label", "チャットを出す")
  expect((await frame.boundingBox())!.width).toBeGreaterThan(before + 300)
  await expect(toggle).toBeFocused()

  // 返事が届くと印。押すとチャットが戻り、返事が見え、印は消える
  await expect(page.getByTestId("chat-unread")).toBeVisible()
  await expect(toggle).toHaveAttribute("aria-label", "チャットを出す（新しい返事があります）")
  await toggle.click()
  await expect(chat).toBeVisible()
  await expect(page.getByTestId("chat-assistant").last()).toContainText("合成の返事です")
  await expect(page.getByTestId("chat-unread")).toHaveCount(0)
  await expect(toggle).toHaveAttribute("aria-label", "表を広げる")

  // たたんだまま開き直すと、たたんだまま（端末ごとに覚える）
  await toggle.click()
  await expect(chat).toBeHidden()
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("1")
  await reload(page)
  await expect(page.getByTestId("preview-table")).toBeVisible()
  await expect(chat).toBeHidden()

  // 作業の画面を閉じるとチャットを出す。チャットの「表を開く」でまた広げた表に戻り、フォーカスは作業の画面へ（隠したチャットに残さない）
  await page.getByTestId("work-close").click()
  await expect(chat).toBeVisible()
  await expect(frame).toBeHidden()
  await page.getByTestId("work-open").focus()
  await page.keyboard.press("Enter")
  await expect(chat).toBeHidden()
  await expect(frame).toBeFocused()

  // 失敗した返事は、印の言葉を変える
  await page.getByTestId("table-expand").click()
  await expect(chat).toBeVisible()
  await fakeReply(page, "合成の失敗", 1500, true)
  await page.getByTestId("chat-input").fill("もう一度")
  await page.getByTestId("chat-send").click()
  await toggle.click()
  await expect(chat).toBeHidden()
  await expect(page.getByTestId("chat-unread")).toHaveAttribute("data-kind", "error")
  await expect(toggle).toHaveAttribute("aria-label", "チャットを出す（エラーがあります）")

  // たたんだままのアップロード（ドラッグ）は結果がチャットにだけ出るので印を付ける
  await toggle.click()
  await toggle.click()
  await expect(page.getByTestId("chat-unread")).toHaveCount(0)
  await page.getByTestId("chat-file-input").setInputFiles({ name: "合成メモ.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") })
  await expect(page.getByTestId("chat-unread")).toBeVisible()

  // タブを切り替えても広げたまま。戻す
  await page.getByTestId("tab-replace").click()
  await expect(chat).toBeHidden()
  await page.getByTestId("tab-table").click()
  await toggle.click()
  await expect(chat).toBeVisible()
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull()
  await deleteCustomer(page, customer)
})

test("狭い画面には「表を広げる」を出さない（作業の画面はもともと画面いっぱいに重なる）", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { customer } = await convertFixture(page, FIXTURE)
  await page.getByTestId("work-open").click()
  await expect(page.getByTestId("preview-table")).toBeVisible()
  await expect(page.getByTestId("table-expand")).toHaveCount(0)
  await expect(page.getByTestId("color-legend")).toBeVisible()
  await page.getByTestId("work-close").click()
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
  await deleteCustomer(page, customer)
})
