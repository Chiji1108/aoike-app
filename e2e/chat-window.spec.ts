import type { Page, Route } from "@playwright/test"
import { expect, test } from "./fake-ai"
import { createUIMessageStream, createUIMessageStreamResponse } from "ai"
import { callsServerFn, deleteCustomer, openNewCase, openTab, reload, showAllRows } from "./helpers"
import { syntheticPdf } from "./pdf"

/**
 * 広い画面でチャットを右下の窓にする流れ: 表ができると表は横幅いっぱい・チャットは窓 → たたむ（右下のボタンだけ）→ たたんでいる間の返事・失敗・アップロードの結果に
 * 未読の印 → 開く → 「答える」でたたんでいても開いて移る → たたんだ設定は開き直しても覚えている → 表の最後の行・右端の列が窓の下に隠れない。
 * 計画の AI とチャットのサーバーは決まった返事にする（合成 fixture だけ）
 */

const FIXTURE = new URL("../fixtures/sample-messy.xlsx", import.meta.url).pathname

const col = (column: number, transform: string) => ({ kind: "column", column, transform, instruction: null })

/** 合成 fixture（sample-messy.xlsx の「工事経歴」）の列の対応。備考（K列）に値のある1行を聞き返す（次にやることの「答える」） */
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

/** チャットのサーバーの代わり: 返事（text）か、断る（refuse）。返事は少し待ってから返す（その間に窓をたたむ） */
async function fakeChat(page: Page, replies: ({ text: string } | { refuse: number })[]) {
  let n = 0
  await page.route("**/api/csv/cases/*/chat", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback()
    const reply = replies[n++]!
    await new Promise((r) => setTimeout(r, 1500))
    if ("refuse" in reply) return route.fulfill({ status: reply.refuse, body: "合成の失敗" })
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "start", messageId: `a${n}` })
        writer.write({ type: "text-start", id: "t" })
        writer.write({ type: "text-delta", id: "t", delta: reply.text })
        writer.write({ type: "text-end", id: "t" })
        writer.write({ type: "message-metadata", messageMetadata: { usd: 0, caseUsd: 0, ms: 1, inputTokens: 1, outputTokens: 1, toolCalls: 0 } })
        writer.write({ type: "finish" })
      },
    })
    const res = createUIMessageStreamResponse({ stream })
    await route.fulfill({ status: 200, headers: Object.fromEntries(res.headers), body: await res.text() })
  })
}

const chat = (page: Page) => page.getByTestId("chat-column")
const launcher = (page: Page) => page.getByTestId("chat-launcher")
const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!

/** 指示を送り、返事を待つ間に右下のボタンで窓をたたむ */
async function sendAndCollapse(page: Page, text: string) {
  await page.getByTestId("chat-input").fill(text)
  await page.getByTestId("chat-send").click()
  await expect(page.getByTestId("chat-stop")).toBeVisible()
  await launcher(page).click()
  await expect(chat(page)).toHaveAttribute("data-collapsed", "1")
}

/** 窓を開いた（たたんでいない） */
const expectOpen = (page: Page) => expect(chat(page)).not.toHaveAttribute("data-collapsed", /.*/)

test("表ができるとチャットは右下の窓になり表は横幅いっぱい。たたむと未読の印、「答える」で開いて移る、たたんだ設定は覚え、表の最後の行は窓に隠れない", async ({ page }) => {
  // 大きさ・位置を測るので、動きを減らす設定にする（中央 ⇄ 窓の動きは「動きの途中も同じ要素」の確かめで見る）
  await page.emulateMedia({ reducedMotion: "reduce" })
  const { customer } = await openNewCase(page)
  created.push(customer)
  await fakePlan(page)
  await fakeChat(page, [{ text: "合成の返事です。" }, { refuse: 500 }, { text: "合成の説明です。" }])

  await test.step("表が無い間はチャットを中央に大きく出し、右下のボタンは無い", async () => {
    await expect(chat(page)).toHaveAttribute("data-place", "full")
    await expect(launcher(page)).toHaveCount(0)
  })

  await page.getByTestId("chat-file-input").setInputFiles(FIXTURE)
  await expect(page.getByTestId("case-report")).toHaveAttribute("data-phase", "done", { timeout: 300_000 })
  await expect(page.getByTestId("next-steps")).toBeVisible()

  await test.step("表ができると、作業の画面が横幅いっぱい・チャットは右下の窓（開いたまま）", async () => {
    await expect(chat(page)).toHaveAttribute("data-place", "window")
    await expect(chat(page)).toBeVisible()
    const viewport = page.viewportSize()!
    const work = await box(page, "work-frame")
    expect(work.x).toBe(0)
    expect(work.width).toBe(viewport.width)
    const win = await box(page, "chat-column")
    expect(win.x + win.width).toBeGreaterThan(viewport.width - 40)
    expect(win.width).toBeLessThan(500)
    await expect(launcher(page)).toHaveAttribute("aria-expanded", "true")
  })

  await test.step("初めて窓にしたときだけ「チャットはここにあります」を出し、「わかった」で消す", async () => {
    await expect(page.getByTestId("chat-hint")).toContainText("チャットはここにあります")
    await page.getByTestId("chat-hint-close").click()
    await expect(page.getByTestId("chat-hint")).toHaveCount(0)
  })

  await test.step("作業の画面を閉じて中央のチャットで書きかけ、表を開いて窓にしても、同じチャットのまま書きかけが残る", async () => {
    await chat(page).evaluate((el) => ((el as HTMLElement & { marked?: boolean }).marked = true))
    await page.getByTestId("work-close").click()
    await expect(chat(page)).toHaveAttribute("data-place", "full")
    await page.getByTestId("chat-input").fill("書きかけの合成の指示")
    await page.getByTestId("work-open").click()
    await expect(chat(page)).toHaveAttribute("data-place", "window")
    await expect(page.getByTestId("chat-input")).toHaveValue("書きかけの合成の指示")
    expect(await chat(page).evaluate((el) => (el as HTMLElement & { marked?: boolean }).marked)).toBe(true)
    await page.getByTestId("chat-input").fill("")
  })

  await test.step("右下のボタンでたたむとフォーカスはボタンに。開くと入力欄へ、Escape でたたむ", async () => {
    await launcher(page).click()
    await expect(chat(page)).toHaveAttribute("data-collapsed", "1")
    await expect(launcher(page)).toHaveAttribute("aria-expanded", "false")
    await expect(page.getByTestId("chat-launcher-attach")).toBeVisible()
    await launcher(page).click()
    await expectOpen(page)
    await expect(page.getByTestId("chat-input")).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(chat(page)).toHaveAttribute("data-collapsed", "1")
    await expect(launcher(page)).toBeFocused()
    await launcher(page).click()
  })

  await test.step("返事を待つ間にたたむと、返事が届いたらボタンに印。開くと返事が見え、印は消える", async () => {
    await sendAndCollapse(page, "合成の指示です")
    await expect(launcher(page)).toHaveAttribute("data-unread", "new")
    await expect(page.getByTestId("chat-unread")).toBeVisible()
    await launcher(page).click()
    // たたんでいる間に届いた返事も、開くと見える（流れの位置を消さない）
    await expect(chat(page).getByText("合成の返事です。")).toBeInViewport()
    await expect(launcher(page)).not.toHaveAttribute("data-unread", /.+/)
  })

  await test.step("失敗した返事は赤の印", async () => {
    await sendAndCollapse(page, "合成の指示（失敗）です")
    await expect(launcher(page)).toHaveAttribute("data-unread", "error")
    await launcher(page).click()
    await expect(page.getByTestId("chat-error")).toBeVisible()
    await expect(launcher(page)).not.toHaveAttribute("data-unread", /.+/)
  })

  await test.step("たたんでいてもボタンの横の📎でアップロードでき、結果に印が付く", async () => {
    await launcher(page).click()
    await expect(chat(page)).toHaveAttribute("data-collapsed", "1")
    await page.getByTestId("chat-launcher-file-input").setInputFiles({ name: "合成の資料.pdf", mimeType: "application/pdf", buffer: syntheticPdf(["synthetic"]) })
    await expect(launcher(page)).toHaveAttribute("data-unread", "new")
    await expect(page.locator('[data-testid="file-list"] [data-file="合成の資料.pdf"]')).toBeVisible()
  })

  await test.step("たたんだまま「答える」の段の「AI に聞く」を押すと、窓をその場だけ開いて質問を送り、入力欄に合わせる", async () => {
    await openTab(page, "answer")
    const question = page.locator('[data-testid="answer-section"] [data-testid="report-question"][data-question="plan-ask-0"]')
    await question.getByTestId("report-question-ask").click()
    await expectOpen(page)
    await expect(page.getByTestId("chat-messages")).toContainText("合成の説明です。")
    await expect(page.getByTestId("chat-messages").getByText("どういうことですか？").last()).toBeInViewport()
  })

  await test.step("開き直すと、覚えたたたんだ設定（「答える」で開いたのはその場だけ）で表ができた最初から窓はたたんだまま", async () => {
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 30_000 })
    await reload(page)
    await expect(page.getByTestId("next-steps")).toBeVisible({ timeout: 60_000 })
    await expect(chat(page)).toHaveAttribute("data-collapsed", "1")
    await expect(launcher(page)).toHaveAttribute("aria-expanded", "false")
    // 一度出した「チャットはここにあります」はもう出さない
    await expect(page.getByTestId("chat-hint")).toHaveCount(0)
    // 開き直しただけでは何も届いていない
    await expect(launcher(page)).not.toHaveAttribute("data-unread", /.+/)
  })

  await test.step("たたんでいるとき、表の最後の行は右下のボタンの上までスクロールできる", async () => {
    await showAllRows(page)
    const scroller = page.getByTestId("preview-table").locator("xpath=..")
    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight))
    const last = (await page.locator('[data-testid="preview-table"] tbody tr[data-row-key]').last().boundingBox())!
    const button = await box(page, "chat-launcher")
    expect(last.y + last.height).toBeLessThanOrEqual(button.y)
  })

  await test.step("窓を開いているとき、表を最後の行・右端の列までスクロールすると、最後の行の右端のセルは窓に隠れず押せる", async () => {
    await launcher(page).click()
    await expectOpen(page)
    const scroller = page.getByTestId("preview-table").locator("xpath=..")
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight
      el.scrollLeft = el.scrollWidth
    })
    const cell = page.locator('[data-testid="preview-table"] tbody tr[data-row-key]').last().locator("td").last()
    const win = await box(page, "chat-column")
    const c = (await cell.boundingBox())!
    // 窓の左か上にある（重なっていない）
    expect(c.x + c.width <= win.x || c.y + c.height <= win.y).toBe(true)
    expect(await cell.evaluate((td) => { const r = td.getBoundingClientRect(); return td.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) })).toBe(true)
  })

  await test.step("窓が表の上の行に重なるときだけ、その右を空けて「列」のボタンを押せるようにし、背の高い画面・たたんだときは空けない", async () => {
    const size = page.viewportSize()!
    // 表の上の行（検索・「列」・まとめて直す・色の凡例）のかたまりごと空ける
    const toolbar = page.getByTestId("table-controls")
    const pad = () => toolbar.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight))
    const clickable = () => page.getByTestId("columns-menu").evaluate((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) })
    await page.setViewportSize({ width: 1440, height: 900 })
    try {
      // 1440×900 では窓の上の端が表の上の行より上にある（重なる）ので、右を空ける
      const win = await box(page, "chat-column")
      const row = (await toolbar.boundingBox())!
      expect(win.y).toBeLessThan(row.y + row.height)
      await expect.poll(pad).toBeGreaterThan(0)
      await expect.poll(clickable).toBe(true)
      // 背の高い画面では窓が表の上の行まで届かないので空けない
      await page.setViewportSize({ width: 1500, height: 1400 })
      await expect.poll(pad).toBe(0)
      await page.setViewportSize({ width: 1440, height: 900 })
      await expect.poll(pad).toBeGreaterThan(0)
      // たたむと重ならないので空けない（「列」は右端に戻る）
      await launcher(page).click()
      await expect.poll(pad).toBe(0)
      await expect.poll(clickable).toBe(true)
      await launcher(page).click()
      await expectOpen(page)
    } finally {
      await page.setViewportSize(size)
    }
  })

  await test.step("左上の角を引くと窓が大きくなり、ダブルクリックで元の大きさに戻る", async () => {
    const before = await box(page, "chat-column")
    const handle = await box(page, "chat-resize")
    await page.mouse.move(handle.x + 10, handle.y + 10)
    await page.mouse.down()
    await page.mouse.move(handle.x - 90, handle.y - 40, { steps: 4 })
    await page.mouse.up()
    const after = await box(page, "chat-column")
    expect(Math.round(after.width - before.width)).toBe(100)
    expect(Math.round(after.height - before.height)).toBe(50)
    expect(Math.round(after.x + after.width)).toBe(Math.round(before.x + before.width))
    await page.getByTestId("chat-resize").dblclick()
    await expect.poll(async () => Math.round((await box(page, "chat-column")).width)).toBe(Math.round(before.width))
  })

  await test.step("取っ手は矢印キーでも大きさを変え（← で広く）、Home で元に戻す", async () => {
    const before = await box(page, "chat-column")
    await page.getByTestId("chat-resize").focus()
    await page.keyboard.press("ArrowLeft")
    await page.keyboard.press("ArrowUp")
    await expect.poll(async () => Math.round((await box(page, "chat-column")).width)).toBe(Math.round(before.width) + 20)
    expect(Math.round((await box(page, "chat-column")).height)).toBe(Math.round(before.height) + 20)
    await page.keyboard.press("Home")
    await expect.poll(async () => Math.round((await box(page, "chat-column")).width)).toBe(Math.round(before.width))
  })

  /** 端末に覚えた窓の大きさ */
  const savedSize = () => page.evaluate(() => (JSON.parse(localStorage.getItem("csv.chatWindow") ?? "null") as { size: unknown } | null)?.size ?? null)
  const frameSize = () => chat(page).evaluate((el) => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight])

  await test.step("取っ手を押しただけ（引いていない）では大きさを覚えず、決まりの大きさ（画面の高さに合わせる）のまま", async () => {
    expect(await savedSize()).toBeNull()
    await page.getByTestId("chat-resize").click()
    expect(await savedSize()).toBeNull()
    await page.setViewportSize({ width: 1500, height: 700 })
    // 決まりの高さは並べ方の欄から 6rem 引いた高さまで縮む（覚えた px に固まっていない）
    const area = await chat(page).evaluate((el) => (el.parentElement as HTMLElement).offsetHeight)
    await expect.poll(async () => (await frameSize())[1]).toBe(Math.min(640, area - 96))
  })

  await test.step("短い画面でも、各タブの下の余白は窓の高さ分だけ（大きな空白にならない）", async () => {
    await openTab(page, "gyoshu")
    const pad = await page.getByRole("tabpanel").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))
    const [, h] = await frameSize()
    // 1rem（もとの余白）+ 窓の高さ + 104px
    expect(Math.round(pad)).toBe(16 + h! + 104)
    await openTab(page, "table")
    await page.setViewportSize({ width: 1500, height: 1000 })
  })

  await test.step("引いている途中で中断（pointercancel）したら、始めの大きさに戻し、覚えない", async () => {
    const [w0, h0] = await frameSize()
    const handle = await box(page, "chat-resize")
    await page.mouse.move(handle.x + 10, handle.y + 10)
    await page.mouse.down()
    await page.mouse.move(handle.x - 40, handle.y - 20, { steps: 3 })
    await expect.poll(async () => (await frameSize())[0]).toBe(w0! + 50)
    await page.getByTestId("chat-resize").dispatchEvent("pointercancel", { pointerId: 1, bubbles: true })
    await page.mouse.up()
    await expect.poll(frameSize).toEqual([w0, h0])
    expect(await savedSize()).toBeNull()
  })

  await test.step("中央から窓へ動く途中で大きさを変えても、縮んだ見た目ではなく窓の大きさから変える", async () => {
    // 動きを減らす設定は画面を開いたときに読むので、設定を戻して開き直す
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await reload(page)
    await expect(page.getByTestId("next-steps")).toBeVisible({ timeout: 60_000 })
    await page.getByTestId("work-close").click()
    await expect(chat(page)).toHaveAttribute("data-place", "full")
    // 「表を開く」を押してすぐ（動きの途中）に、取っ手で ← を押す
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="work-open"]')!.click()
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const handle = document.querySelector<HTMLElement>('[data-testid="chat-resize"]')!
        handle.focus()
        handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
      }))
    })
    await expect.poll(savedSize).toEqual({ w: 440, h: 640 })
    await page.getByTestId("chat-resize").focus()
    await page.keyboard.press("Home")
    await page.emulateMedia({ reducedMotion: "reduce" })
  })
})
