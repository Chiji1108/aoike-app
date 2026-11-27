import { readFileSync } from "node:fs"
import { expect, type Locator, type Page } from "@playwright/test"

/** ページを開き、React が画面につながる（<html data-hydrated>）まで待つ。つながる前の入力や押下は効かない */
export async function open(page: Page, url: string) {
  await page.goto(url)
  await waitHydrated(page)
}

export async function reload(page: Page) {
  await page.reload()
  await waitHydrated(page)
}

const waitHydrated = (page: Page) => expect(page.locator("html[data-hydrated]")).toBeAttached()

/**
 * サーバー関数 names のどれかを呼ぶ要求か。開発サーバーの関数の id（URL の最後）は、ファイルと関数の名前の JSON を base64url にしたもの
 * （名前そのものは URL に出ない）
 */
export function callsServerFn(url: string, names: string[]) {
  const id = new URL(url).pathname.split("/").pop() ?? ""
  let fn: { export?: unknown }
  try {
    fn = JSON.parse(Buffer.from(id, "base64url").toString("utf8"))
  } catch {
    return false
  }
  return typeof fn.export === "string" && names.some((n) => (fn.export as string).startsWith(`${n}_`))
}

/** 顧客と案件を作り、案件の画面を開く。顧客名は毎回違う名前にする（前の実行が残っていても混ざらない） */
export async function openNewCase(page: Page, year = "2026") {
  const customer = `合成建設E2E-${Date.now()}`
  await open(page, "/csv")
  await page.getByTestId("new-customer-name").fill(customer)
  await page.getByTestId("create-customer").click()
  await expect(page.getByRole("heading", { name: customer })).toBeVisible()
  await page.getByLabel("年度").fill(year)
  await page.getByTestId("create-case").click()
  await expect(page.getByRole("heading", { name: `${customer} ${year}年度` })).toBeVisible()
  return { customer, caseUrl: page.url() }
}

/**
 * 案件の画面のチャットの📎で Excel（パスか中身）をアップロードし、AI が列の対応を考えて自動で変換し、変換の報告が出るまで待つ。
 * 広い画面では作業の画面が開き、今の段（たいていは「答える」。新しい顧客は載せる工事を聞く）が選ばれる。table なら、そのあと「表」を開く
 */
export async function attachAndConvert(page: Page, file: Parameters<Locator["setInputFiles"]>[0], { table = true }: { table?: boolean } = {}) {
  await page.getByTestId("chat-file-input").setInputFiles(file)
  await expect(page.getByTestId("case-report")).toHaveAttribute("data-phase", "done", { timeout: 300_000 })
  // 広い画面では作業の画面がチャットの右に開く（狭い画面ではチャットの「表を開く」で開く）
  if ((page.viewportSize()?.width ?? 0) < 1280) return
  await expect(page.getByTestId("next-steps")).toBeVisible()
  if (table) await openTab(page, "table")
}

/** 作業の画面の「表」（すべての行）を開く */
export async function showAllRows(page: Page) {
  await openTab(page, "table")
}

/** 見出しの「…」を開いて、案件の AI の費用の文を読む（閉じて返す） */
export async function caseCostText(page: Page) {
  await page.getByTestId("case-menu").click()
  const cost = page.getByTestId("case-cost")
  await expect(cost).toBeVisible()
  const text = (await cost.textContent()) ?? ""
  await page.keyboard.press("Escape")
  await expect(cost).toBeHidden()
  return text
}

/** 案件の AI の費用（ドル） */
export const caseCostUsd = async (page: Page) => Number(/\$([\d.]+)/.exec(await caseCostText(page))![1])

/** 見出しの「…」から案件を消すダイアログを開く */
export async function openCaseDelete(page: Page) {
  await page.getByTestId("case-menu").click()
  await page.getByTestId("delete-button").click()
}

/** 作業の画面に開くもの: 段（答える・業種・直す・問い合わせ・ダウンロード）・表・道具（その他の工事場所・一括置換）。selection は7割と金額（ダウンロードの段の中） */
export type WorkView = "answer" | "gyoshu" | "fix" | "inquiry" | "export" | "table" | "selection" | "location" | "replace"

/** 開いたときに選ばれている印を見るもの（段・表はタブ、道具は「その他」のボタン） */
export function viewTrigger(page: Page, view: WorkView) {
  if (view === "table") return page.getByTestId("tab-table")
  if (view === "location" || view === "replace") return page.getByTestId("more-tools")
  return page.getByTestId(`next-step-${view === "selection" ? "export" : view}`)
}

/** 作業の画面のそれを開いているか */
export async function expectView(page: Page, view: WorkView) {
  if (view === "location" || view === "replace") await expect(page.getByTestId("more-tools")).toHaveAttribute("data-active", view)
  else await expect(viewTrigger(page, view)).toHaveAttribute("aria-selected", "true")
}

/** 作業の画面の段・表・道具を開く（道具は「その他」から。作業の画面を閉じていれば開く） */
export async function openTab(page: Page, view: WorkView) {
  // 作業の画面を閉じていれば（狭い画面・チャットへ移ったあと）、チャットの「表を開く」で開く
  if (!(await page.getByTestId("next-steps").isVisible()) && (await page.getByTestId("work-open").isVisible())) await page.getByTestId("work-open").click()
  if (view === "location" || view === "replace") {
    await page.getByTestId("more-tools").click()
    await page.getByTestId(`more-tool-${view}`).click()
  } else await viewTrigger(page, view).click()
  await expectView(page, view)
}

/** ダウンロードの段を開く */
export async function openExport(page: Page) {
  await openTab(page, "export")
  const panel = page.getByTestId("export-dialog")
  await expect(panel).toBeVisible()
  return panel
}

/** CSV に載せる件数（段の並びのダウンロードの数） */
export const csvCount = async (page: Page) => Number(/(\d+)件/.exec((await page.getByTestId("next-step-export").textContent()) ?? "")![1])

/** ダウンロードの段を開いて CSV（控え）をダウンロードし、中身（CP932）を返す。開いていたものに戻す */
export async function downloadCsv(page: Page) {
  const back = (await page.getByTestId("work-panel").getAttribute("data-view")) as WorkView | null
  const panel = await openExport(page)
  const downloading = page.waitForEvent("download")
  await panel.getByTestId("download-button").click()
  const path = (await (await downloading).path())!
  if (back && back !== "export") await openTab(page, back)
  return new TextDecoder("shift_jis").decode(readFileSync(path))
}

/** 新しい案件を作って Excel を変換する */
export async function convertFixture(page: Page, path: string) {
  const opened = await openNewCase(page)
  await attachAndConvert(page, path)
  return opened
}

/** 削除のダイアログで顧客名を入れて消す */
export async function confirmDelete(page: Page, customer: string) {
  const dialog = page.getByRole("alertdialog")
  await expect(dialog.getByTestId("delete-counts")).toContainText("案件")
  await dialog.getByTestId("delete-confirm-name").fill(customer)
  await dialog.getByTestId("delete-confirm").click()
  await expect(dialog).toBeHidden()
}

/** 顧客の一覧から顧客を消す（テストで作った顧客の後始末） */
export async function deleteCustomer(page: Page, customer: string) {
  await open(page, "/csv")
  const row = page.locator(`[data-customer="${customer}"]`)
  await row.getByTestId("delete-button").click()
  await confirmDelete(page, customer)
  await expect(row).toHaveCount(0)
}
