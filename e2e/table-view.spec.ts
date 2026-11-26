import { expect, test, type Page, type Route } from "@playwright/test"
import { createUIMessageStream, createUIMessageStreamResponse } from "ai"
import type { ChatMetadata } from "../src/lib/chat/messages"
import { convertFixture, deleteCustomer, reload, showAllRows } from "./helpers"

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname
const KEY = "csv-table-expanded"

/** チャットのサーバーの代わりに、delayMs 待ってから決まった文の返事を返す（会話を読む GET はサーバーのまま） */
async function fakeReply(page: Page, text: string, delayMs: number) {
  await page.route("**/api/csv/cases/*/chat", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback()
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
  const tones = await tableTones(page)
  const shown = await legend.locator("li").evaluateAll((lis) => lis.map((li) => (li as HTMLElement).dataset.tone!))
  // 色なし（そのまま）は凡例に出さない。出す種類は表のセルの色とちょうど同じ
  expect(shown.sort()).toEqual(tones.filter((t) => t !== "ok").sort())
  expect(shown.length).toBeGreaterThan(0)
  if (shown.includes("warning")) await expect(legend.locator('li[data-tone="warning"]')).toHaveAttribute("title", /AI の推定・手書き・警告/)
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
