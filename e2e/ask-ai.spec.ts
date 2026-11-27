import type { Page } from "@playwright/test"
import { expect, test } from "./fake-ai"
import { createUIMessageStream, createUIMessageStreamResponse } from "ai"
import { callsServerFn, deleteCustomer, openNewCase, openTab } from "./helpers"

/**
 * 計画の聞き返しのカードの「AI に聞く」: 押すと聞き返しを特定できる決まった質問が職員の発言としてチャットに出て、AI の返事が続く
 * （返事の間は押せない。答えではないので聞き返しは開いたまま）。狭い画面でも押すとチャットに質問が見える。
 * 計画の AI とチャットは決まった応答にする（合成 fixture）
 */

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname

const col = (column: number, transform: string) => ({ kind: "column", column, transform, instruction: null })

/** 合成 fixture（sample-messy.xlsx の「工事経歴」）の列の対応。備考（K列）に値のある1行を「載せるか迷う行」として聞き返す */
const PLAN = {
  sheets: [0],
  sheetReason: "工事ごとに1行の一覧",
  headerRow: 2,
  dataStart: 3,
  skipRows: [10, 11, 12],
  excludeColumns: [],
  amountUnit: "yen",
  amountTax: "included",
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

const ANSWER = "備考の注記は、ほかの工事と重なっている印かもしれません。迷うときは表で見るか、顧客に聞いてください。"

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

async function fakePlan(page: Page) {
  await page.route(
    (url) => callsServerFn(url.href, ["planWithAi"]),
    (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { ok: true, json: PLAN, usd: 0 } }) }),
  )
}

/** チャットのサーバーの代わりに決まった返事（文だけ）を返す。届いた指示の本文を texts に溜め、release を呼ぶまで返事を待たせる */
async function fakeChat(page: Page, texts: string[]) {
  let release = () => {}
  const held = new Promise<void>((r) => (release = r))
  await page.route("**/api/csv/cases/*/chat", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    texts.push((route.request().postDataJSON() as { text: string }).text)
    await held
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "start", messageId: `a-${Date.now()}` })
        writer.write({ type: "text-start", id: "t" })
        writer.write({ type: "text-delta", id: "t", delta: ANSWER })
        writer.write({ type: "text-end", id: "t" })
        writer.write({ type: "message-metadata", messageMetadata: { usd: 0.01, caseUsd: 0.1, ms: 1000, inputTokens: 1, outputTokens: 1, toolCalls: 0 } })
        writer.write({ type: "finish" })
      },
    })
    const res = createUIMessageStreamResponse({ stream })
    await route.fulfill({ status: 200, headers: Object.fromEntries(res.headers), body: await res.text() })
  })
  return () => release()
}

async function upload(page: Page) {
  await page.getByTestId("chat-file-input").setInputFiles(FIXTURE)
  await expect(page.getByTestId("case-report")).toHaveAttribute("data-phase", "done", { timeout: 300_000 })
}

/** 「答える」の段の計画の聞き返し（聞き返しに答えるのは答えるの段だけ） */
const question = (page: Page) => page.locator('[data-testid="answer-section"] [data-testid="report-question"][data-question="plan-ask-0"]')

test("聞き返しの「AI に聞く」で、聞き返しを特定できる質問が職員の発言としてチャットに出て、返事の間は押せない。狭い画面でもチャットに出る", async ({ page }) => {
  const { customer } = await openNewCase(page)
  created.push(customer)
  await fakePlan(page)
  const texts: string[] = []
  const release = await fakeChat(page, texts)
  await upload(page)
  const ask = question(page).getByTestId("report-question-ask")
  await expect(ask).toBeEnabled()

  await test.step("押すと決まった質問を送る（聞き返しの文と元の Excel の行番号）。返事の間はほかの聞き返しも押せない", async () => {
    await ask.click()
    await expect(page.getByTestId("chat-messages")).toContainText("計画の聞き返し「備考（K列）に注記のある行があります。」は、どういうことですか？")
    await expect(ask).toBeDisabled()
    release()
    await expect(page.getByTestId("chat-messages")).toContainText(ANSWER)
    await expect(ask).toBeEnabled()
    expect(texts).toHaveLength(1)
    expect(texts[0]).toMatch(/^計画の聞き返し「備考（K列）に注記のある行があります。」は、どういうことですか？ 対象は表の 1 行（元の Excel の「工事経歴」\d+行目）です。/)
    // 答えではないので聞き返しは開いたまま。入力欄の書きかけは消さない
    await expect(question(page)).toHaveAttribute("data-pending", "1")
  })

  await test.step("狭い画面でも、重ねて開いた答えるの段から押すと作業の画面を閉じ、チャットに質問が見える", async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByTestId("work-frame")).toBeHidden()
    await page.getByTestId("chat-input").fill("書きかけ")
    await page.getByTestId("work-open").click()
    await openTab(page, "answer")
    await question(page).getByTestId("report-question-ask").click()
    await expect(page.getByTestId("work-frame")).toBeHidden()
    await expect.poll(() => texts.length).toBe(2)
    const sent = page.getByTestId("chat-messages").getByText("どういうことですか？").last()
    await expect(sent).toBeInViewport()
    await expect(page.getByTestId("chat-input")).toHaveValue("書きかけ")
  })

  await test.step("答えると「AI に聞く」は出さない", async () => {
    await page.setViewportSize({ width: 1500, height: 1000 })
    await openTab(page, "answer")
    await question(page).locator('[data-value="keep"]').click()
    await expect(question(page)).toHaveAttribute("data-answered", "載せる")
    await expect(question(page).getByTestId("report-question-ask")).toHaveCount(0)
    await expect(question(page).getByTestId("report-question-detail")).toHaveText("該当 1 行")
  })
})
