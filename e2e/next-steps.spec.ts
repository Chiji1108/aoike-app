import { expect, test, type Page } from "@playwright/test"
import { attachAndConvert, callsServerFn, csvCount, deleteCustomer, openExport, openNewCase, openTab, reload } from "./helpers"

/**
 * 段で案内する作業の画面（答える → 業種を決める → 直す → 問い合わせ → ダウンロード ＋ 表 ＋ その他）: 開くと今の段、
 * 聞き返しは「答える」の段だけで答える（報告は1行）、段が済んでも勝手に移らず「次は」を押したときだけ移る、7割と決算書の額はダウンロードの段、狭い画面。
 * 計画の AI の応答は決まったもの（合成 fixture の列の対応と、備考の列に値のある行を「載せるか迷う行」として聞く聞き返し）にする
 */

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname

const col = (column: number, transform: string) => ({ kind: "column", column, transform, instruction: null })

/** 合成 fixture（sample-messy.xlsx の「工事経歴」）の列の対応。備考（K列）に値のある1行を聞き返す */
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
  notes: ["メモのシートに書類待ちの工事があります。"],
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

/** 計画の AI の代わりに決まった計画を返す（サーバー関数の返事は { result } の JSON） */
async function fakePlan(page: Page) {
  await page.route(
    (url) => callsServerFn(url.href, ["planWithAi"]),
    (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { ok: true, json: PLAN, usd: 0 } }) }),
  )
}

const question = (page: Page, id = "plan-ask-0") => page.locator(`[data-testid="answer-section"] [data-testid="report-question"][data-question="${id}"]`)
const view = (page: Page) => page.getByTestId("work-panel")

/** 計画の AI を決まった返事にして合成 fixture を変換する（作業の画面は今の段のまま） */
async function convert(page: Page) {
  const { customer } = await openNewCase(page)
  created.push(customer)
  await fakePlan(page)
  await attachAndConvert(page, FIXTURE, { table: false })
}

test("開くと今の段（答える）。聞き返しは答えるの段だけで答え、チャットの報告は1行。段が済んでも勝手に移らず、「次は」を押したときだけ移る", async ({ page }) => {
  await convert(page)

  await test.step("開いたときは今の段（答える）。報告には聞き返しの中身を並べず「聞き返しが N件あります → 答える」の1行", async () => {
    await expect(page.getByTestId("next-steps")).toHaveAttribute("data-current", "answer")
    await expect(view(page)).toHaveAttribute("data-view", "answer")
    // 載せる工事（新しい顧客なので聞く）と計画の聞き返し。計画が税込と決めたので税は聞かない
    await expect(page.getByTestId("next-step-answer")).toContainText("2")
    await expect(page.getByTestId("case-report").getByTestId("report-question")).toHaveCount(0)
    await expect(page.getByTestId("report-answer-step")).toHaveAttribute("data-count", "2")
    await expect(page.getByTestId("report-answer-step")).toContainText("聞き返しが 2件あります")
    await expect(page.getByTestId("report-notes")).toContainText("答えは要りません")
    await expect(page.getByTestId("report-notes")).toContainText("メモのシートに書類待ちの工事があります。")
  })

  await test.step("答えるの最初は載せる工事（7割ルール／全件。おすすめ付き）。計画の聞き返しは対象の行の数と答えの選択肢", async () => {
    const items = page.getByTestId("answer-section").getByTestId("report-question")
    await expect(items.first()).toHaveAttribute("data-question", "selection")
    await expect(question(page, "selection")).toContainText("載せる工事は？")
    // 合成 fixture は工事が少ないので、顧客の側で選んだ一覧と見て全件をすすめる（12行以下）
    await expect(question(page, "selection").locator('[data-value="all"]')).toHaveText("全件（おすすめ）")
    await expect(question(page)).toContainText("備考（K列）に注記のある行があります。")
    await expect(question(page).getByTestId("report-question-detail")).toHaveText("該当 1 行（今載せているのは 0 行）。どちらでも載せる件数は変わりません（この 1 行は今載せていません）")
    await expect(question(page).getByTestId("report-answer")).toHaveText(["載せない", "載せる"])
  })

  await test.step("「表で見る」で対象の行だけを表に出す（答えではないので聞き返しは開いたまま）。報告の1行を押すと答えるの段へ戻る", async () => {
    await question(page).getByTestId("report-question-view").click()
    await expect(view(page)).toHaveAttribute("data-view", "table")
    await expect(page.getByTestId("ask-filter")).toContainText("載せるか迷う行（1行）")
    await expect(page.locator('[data-testid="preview-table"] tbody tr[data-row-key]')).toHaveCount(1)
    await page.getByTestId("report-answer-step").click()
    await expect(view(page)).toHaveAttribute("data-view", "answer")
    await expect(question(page)).toHaveAttribute("data-pending", "1")
  })

  await test.step("載せる工事を「全件」と答えると載る件数が増え、計画の聞き返しに「載せない」と答えると減る。答えは下にまとまる", async () => {
    const rule7 = await csvCount(page)
    await question(page, "selection").locator('[data-value="all"]').click()
    await expect(question(page, "selection")).toHaveAttribute("data-answered", "全件")
    await expect.poll(() => csvCount(page)).toBe(7)
    expect(rule7).toBeLessThan(7)
    await expect(page.getByTestId("report-answer-step")).toHaveAttribute("data-count", "1")
    await question(page).locator('[data-value="exclude"]').click()
    await expect(question(page)).toHaveAttribute("data-answered", "載せない")
    await expect.poll(() => csvCount(page), { timeout: 60_000 }).toBe(6)
    await expect(question(page).getByTestId("report-question-detail")).toHaveText("該当 1 行")
    await expect(page.getByTestId("answer-done").getByTestId("report-question")).toHaveCount(2)
    // 聞き返しが無くなると報告の1行は消える
    await expect(page.getByTestId("report-answer-step")).toHaveCount(0)
  })

  await test.step("答えるが済んでも段は動かない。「済みました。次は ◯◯ →」を押したときだけ移り、フォーカスもそのとき移る", async () => {
    await expect(page.getByTestId("next-step-answer")).toHaveAttribute("data-done", "1")
    await expect(view(page)).toHaveAttribute("data-view", "answer")
    const done = page.locator('[data-testid="step-done"][data-step="answer"]')
    await expect(done).toBeVisible()
    const next = (await done.getAttribute("data-next"))!
    await expect(done.getByTestId("step-next")).toHaveText(new RegExp(`次は${{ gyoshu: "業種を決める", fix: "直す", inquiry: "問い合わせ", export: "ダウンロード" }[next]}`))
    // 押すまではフォーカスも動かない
    await expect(page.locator("[data-step-panel]:focus")).toHaveCount(0)
    await done.getByTestId("step-next").click()
    await expect(view(page)).toHaveAttribute("data-view", next)
    await expect(page.locator(`[data-step-panel="${next}"]`)).toBeFocused()
  })

  await test.step("開き直しても答えたまま（開いたときはそのときの今の段）", async () => {
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 30_000 })
    await reload(page)
    await expect(page.getByTestId("next-steps")).toBeVisible({ timeout: 60_000 })
    await expect(view(page)).toHaveAttribute("data-view", (await page.getByTestId("next-steps").getAttribute("data-current"))!)
    await openTab(page, "answer")
    await expect(question(page)).toHaveAttribute("data-answered", "載せない")
    await expect.poll(() => csvCount(page)).toBe(6)
  })

  await test.step("答えを取り消すと、聞き返しが開き直り、載せる件数が戻る", async () => {
    await question(page).getByTestId("report-question-undo").click()
    await expect(question(page)).toHaveAttribute("data-pending", "1")
    await expect.poll(() => csvCount(page), { timeout: 60_000 }).toBe(7)
    await expect(page.getByTestId("next-step-answer")).toHaveAttribute("data-done", "0")
    await expect(page.locator('[data-testid="step-done"][data-step="answer"]')).toHaveCount(0)
    await question(page).locator('[data-value="keep"]').click()
    await expect(question(page)).toHaveAttribute("data-answered", "載せる")
    await expect.poll(() => csvCount(page)).toBe(7)
  })

  await test.step("直すの段は直す行だけで、理由と直し方の列が出る。表はすべての行で、直すの段へ移る道がある", async () => {
    const fix = page.getByTestId("next-step-fix")
    if ((await fix.getAttribute("data-done")) === "0") {
      await fix.click()
      await expect(page.getByTestId("table-section")).toHaveAttribute("data-kind", "fix")
      // 直すと表は同じ tabpanel（開いているタブの aria-controls がそれを指す）
      const panelId = await page.getByTestId("table-section").getAttribute("id")
      await expect(fix).toHaveAttribute("aria-controls", panelId!)
      await expect(page.getByTestId("table-section")).toHaveAttribute("role", "tabpanel")
      await expect(page.locator('[data-testid="preview-table"] tbody tr[data-row-key]').first().getByTestId("reasons-cell").getByTestId("row-fix").first()).toBeVisible()
      await openTab(page, "table")
      await expect(page.getByTestId("tab-table")).toHaveAttribute("aria-controls", panelId!)
      await expect(page.getByTestId("reasons-cell")).toHaveCount(0)
      await page.getByTestId("table-go-fix").click()
      await expect(view(page)).toHaveAttribute("data-view", "fix")
    }
  })

  await test.step("問い合わせを押すとその段に移り、案件の状態を「問い合わせ中」にすると「送った・返事待ち」になる", async () => {
    // 金額の税込・税抜を「分からない」にすると（ダウンロードの段の7割と金額）、顧客に聞くことが1つ以上になる
    await openTab(page, "selection")
    await page.getByTestId("selection-section").getByTestId("tax-unknown").click()
    const step = page.getByTestId("next-step-inquiry")
    await expect(step).toHaveAttribute("data-state", "todo")
    await step.click()
    await expect(view(page)).toHaveAttribute("data-view", "inquiry")
    await page.getByTestId("case-status-inquiring").click()
    await expect(step).toHaveAttribute("data-state", "waiting")
    await expect(step).toContainText("返事待ち")
    await expect(page.getByTestId("next-step-export")).toHaveAttribute("title", /問い合わせ \d+件（送った・返事待ち）/)
  })

  await test.step("ダウンロードの右上の点の意味（残り）は、ツールチップとダウンロードの段で同じ言葉。残りを押すとその段へ移る", async () => {
    const button = page.getByTestId("next-step-export")
    const title = (await button.getAttribute("title")) ?? ""
    const panel = await openExport(page)
    const remaining = panel.getByTestId("export-remaining")
    expect(title).toMatch(/^残り: /)
    const texts = await remaining.locator('[data-testid^="export-remaining-"]').allTextContents()
    expect(title).toBe(`残り: ${texts.join(" → ")}`)
    const first = remaining.locator('[data-testid^="export-remaining-"]').first()
    const to = (await first.getAttribute("data-testid"))!.replace("export-remaining-", "")
    await first.click()
    await expect(view(page)).toHaveAttribute("data-view", to)
  })
})

test("ダウンロードの段に7割の確かめと決算書の額を入れる欄がある。「その他」は工事場所と一括置換だけ", async ({ page }) => {
  await convert(page)
  await page.getByTestId("more-tools").click()
  await expect(page.locator('[data-testid^="more-tool-"]')).toHaveCount(2)
  await expect(page.getByTestId("more-tool-location")).toBeVisible()
  await expect(page.getByTestId("more-tool-replace")).toBeVisible()
  await page.keyboard.press("Escape")

  const panel = await openExport(page)
  await expect(panel.getByTestId("export-rule7")).toBeVisible()
  const section = panel.getByTestId("selection-section")
  await expect(section.getByTestId("gyoshu-summary")).toBeVisible()
  await expect(section.getByTestId("basis-note")).toHaveAttribute("data-entered", "0")
  await expect(panel.getByTestId("export-basis")).toContainText("決算書の額はまだ入れていません")
  // 決算書の額を入れると、ダウンロードの段の確かめが表の合計と照らす
  await section.getByTestId("basis-open").click()
  const input = section.getByTestId("basis-editor").locator("input").first()
  await input.fill("1")
  await input.blur()
  await expect(section.getByTestId("basis-note")).not.toHaveAttribute("data-entered", "0")
  await expect(panel.getByTestId("export-basis")).toHaveAttribute("data-ok", "0")
  // 載せる工事はここでも変えられ、答えるの段の載せる工事にも答えたことになる
  await section.getByTestId("selection-all").click()
  await expect.poll(() => csvCount(page)).toBe(7)
  await openTab(page, "answer")
  await expect(question(page, "selection")).toHaveAttribute("data-answered", "全件")
})

test("狭い画面: 段の並びは横にスクロールし、続きがある側の端を薄くする。「次は」で移った段は見えるところへ送る", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await convert(page)
  await page.getByTestId("work-open").click()
  const viewport = page.getByTestId("step-scroll").locator('[data-slot="scroll-area-viewport"]')
  await expect(viewport).toHaveAttribute("data-overflow-x-end", "")
  await expect(viewport).not.toHaveAttribute("data-overflow-x-start", "")
  // 狭い画面では短い名前
  await expect(page.getByTestId("next-step-gyoshu")).toContainText("業種")
  await expect(page.getByTestId("next-step-export")).toContainText("DL")
  // 答えて済ませ、「次は」で移る
  await question(page, "selection").locator('[data-value="rule7"]').click()
  await question(page).locator('[data-value="keep"]').click()
  const done = page.locator('[data-testid="step-done"][data-step="answer"]')
  const next = (await done.getAttribute("data-next"))!
  await done.getByTestId("step-next").click()
  await expect(view(page)).toHaveAttribute("data-view", next)
  // 移った段は段の並びの見えるところにある（横に隠れていない）
  await expect
    .poll(async () => {
      const box = (await viewport.boundingBox())!
      const tab = (await page.getByTestId(`next-step-${next}`).boundingBox())!
      return tab.x >= box.x - 1 && tab.x + tab.width <= box.x + box.width + 1
    })
    .toBe(true)
  await expect(page.locator(`[data-step-panel="${next}"]`)).toBeFocused()
})
