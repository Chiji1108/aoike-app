import type { Page } from "@playwright/test"
import { expect, test } from "./fake-ai"
import { createUIMessageStream, createUIMessageStreamResponse } from "ai"
import type { ChatChange, Proposal } from "../src/lib/chat/proposals"
import { attachAndConvert, callsServerFn, csvCount, deleteCustomer, openExport, openNewCase, openTab } from "./helpers"

/**
 * ダウンロードの段と、残っている聞き返し: ダウンロードの段は矢印のアイコンで、残りがあれば右上に点 → 開くと残り（答える N）と、
 * CSV・Excel は「このままダウンロード」の控えめな見た目 → 聞き返しは「答える」の段で答え、件数・7割の額が変わり、ボタンが元の見た目に戻る →
 * 取り消すと戻る。計画の AI の応答は決まったもの（合成 fixture の列の対応。税込・税抜は決めず、備考の列に値のある行を「載せるか迷う行」として聞く）
 */

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname

const col = (column: number, transform: string) => ({ kind: "column", column, transform, instruction: null })

const PLAN = {
  sheets: [0],
  sheetReason: "工事ごとに1行の一覧",
  headerRow: 2,
  dataStart: 3,
  skipRows: [10, 11, 12],
  excludeColumns: [],
  amountUnit: "yen",
  amountTax: "unknown",
  fields: {
    gyoshu: col(1, "rule.gyoshu"),
    client: col(3, "ai.anonymizeClient"),
    motoukeShitauke: { kind: "columns", columns: [4, 3], transform: "rule.motoukeShitauke", instruction: null },
    jv: { kind: "constant", value: "0", reason: "JV列なし" },
    workName: col(2, "ai.anonymizeWorkName"),
    prefecture: col(5, "rule.addressPrefecture"),
    place: col(5, "rule.addressCity"),
    engineer: col(9, "rule.personNameSpace"),
    amount: col(6, "rule.yenToThousand"),
    specialAmount: { kind: "constant", value: "0", reason: "該当なし" },
    startYm: col(7, "rule.periodStart"),
    endYm: col(8, "rule.yearMonth"),
    chiefEngineer: { kind: "missing" },
    supervisingEngineer: { kind: "missing" },
  },
  unusedColumns: [{ column: 0, header: "No.", reason: "連番" }],
  notes: [],
  asks: [{ kind: "doubtful", text: "備考（K列）に注記のある行があります。", column: 10, values: [] }],
}

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

async function fakePlan(page: Page, plan: object = PLAN) {
  await page.route(
    (url) => callsServerFn(url.href, ["planWithAi"]),
    (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { ok: true, json: plan, usd: 0 } }) }),
  )
}

/** 「答える」の段の聞き返し */
const ask = (page: Page, id: string) => page.getByTestId("answer-section").locator(`[data-testid="report-question"][data-question="${id}"]`)
/** 決算書の額の欄に出す、業種ごとの表の合計（7割の基準と同じ額。税込・税抜の答えで変わる） */
const rowTotals = (page: Page) => page.getByTestId("export-dialog").getByTestId("basis-editor").innerText()

async function convert(page: Page, plan: object = PLAN) {
  const { customer } = await openNewCase(page)
  created.push(customer)
  await fakePlan(page, plan)
  await attachAndConvert(page, FIXTURE, { table: false })
  await expect(page.getByTestId("work-panel")).toHaveAttribute("data-view", "answer")
}

test("ダウンロードの段: 残りは点とツールチップ。聞き返しが残る間は「このままダウンロード」。答えるの段で答えると件数・7割がその場で変わり、ボタンが元に戻る。取り消すと戻る", async ({ page }) => {
  await convert(page)
  // 全件を載せる（迷う行も載る）と答え、ほかの答えで載せる件数が変わるのを見る
  await ask(page, "selection").locator('[data-value="all"]').click()
  await expect.poll(() => csvCount(page)).toBe(7)

  const button = page.getByTestId("next-step-export")
  const dialog = page.getByTestId("export-dialog")
  const footer = page.getByTestId("export-footer")

  await test.step("ダウンロードは矢印のアイコン。残りがあれば右上に点を出し、意味はツールチップ", async () => {
    await expect(button.locator("svg.lucide-download")).toHaveCount(1)
    await expect(button.getByTestId("export-badge")).toBeVisible()
    await expect(button).toHaveAttribute("title", /^残り: 答える 2/)
  })

  await test.step("開くと残りの「答える」が出て（聞き返しはここでは答えない）、ボタンは「このままダウンロード」の控えめな見た目", async () => {
    await openExport(page)
    await expect(dialog.getByTestId("export-remaining-answer")).toHaveText("答える 2")
    await expect(dialog.getByTestId("report-question")).toHaveCount(0)
    await expect(footer).toHaveAttribute("data-unsettled", "1")
    await expect(dialog.getByTestId("download-button")).toHaveText("このままダウンロード（CSV）")
    await expect(dialog.getByTestId("export-excel")).toHaveText("このままダウンロード（Excel）")
    await expect(dialog.getByTestId("export-rows")).toHaveText("7")
  })

  const before = await rowTotals(page)
  await test.step("残りの「答える」で答えるの段へ移り、税抜と答えると7割の額が変わる（分からない間は税込として見ている）", async () => {
    await dialog.getByTestId("export-remaining-answer").click()
    await expect(page.getByTestId("work-panel")).toHaveAttribute("data-view", "answer")
    await ask(page, "tax").locator('[data-value="excluded"]').click()
    await expect(ask(page, "tax")).toHaveAttribute("data-answered", "税抜")
    await openExport(page)
    await expect.poll(() => rowTotals(page)).not.toBe(before)
    await expect(dialog.getByTestId("export-remaining-answer")).toHaveText("答える 1")
    await expect(footer).toHaveAttribute("data-unsettled", "1")
  })

  await test.step("計画の聞き返しに「載せない」と答えると、載せる件数が減り、ボタンが元の見た目に戻る", async () => {
    await openTab(page, "answer")
    await ask(page, "plan-ask-0").locator('[data-value="exclude"]').click()
    await expect(ask(page, "plan-ask-0")).toHaveAttribute("data-answered", "載せない")
    await expect.poll(() => csvCount(page), { timeout: 60_000 }).toBe(6)
    await openExport(page)
    await expect(dialog.getByTestId("export-rows")).toHaveText("6")
    await expect(dialog.getByTestId("export-remaining-answer")).toHaveCount(0)
    await expect(footer).toHaveAttribute("data-unsettled", "0")
    await expect(dialog.getByTestId("download-button")).toHaveText("CSV")
    await expect(dialog.getByTestId("export-excel")).toHaveText("Excel")
    await expect(button).toHaveAttribute("title", /^(?!.*答える)/)
  })

  await test.step("取り消すと答えが戻り、件数・7割の額・ボタンの見た目も戻る", async () => {
    await openTab(page, "answer")
    await ask(page, "plan-ask-0").getByTestId("report-question-undo").click()
    await expect(ask(page, "plan-ask-0")).toHaveAttribute("data-pending", "1")
    await expect.poll(() => csvCount(page), { timeout: 60_000 }).toBe(7)
    await ask(page, "tax").getByTestId("report-question-undo").click()
    await expect(ask(page, "tax")).toHaveAttribute("data-pending", "1")
    await openExport(page)
    await expect.poll(() => rowTotals(page)).toBe(before)
    await expect(dialog.getByTestId("export-remaining-answer")).toHaveText("答える 2")
    await expect(footer).toHaveAttribute("data-unsettled", "1")
  })

  await test.step("キーボードで答えられる。「表で見る」は表へ移る", async () => {
    await openTab(page, "answer")
    await ask(page, "plan-ask-0").locator('[data-value="keep"]').focus()
    await page.keyboard.press("Enter")
    await expect(ask(page, "plan-ask-0")).toHaveAttribute("data-answered", "載せる")
    await ask(page, "plan-ask-0").getByTestId("report-question-view").click()
    await expect(page.getByTestId("work-panel")).toHaveAttribute("data-view", "table")
    await expect(page.getByTestId("ask-filter")).toContainText("載せるか迷う行")
  })

  await test.step("税込・税抜を「分からない（顧客に聞く）」と答えても、金額と7割が決まらないので控えめのまま", async () => {
    await openTab(page, "answer")
    await ask(page, "tax").locator('[data-value="ask"]').click()
    await expect(ask(page, "tax")).toHaveAttribute("data-answered", "分からない（顧客に聞く）")
    await openExport(page)
    await expect(dialog.getByTestId("export-remaining-answer")).toHaveCount(0)
    await expect(footer).toHaveAttribute("data-unsettled", "1")
    await expect(dialog.getByTestId("export-excel")).toHaveText("このままダウンロード（Excel）")
  })
})

/** チャットのサーバーの代わりに、聞き返しの付いた変更案（行を1つ外す）を返す */
async function fakeChatWithQuestion(page: Page, changes: ChatChange[]) {
  await page.route("**/api/csv/cases/*/chat", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    const body = route.request().postDataJSON() as { id: string }
    const proposal: Proposal = { id: `p-${Date.now()}`, origin: { kind: "chat", messageId: body.id }, question: { text: "この工事は外してよいですか", answer: null }, state: "open", count: changes.length, applied: [], rejected: [] }
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "start", messageId: `a-${Date.now()}` })
        writer.write({ type: "text-start", id: "t" })
        writer.write({ type: "text-delta", id: "t", delta: "この行を CSV から外す案です。" })
        writer.write({ type: "text-end", id: "t" })
        writer.write({ type: "data-proposal", data: { id: proposal.id } })
        writer.write({ type: "data-proposal-content", data: { proposal, changes }, transient: true })
        writer.write({ type: "message-metadata", messageMetadata: { usd: 0.01, caseUsd: 0.1, ms: 1000, inputTokens: 1, outputTokens: 1, toolCalls: 1 } })
        writer.write({ type: "finish" })
      },
    })
    const res = createUIMessageStreamResponse({ stream })
    await route.fulfill({ status: 200, headers: Object.fromEntries(res.headers), body: await res.text() })
  })
}

test("AI の聞き返しは答えるの段でも答えられ、承認はチャットへ移って決める。ダウンロードのボタンの見た目は変えない", async ({ page }) => {
  await convert(page, { ...PLAN, amountTax: "included", asks: [] })
  await ask(page, "selection").locator('[data-value="rule7"]').click()
  await openTab(page, "table")
  const key = await page.locator('[data-testid="preview-table"] tbody tr[data-row-key]').first().getAttribute("data-row-key")
  await fakeChatWithQuestion(page, [{ kind: "include", rowKey: key!, include: false }])
  await page.getByTestId("chat-input").fill("1行目を外して")
  await page.getByTestId("chat-send").click()
  await expect(page.getByTestId("confirmation")).toBeVisible()

  await openTab(page, "answer")
  const item = page.getByTestId("answer-section").locator('[data-testid="report-question"][data-question^="proposal:"]')
  await expect(item).toContainText("この工事は外してよいですか")
  // AI の聞き返しは金額・7割・載せる行に関わるとは限らないので、ダウンロードのボタンは控えめにしない
  await expect(page.getByTestId("export-footer")).toHaveAttribute("data-unsettled", "0")
  await item.locator('[data-value="yes"]').click()
  // 「はい」で承認できるようになる。承認は中身を見てチャットで
  await expect(item).toContainText("チャットの変更案の承認待ち 1 件")
  await item.getByTestId("report-question-ask").click()
  await expect(page.locator('[data-testid="chat-column"] [data-testid="proposal-apply-all"]')).toBeEnabled()
  await expect(page.getByTestId("confirmation")).toHaveAttribute("data-answered", "yes")
})

/** 要素の文の最初の数（無ければ 0。済んだ段・数の無いタブ） */
const firstNumber = async (page: Page, testId: string) => Number(/(\d+)/.exec(await page.getByTestId(testId).innerText())?.[1] ?? 0)

test("残りの件数は、段の並び・ダウンロードの段・報告の1行・チャットの答えを待つ印・各段の中で同じ（外した問い合わせは数えない）", async ({ page }) => {
  // 税込・税抜を決めない計画（税の聞き返し）と、計画の聞き返し1つ
  await convert(page)
  await openTab(page, "table")
  const key = await page.locator('[data-testid="preview-table"] tbody tr[data-row-key]').first().getAttribute("data-row-key")
  await fakeChatWithQuestion(page, [{ kind: "include", rowKey: key!, include: false }])
  await page.getByTestId("chat-input").fill("1行目を外して")
  await page.getByTestId("chat-send").click()
  await expect(page.getByTestId("confirmation")).toBeVisible()

  await test.step("答える: 報告の聞き返し3つ（載せる工事・税・計画）とチャットの変更案1つ。段の並び・ツールチップ・答えるの段で同じ数、報告の1行は聞き返しの数", async () => {
    await expect(page.getByTestId("next-step-answer")).toContainText("4")
    await expect(page.getByTestId("next-step-export")).toHaveAttribute("title", /^残り: 答える 4/)
    await expect(page.getByTestId("report-answer-step")).toHaveAttribute("data-count", "3")
    // チャットの答えを待つ印は変更案だけ（報告に聞き返しを並べない）
    await expect(page.locator('[data-testid="chat-column"] [data-pending]')).toHaveCount(1)
    await openTab(page, "answer")
    await expect(page.getByTestId("answer-open").getByTestId("report-question")).toHaveCount(4)
    await expect(page.getByTestId("answer-step")).toHaveAttribute("data-left", "4")
  })

  await test.step("直す・業種を決める: 段の並びの数と、その段の中の数が同じ", async () => {
    const fix = await firstNumber(page, "next-step-fix")
    if (fix > 0) {
      await openTab(page, "fix")
      await expect(page.locator('[data-testid="preview-table"] tbody tr[data-row-key]')).toHaveCount(fix)
    }
    const gyoshu = await firstNumber(page, "next-step-gyoshu")
    await openTab(page, "gyoshu")
    if (gyoshu > 0) expect(await firstNumber(page, "gyoshu-count")).toBe(gyoshu)
  })

  await test.step("問い合わせ: 段の並びの数は問い合わせの段の数と同じで、外すと両方が減る", async () => {
    await openTab(page, "inquiry")
    const before = await firstNumber(page, "next-step-inquiry")
    expect(before).toBeGreaterThan(0)
    await expect(page.getByTestId("inquiry-counts")).toContainText(`問い合わせ ${before} 件`)
    await page.getByTestId("inquiry-panel").locator("summary").click()
    await page.locator('[data-testid="inquiry-list"] input[type="checkbox"]').first().uncheck()
    await expect(page.getByTestId("inquiry-counts")).toContainText(`問い合わせ ${before - 1} 件`)
    expect(await firstNumber(page, "next-step-inquiry")).toBe(before - 1)
  })
})
