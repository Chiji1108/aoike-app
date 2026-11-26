import { expect, test, type Page } from "@playwright/test"
import { createUIMessageStream, createUIMessageStreamResponse } from "ai"
import type { ChatChange, Proposal } from "../src/lib/chat/proposals"
import { callsServerFn, deleteCustomer, openNewCase, openTab, reload, showAllRows } from "./helpers"

/**
 * 変更案と取り消しの決まり: チャットの承認のあとに画面の操作（載せる工事の切り替え）を何度しても、承認を取り消せる（操作は別の枠で数える）。
 * 中身（サーバーの記録）の無い開いた変更案は、開き直すと閉じて報告に1行出し、すぐ保存する（もう一度開いても出さない）。
 * 列の対応は見出しからの推定にし（計画の AI を断る）、チャットは決まった返事にする（サーバーに変更案の記録を置かない）
 */

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname
const VALUE = "取り消しの確かめの工事"

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

/** チャットのサーバーの代わりに、変更案を1つ付けた決まった返事を返す（変更案の記録はサーバーに置かない） */
async function fakeChat(page: Page, changes: ChatChange[]) {
  await page.route("**/api/csv/cases/*/chat", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    const body = route.request().postDataJSON() as { id: string }
    const proposal: Proposal = { id: `p-${Date.now()}`, origin: { kind: "chat", messageId: body.id }, question: null, state: "open", count: changes.length, applied: [], rejected: [] }
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "start", messageId: `a-${Date.now()}` })
        writer.write({ type: "text-start", id: "t" })
        writer.write({ type: "text-delta", id: "t", delta: "工事名を直す案です。" })
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

/** 変換して、最初の行の key と工事名のセルを返す */
async function convert(page: Page) {
  const { customer } = await openNewCase(page)
  created.push(customer)
  await page.route((url) => callsServerFn(url.href, ["planWithAi"]), (route) => route.fulfill({ status: 500, body: "計画の AI を使わない" }))
  await page.getByTestId("chat-file-input").setInputFiles(FIXTURE)
  await expect(page.getByTestId("case-report")).toHaveAttribute("data-phase", "done", { timeout: 300_000 })
  await showAllRows(page)
  const key = (await page.locator('[data-testid="preview-table"] tbody tr[data-row-key]').first().getAttribute("data-row-key"))!
  const workName = () => page.locator(`tr[data-row-key="${key}"] td[data-field="workName"] button > span`).first()
  return { key, workName }
}

async function ask(page: Page) {
  await page.getByTestId("chat-input").fill("工事名を直して")
  await page.getByTestId("chat-send").click()
  await expect(page.getByTestId("proposal")).toBeVisible()
}

/** 次にやることの「答える」の数（済みなら 0） */
const answers = async (page: Page) => {
  const step = page.getByTestId("next-step-answer")
  if ((await step.getAttribute("data-done")) === "1") return 0
  return Number(/(\d+)/.exec((await step.textContent()) ?? "")![1])
}

/** 変えたあと、保存を待って送り終えるまで（すぐ読むと前の「保存済み」のまま） */
async function saved(page: Page) {
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "pending")
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 30_000 })
}

test("承認のあとに載せる工事を15回切り替えても承認を取り消せ、開き直しても戻ったまま", async ({ page }) => {
  const { key, workName } = await convert(page)
  const before = await workName().textContent()
  await fakeChat(page, [{ kind: "cell", rowKey: key, field: "workName", edit: { value: VALUE, by: "chat" } }])
  await ask(page)
  await page.getByTestId("proposal-apply-all").click()
  await expect(workName()).toHaveText(VALUE)

  await test.step("載せる工事を15回切り替える（操作の記録は別の枠。直前の数回だけ残る）", async () => {
    await openTab(page, "selection")
    for (let i = 0; i < 15; i++) {
      const mode = i % 2 === 0 ? "all" : "rule7"
      await page.getByTestId(`selection-${mode}`).click()
      await expect(page.getByTestId(`selection-${mode}`)).toHaveAttribute("aria-pressed", "true")
    }
  })

  await test.step("承認を取り消すと工事名が戻り、開き直しても戻ったまま", async () => {
    await page.getByTestId("proposal-undo").click()
    await saved(page)
    await expect(page.getByTestId("proposal-undone")).toBeVisible()
    await showAllRows(page)
    await expect(workName()).toHaveText(before!)
    await reload(page)
    await expect(page.getByTestId("preview-table")).toBeVisible({ timeout: 60_000 })
    await showAllRows(page)
    await expect(workName()).toHaveText(before!)
    // 載せる工事は最後に切り替えたまま（取り消したのは承認だけ）
    await openTab(page, "selection")
    await expect(page.getByTestId("selection-all")).toHaveAttribute("aria-pressed", "true")
  })
})

test("中身（サーバーの記録）の無い開いた変更案は、開き直すと閉じて報告に1行出し、すぐ保存するので何も変えずにもう一度開き直すと出さない", async ({ page }) => {
  const { key } = await convert(page)
  await fakeChat(page, [{ kind: "cell", rowKey: key, field: "workName", edit: { value: VALUE, by: "chat" } }])
  await ask(page)
  // 決めないまま保存する（決まった返事なので、サーバーに変更案の記録が無い）
  await saved(page)
  const before = await answers(page)
  // 開き直すと、閉じた形をすぐ保存する（保存の要求を待つ）
  const savedOnOpen = page.waitForResponse((res) => callsServerFn(res.url(), ["saveCaseStateFn"]) && res.ok(), { timeout: 60_000 })
  await reload(page)
  await expect(page.getByTestId("case-report")).toHaveAttribute("data-phase", "done", { timeout: 60_000 })
  await expect(page.getByTestId("closed-missing")).toContainText("中身の記録が無い変更案を 1 件閉じました")
  // 答えるものとして数えない
  await expect.poll(() => answers(page)).toBe(before - 1)
  // 閉じた形は開いた直後に保存したので、何も変えずに開き直しても出さない
  await savedOnOpen
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 30_000 })
  await reload(page)
  await expect(page.getByTestId("case-report")).toHaveAttribute("data-phase", "done", { timeout: 60_000 })
  await expect(page.getByTestId("closed-missing")).toHaveCount(0)
  await expect.poll(() => answers(page)).toBe(before - 1)
})
