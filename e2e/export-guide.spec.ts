import { expect, test, type Page } from "@playwright/test"
import { createUIMessageStream, createUIMessageStreamResponse } from "ai"
import type { ChatChange, Proposal } from "../src/lib/chat/proposals"
import { callsServerFn, csvCount, deleteCustomer, openNewCase, openTab } from "./helpers"

/**
 * ダウンロードの前の確認で、残っている聞き返しに答える: ダウンロードのボタンは矢印のアイコンで、残りがあれば右上に点 → 開くと、税込・税抜と計画の聞き返しを
 * 報告と同じ部品で出し、CSV・Excel は「このままダウンロード」の控えめな見た目 → 画面の中で答えると件数・7割の額がその場で変わり、ボタンが元の見た目に戻る →
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

/** ダウンロードの前の確認の中の聞き返し */
const ask = (page: Page, id: string) => page.getByTestId("export-dialog").locator(`[data-testid="report-question"][data-question="${id}"]`)
/** 決算書の額の欄に出す、業種ごとの表の合計（7割の基準と同じ額。税込・税抜の答えで変わる） */
const rowTotals = (page: Page) => page.getByTestId("export-dialog").getByTestId("basis-editor").innerText()

test("ダウンロードの前の確認で聞き返しに答えると、件数・7割がその場で変わり、ボタンが元に戻る。取り消すと戻る", async ({ page }) => {
  const { customer } = await openNewCase(page)
  created.push(customer)
  await fakePlan(page)
  await page.getByTestId("chat-file-input").setInputFiles(FIXTURE)
  await expect(page.getByTestId("case-report")).toHaveAttribute("data-phase", "done", { timeout: 300_000 })
  await expect(page.getByTestId("preview-table")).toBeVisible()
  // 全件を載せる（迷う行も載る）にして、答えで載せる件数が変わるのを見る
  await openTab(page, "selection")
  await page.getByTestId("selection-all").click()
  await expect.poll(() => csvCount(page)).toBe(7)

  const button = page.getByTestId("export-button")
  const dialog = page.getByTestId("export-dialog")
  const footer = page.getByTestId("export-footer")

  await test.step("ダウンロードは矢印のアイコン。残りがあれば右上に点を出し、意味はツールチップ", async () => {
    await expect(button.locator("svg.lucide-download")).toHaveCount(1)
    await expect(button).toHaveAttribute("data-left", "1")
    await expect(button.getByTestId("export-badge")).toBeVisible()
    await expect(button).toHaveAttribute("title", /^残り: 答える 2/)
  })

  await test.step("開くと、答えていない聞き返しを画面の中に出し、ダウンロードのボタンは「このままダウンロード」の控えめな見た目", async () => {
    await button.click()
    await expect(dialog.getByTestId("export-answers")).toHaveAttribute("data-left", "2")
    await expect(ask(page, "tax")).toContainText("税込ですか、税抜ですか")
    await expect(ask(page, "plan-ask-0")).toContainText("備考（K列）に注記のある行があります。")
    // 「答える」は上に1つずつ出すので、残りのボタンには出さない
    await expect(dialog.getByTestId("export-remaining-answer")).toHaveCount(0)
    await expect(footer).toHaveAttribute("data-unsettled", "1")
    await expect(dialog.getByTestId("download-button")).toHaveText("このままダウンロード（CSV）")
    await expect(dialog.getByTestId("export-excel")).toHaveText("このままダウンロード（Excel）")
    await expect(dialog.getByTestId("export-rows")).toHaveText("7")
  })

  const before = await rowTotals(page)
  await test.step("税込・税抜に答えると、7割の額がその場で変わる（画面は閉じない。分からない間は税込として見ているので、税抜と答える）", async () => {
    await ask(page, "tax").locator('[data-value="excluded"]').click()
    await expect(ask(page, "tax")).toHaveAttribute("data-answered", "税抜")
    await expect.poll(() => rowTotals(page)).not.toBe(before)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId("export-answers")).toHaveAttribute("data-left", "1")
    await expect(footer).toHaveAttribute("data-unsettled", "1")
  })

  await test.step("計画の聞き返しに「載せない」と答えると、載せる件数が減り、ボタンが元の見た目に戻る", async () => {
    await ask(page, "plan-ask-0").locator('[data-value="exclude"]').click()
    await expect(ask(page, "plan-ask-0")).toHaveAttribute("data-answered", "載せない")
    await expect(dialog.getByTestId("export-rows")).toHaveText("6", { timeout: 60_000 })
    await expect(dialog.getByTestId("export-answers")).toHaveAttribute("data-left", "0")
    await expect(footer).toHaveAttribute("data-unsettled", "0")
    await expect(dialog.getByTestId("download-button")).toHaveText("CSV")
    await expect(dialog.getByTestId("export-excel")).toHaveText("Excel")
    await expect(button).toHaveAttribute("title", /^(?!.*答える)/)
  })

  await test.step("取り消すと答えが戻り、件数・7割の額・ボタンの見た目も戻る", async () => {
    await ask(page, "plan-ask-0").getByTestId("report-question-undo").click()
    await expect(ask(page, "plan-ask-0")).toHaveAttribute("data-pending", "1")
    await expect(dialog.getByTestId("export-rows")).toHaveText("7", { timeout: 60_000 })
    await ask(page, "tax").getByTestId("report-question-undo").click()
    await expect(ask(page, "tax")).toHaveAttribute("data-pending", "1")
    await expect.poll(() => rowTotals(page)).toBe(before)
    await expect(dialog.getByTestId("export-answers")).toHaveAttribute("data-left", "2")
    await expect(footer).toHaveAttribute("data-unsettled", "1")
  })

  await test.step("キーボードで答えられる。「表で見る」は画面を閉じて表へ移る", async () => {
    await ask(page, "plan-ask-0").locator('[data-value="keep"]').focus()
    await page.keyboard.press("Enter")
    await expect(ask(page, "plan-ask-0")).toHaveAttribute("data-answered", "載せる")
    await ask(page, "plan-ask-0").getByTestId("report-question-view").click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId("ask-filter")).toContainText("載せるか迷う行")
  })

  await test.step("開き直すと、答えたものは出さず、答えていないものだけ出す", async () => {
    await button.click()
    await expect(ask(page, "plan-ask-0")).toHaveCount(0)
    await expect(ask(page, "tax")).toHaveAttribute("data-pending", "1")
  })

  await test.step("税込・税抜を「分からない（顧客に聞く）」と答えても、金額と7割が決まらないので控えめのまま", async () => {
    await ask(page, "tax").locator('[data-value="ask"]').click()
    await expect(ask(page, "tax")).toHaveAttribute("data-answered", "分からない（顧客に聞く）")
    await expect(dialog.getByTestId("export-answers")).toHaveAttribute("data-left", "0")
    await expect(footer).toHaveAttribute("data-unsettled", "1")
    await expect(dialog.getByTestId("export-excel")).toHaveText("このままダウンロード（Excel）")
    await ask(page, "tax").getByTestId("report-question-undo").click()
    await expect(ask(page, "tax")).toHaveAttribute("data-pending", "1")
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
  })

  await test.step("「AI に聞く」は確認を閉じ、チャットのその聞き返しの「AI に聞く」に合わせる（答えのボタンには合わせない）", async () => {
    // 答えた聞き返しには「AI に聞く」が出ないので、チャットの報告で答えを取り消して開き直す
    const inChat = page.locator('[data-testid="case-report"] [data-question="plan-ask-0"]')
    await inChat.getByTestId("report-question-undo").click()
    await expect(inChat).toHaveAttribute("data-pending", "1")
    await button.click()
    const go = ask(page, "plan-ask-0").getByTestId("report-question-ask")
    await expect(go).toBeEnabled()
    await go.click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('[data-testid="case-report"] [data-question="plan-ask-0"] [data-testid="report-question-ask"]')).toBeFocused()
  })
})

test("ダウンロードの前の確認の中でも、載せる件数が大きく減る答えは確かめを重ねて出し、やめると確認に戻る", async ({ page }) => {
  const { customer } = await openNewCase(page)
  created.push(customer)
  // 工種（B列）に値のある行＝全行を「載せるか迷う行」として聞く
  await fakePlan(page, { ...PLAN, amountTax: "included", asks: [{ kind: "doubtful", text: "工種の列に値のある行があります。", column: 1, values: [] }] })
  await page.getByTestId("chat-file-input").setInputFiles(FIXTURE)
  await expect(page.getByTestId("case-report")).toHaveAttribute("data-phase", "done", { timeout: 300_000 })
  await openTab(page, "selection")
  await page.getByTestId("selection-all").click()
  await expect.poll(() => csvCount(page)).toBe(7)
  await page.getByTestId("export-button").click()
  const dialog = page.getByTestId("export-dialog")
  const confirm = page.getByTestId("ask-confirm")

  await ask(page, "plan-ask-0").locator('[data-value="exclude"]').click()
  await expect(confirm).toContainText("載せる工事が 7 件から 0 件に減ります")
  await confirm.getByTestId("ask-confirm-cancel").click()
  await expect(confirm).toBeHidden()
  await expect(dialog).toBeVisible()
  await expect(ask(page, "plan-ask-0")).toHaveAttribute("data-pending", "1")
  await expect(dialog.getByTestId("export-rows")).toHaveText("7")

  // Escape は上の確かめだけを閉じる
  await ask(page, "plan-ask-0").locator('[data-value="exclude"]').click()
  await expect(confirm).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(confirm).toBeHidden()
  await expect(dialog).toBeVisible()

  await ask(page, "plan-ask-0").locator('[data-value="exclude"]').click()
  await confirm.getByTestId("ask-confirm-ok").click()
  await expect(ask(page, "plan-ask-0")).toHaveAttribute("data-answered", "載せない")
  await expect(dialog.getByTestId("export-rows")).toHaveText("0", { timeout: 60_000 })
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

test("AI の聞き返しはダウンロードの前の確認でも答えられ、承認はチャットへ移って決める。ボタンの見た目は変えない", async ({ page }) => {
  const { customer } = await openNewCase(page)
  created.push(customer)
  await fakePlan(page, { ...PLAN, amountTax: "included", asks: [] })
  await page.getByTestId("chat-file-input").setInputFiles(FIXTURE)
  await expect(page.getByTestId("case-report")).toHaveAttribute("data-phase", "done", { timeout: 300_000 })
  const key = await page.locator('[data-testid="preview-table"] tbody tr[data-row-key]').first().getAttribute("data-row-key")
  await fakeChatWithQuestion(page, [{ kind: "include", rowKey: key!, include: false }])
  await page.getByTestId("chat-input").fill("1行目を外して")
  await page.getByTestId("chat-send").click()
  await expect(page.getByTestId("confirmation")).toBeVisible()

  await page.getByTestId("export-button").click()
  const dialog = page.getByTestId("export-dialog")
  const item = dialog.locator('[data-testid="report-question"][data-question^="proposal:"]')
  await expect(item).toContainText("この工事は外してよいですか")
  // AI の聞き返しは金額・7割・載せる行に関わるとは限らないので、ボタンは控えめにしない
  await expect(page.getByTestId("export-footer")).toHaveAttribute("data-unsettled", "0")
  await item.locator('[data-value="yes"]').click()
  // 「はい」で承認できるようになる。承認は中身を見てチャットで
  await expect(item).toContainText("チャットの変更案の承認待ち 1 件")
  await expect(dialog).toBeVisible()
  await item.getByTestId("report-question-ask").click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-testid="chat-column"] [data-testid="proposal-apply-all"]')).toBeEnabled()
  await expect(page.getByTestId("confirmation")).toHaveAttribute("data-answered", "yes")
})
