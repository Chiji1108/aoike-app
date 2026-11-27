import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { createUIMessageStream, createUIMessageStreamResponse } from "ai"
import type { ChatMetadata } from "../src/lib/chat/messages"
import { proposalKey, type ChatChange, type Proposal, type ProposalRecord } from "../src/lib/chat/proposals"
import { callsServerFn, convertFixture, deleteCustomer, open, openNewCase, reload } from "./helpers"

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname

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

const input = (page: Page, list: string) => page.getByTestId(list).getByTestId("rules-input")

async function saveRules(page: Page, list: string, text: string) {
  await input(page, list).fill(text)
  await page.getByTestId(list).getByTestId("rules-save").click()
  await expect(page.getByTestId(list).getByTestId("rules-length")).not.toContainText("まだ保存していません")
}

test("全体ルール: 文章を直して保存すると開き直しても残る。7割の計算は選んで保存する", async ({ page }) => {
  await open(page, "/csv/rules")
  const list = "global-rules"
  const before = await input(page, list).inputValue()
  expect(before).not.toBe("")
  const added = `${before}\n- 全体ルールE2E-${Date.now()}`
  await input(page, list).fill(added)
  await expect(page.getByTestId(list).getByTestId("rules-length")).toContainText("まだ保存していません")
  await page.getByTestId(list).getByTestId("rules-save").click()
  await expect(page.getByTestId(list).getByTestId("rules-length")).not.toContainText("まだ保存していません")
  await reload(page)
  await expect(input(page, list)).toHaveValue(added)
  await saveRules(page, list, before)
  await reload(page)
  await expect(input(page, list)).toHaveValue(before)

  await page.getByTestId("rule7-tax-included").click()
  await reload(page)
  await expect(page.getByTestId("rule7-tax-included")).toHaveAttribute("aria-pressed", "true")
  await page.getByTestId("rule7-tax-excluded").click()
  await reload(page)
  await expect(page.getByTestId("rule7-tax-excluded")).toHaveAttribute("aria-pressed", "true")
})

test("顧客ルール: 2つの画面で直すと、後から保存した方は断って今の文章を見せる（入力は残し、保存し直すと置き換える）", async ({ page, context }) => {
  const { customer } = await openNewCase(page)
  created.push(customer)
  await page.getByRole("link", { name: customer }).click()
  const url = page.url()
  const list = "customer-rules"
  await expect(input(page, list)).toHaveValue("")
  await saveRules(page, list, "- 備考に「除外」とある行は載せない")

  const other = await context.newPage()
  await open(other, url)
  await expect(input(other, list)).toHaveValue("- 備考に「除外」とある行は載せない")
  await saveRules(page, list, "- 備考に「除外」「対象外」とある行は載せない")
  // もう1つの画面は古い文章のまま直す → 断って今の文章を見せる
  await input(other, list).fill("- 完成年月は引渡日")
  await other.getByTestId(list).getByTestId("rules-save").click()
  await expect(other.getByTestId(list).getByTestId("rules-conflict")).toContainText("備考に「除外」「対象外」とある行は載せない")
  await expect(input(other, list)).toHaveValue("- 完成年月は引渡日")
  await reload(page)
  await expect(input(page, list)).toHaveValue("- 備考に「除外」「対象外」とある行は載せない")
  // 確かめて保存し直すと置き換わる
  await other.getByTestId(list).getByTestId("rules-save").click()
  await expect(other.getByTestId(list).getByTestId("rules-conflict")).toHaveCount(0)
  await reload(page)
  await expect(input(page, list)).toHaveValue("- 完成年月は引渡日")
  await other.close()
})

test("保存を続けて押しても1回だけ送り、自分の保存を「ほかの画面で保存された」と出さない", async ({ page }) => {
  const { customer } = await openNewCase(page)
  created.push(customer)
  await page.getByRole("link", { name: customer }).click()
  const list = "customer-rules"
  let calls = 0
  // 保存を遅らせ、返る前に続けて押す
  await page.route(
    (url) => callsServerFn(url.href, ["saveRulesFn"]),
    async (route) => {
      calls++
      await new Promise((r) => setTimeout(r, 800))
      await route.fallback()
    },
  )
  await input(page, list).fill("- 完成年月は引渡日")
  const save = page.getByTestId(list).getByTestId("rules-save")
  await save.evaluate((el: HTMLButtonElement) => {
    el.click()
    el.click()
  })
  await expect(page.getByTestId(list).getByTestId("rules-length")).not.toContainText("まだ保存していません")
  expect(calls).toBe(1)
  await expect(page.getByTestId(list).getByTestId("rules-conflict")).toHaveCount(0)
})

/** 手元の R2（開発サーバーと同じ .wrangler/state）に変更案の記録を置く（サーバーのチャットが置くのと同じ形。承認はサーバーがここから読む） */
function putProposalRecord(caseId: string, record: ProposalRecord) {
  const file = join(mkdtempSync(join(tmpdir(), "proposal-")), "record.json")
  writeFileSync(file, JSON.stringify(record))
  execFileSync("pnpm", ["exec", "wrangler", "r2", "object", "put", `aoike-kensetsu-csv-files/${proposalKey(caseId, record.proposal.id)}`, "--local", "--file", file, "--content-type", "application/json"], {
    stdio: ["ignore", "ignore", "inherit"],
  })
}

test("チャットのルールに足す行の案を承認すると、顧客ルールの文章の最後に「- 」の行として足す", async ({ page }) => {
  const { customer, caseUrl } = await convertFixture(page, FIXTURE)
  created.push(customer)
  const caseId = caseUrl.split("/").at(-1)!
  const rule = `注文者の株式会社は㈱にする（E2E${Date.now()}）`
  const changes: ChatChange[] = [{ kind: "rule", scope: "customer", text: rule }]
  const proposal: Proposal = { id: `rule-${Date.now()}`, origin: { kind: "chat", messageId: "m1" }, question: null, state: "open", count: 1, applied: [], rejected: [] }
  putProposalRecord(caseId, { proposal, changes })
  // チャットのサーバーの代わり（返事と変更案だけ。記録は上で置いた）
  await page.route("**/api/csv/cases/*/chat", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    const metadata: ChatMetadata = { usd: 0.01, caseUsd: 0.5, ms: 1000, inputTokens: 100, outputTokens: 10, toolCalls: 1 }
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "start", messageId: "a1" })
        writer.write({ type: "text-start", id: "t" })
        writer.write({ type: "text-delta", id: "t", delta: "顧客ルールに1行足す案です。" })
        writer.write({ type: "text-end", id: "t" })
        writer.write({ type: "data-proposal", data: { id: proposal.id } })
        writer.write({ type: "data-proposal-content", data: { proposal, changes }, transient: true })
        writer.write({ type: "message-metadata", messageMetadata: metadata })
        writer.write({ type: "finish" })
      },
    })
    const res = createUIMessageStreamResponse({ stream })
    await route.fulfill({ status: 200, headers: Object.fromEntries(res.headers), body: await res.text() })
  })
  await page.getByTestId("chat-input").fill("今日のやり方を顧客ルールに追加して")
  await page.getByTestId("chat-send").click()
  const card = page.getByTestId("proposal").last()
  await card.getByTestId("proposal-apply-all").click()
  await expect(page.getByTestId("proposal-closed").last()).toContainText("反映 1 件")
  // 承認を取り消せる記録にも「ルールに足した行は残る」と出す
  await expect(page.getByTestId("proposal-undo-line").last()).toContainText("ルールに足した行は取り消しても残ります")

  await page.getByRole("link", { name: customer }).click()
  await expect(input(page, "customer-rules")).toHaveValue(`- ${rule}`)
})
