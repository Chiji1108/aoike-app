import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { newProposal, proposalKey, type ProposalRecord } from "../src/lib/chat/proposals"
import { outcomeChanges } from "../src/lib/location/changes"
import { siteKeyOf, type Outcome, type Site } from "../src/lib/location/sites"
import { attachAndConvert, callsServerFn, deleteCustomer, downloadCsv, open, openNewCase, openTab, reload, showAllRows } from "./helpers"

/**
 * 工事場所の調査: 住所のほとんど無い合成の Excel で、調べた回の進み具合 → 変更案 → 承認 → 表と CSV。
 * 本物の AI と Web 検索で調べるのは E2E_LIVE_AI=1 のときだけ
 * （ふだんは、裏の処理（Workflow）が調べ終えた回を手元の D1 と R2 に置き、そこから先を確かめる。調べる順と結果の形は単体テストで確かめる）
 */

const FIXTURE = new URL("../fixtures/sample-no-address.xlsx", import.meta.url).pathname
const SKYTREE = { workName: "東京スカイツリー照明設備改修工事", client: "東武タワースカイツリー株式会社" }
const REDBRICK = { workName: "横浜赤レンガ倉庫空調設備更新工事", client: "横浜市" }

type Seed = { workName: string; client: string; prefecture: string; place: string; url: string; confident?: boolean }

const sqlText = (s: string) => `'${s.replaceAll("'", "''")}'`

function d1(sql: string) {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "CSV_DB", "--local", "--command", sql], { stdio: ["ignore", "ignore", "inherit"] })
}

/**
 * 調べ終えた回を手元の D1（回と現場）と R2（変更案の記録）に置く。裏の処理が終わったときに置くのと同じ形。
 * 現場の行は表から工事名で探す（同じ現場の行はまとめて1つの現場）
 */
async function seedFinishedRun(page: Page, caseId: string, seeds: Seed[]) {
  await showAllRows(page)
  // 表の工事名には業種の言葉が付く（「…改修に伴う電気工事」）ので、付ける前の工事名の「工事」の前までで探す
  const stem = (s: Seed) => s.workName.replace(/工事$/, "")
  for (const s of seeds) await expect(page.getByTestId("preview-table")).toContainText(stem(s))
  const rows = await page.locator('[data-testid="preview-table"] tbody tr[data-row-key]').evaluateAll((trs) => trs.map((tr) => ({ key: (tr as HTMLElement).dataset.rowKey!, text: tr.textContent ?? "" })))
  const sites: Site[] = seeds.map((s) => {
    const rowKeys = rows.filter((r) => r.text.includes(stem(s))).map((r) => r.key)
    expect(rowKeys.length).toBeGreaterThan(0)
    return { key: siteKeyOf(s.workName, s.client), workName: s.workName, client: s.client, rowKeys, knowledgeTried: false }
  })
  const outcomes = new Map<string, Outcome>(
    seeds.map((s, i) => [sites[i]!.key, { kind: "found", prefecture: s.prefecture, place: s.place, urls: [s.url], source: "search", confident: s.confident ?? true, note: "" }]),
  )
  const runId = crypto.randomUUID()
  const changes = outcomeChanges(sites, outcomes)
  const record: ProposalRecord = { proposal: newProposal(runId, { kind: "location", runId }, changes, null), changes }
  const file = join(mkdtempSync(join(tmpdir(), "location-")), "record.json")
  writeFileSync(file, JSON.stringify(record))
  execFileSync("pnpm", ["exec", "wrangler", "r2", "object", "put", `aoike-kensetsu-csv-files/${proposalKey(caseId, runId)}`, "--local", "--file", file, "--content-type", "application/json"], {
    stdio: ["ignore", "ignore", "inherit"],
  })
  const siteRows = sites.map((site, i) => `(${sqlText(runId)}, ${i}, ${sqlText(JSON.stringify(site))}, ${sqlText(JSON.stringify(outcomes.get(site.key)))})`).join(", ")
  d1(
    `insert into csv_location_runs (id, case_id, customer_id, status, total, searches, usd, proposal_id) select ${sqlText(runId)}, id, customer_id, 'done', ${sites.length}, ${sites.length * 2}, 0.1, ${sqlText(runId)} from csv_cases where id = ${sqlText(caseId)};` +
      ` insert into csv_location_sites (run_id, idx, site, outcome) values ${siteRows}`,
  )
}

/**
 * 変換して全件を載せる（同じ現場の2行が両方 CSV に載るように）。列の対応は見出しからの推定にする（計画の AI を断る）。
 * 施工場所の列を住所として読むので、施工場所の空いた行の都道府県が空になり、調べる現場が決まる
 */
async function convertAll(page: Page) {
  await page.route((url) => callsServerFn(url.href, ["planWithAi"]), (route) => route.fulfill({ status: 500, body: "計画の AI を使わない" }))
  await attachAndConvert(page, FIXTURE)
  await page.unrouteAll({ behavior: "ignoreErrors" })
  await openTab(page, "selection")
  await page.getByTestId("selection-all").click()
  await openTab(page, "location")
  await expect(page.getByTestId("location-count")).toContainText("件", { timeout: 30_000 })
}

/** 調べ始めて、終わるまで待つ。終わった回の文を返す。progress なら進み具合（N件中M件）が出るのも確かめる */
async function runSearch(page: Page, { progress = false } = {}) {
  const panel = page.getByTestId("location-panel")
  await expect(panel.getByTestId("location-start")).toBeEnabled({ timeout: 30_000 })
  await panel.getByTestId("location-start").click()
  if (progress) await expect(panel.getByTestId("location-progress")).toContainText(/\d+件中\d+件/)
  await expect(panel.getByTestId("location-last")).toBeVisible({ timeout: 600_000 })
  return (await panel.getByTestId("location-last").textContent()) ?? ""
}

const saved = (page: Page) => expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 30_000 })

async function approveAll(page: Page, { links }: { links: boolean }) {
  const card = page.getByTestId("location-panel").getByTestId("proposal")
  await expect(card).toBeVisible()
  await card.getByTestId("proposal-open").click()
  const dialog = page.getByTestId("proposal-dialog")
  await expect(dialog.getByTestId("proposal-item").first()).toBeVisible()
  if (links) await expect(dialog.getByTestId("proposal-link").first()).toHaveAttribute("href", /^https:\/\//)
  await page.keyboard.press("Escape")
  await card.getByTestId("proposal-apply-all").click()
  await expect(page.getByTestId("location-panel").getByTestId("proposal")).toHaveCount(0)
}

const created: string[] = []
test.afterEach(async ({ page }) => {
  for (const customer of created.splice(0)) await deleteCustomer(page, customer)
})

test("調べ終えた回 → 変更案 → 承認 → 表と CSV。個人名の現場は調べない。開き直しても決めた変更案は戻らない", async ({ page }) => {
  const { customer, caseUrl } = await openNewCase(page)
  created.push(customer)
  await convertAll(page)
  const count = page.getByTestId("location-count")
  await expect(count).toContainText("個人名などで調べない 1 件")
  await seedFinishedRun(page, caseUrl.split("/").at(-1)!, [
    { ...SKYTREE, prefecture: "東京都", place: "墨田区", url: "https://example.com/skytree" },
    { ...REDBRICK, prefecture: "神奈川県", place: "横浜市中区", url: "https://example.com/redbrick" },
  ])
  // 調べ終えた回を読み直すため開き直す
  await saved(page)
  await reload(page)
  await expect(page.getByTestId("next-steps")).toBeVisible({ timeout: 120_000 })
  await openTab(page, "location")
  const panel = page.getByTestId("location-panel")
  await expect(panel.getByTestId("location-last")).toContainText("2件中2件")
  await expect(panel.getByTestId("location-last")).toContainText("Web 検索 4 回")
  const card = panel.getByTestId("proposal")
  await expect(card).toContainText("工事場所 2現場")
  // 変更案を決めるまで、次の調査は始められない（同じ現場を二重に調べない）
  await expect(page.getByTestId("location-start")).toBeDisabled()
  await approveAll(page, { links: true })

  await showAllRows(page)
  const table = page.getByTestId("preview-table")
  await expect(table).toContainText("墨田区")
  await expect(table).toContainText("横浜市中区")
  const csv = await downloadCsv(page)
  const lines = csv.split(/\r?\n/)
  const skytree = lines.filter((l) => l.includes("東京スカイツリー"))
  expect(skytree).toHaveLength(2)
  for (const l of skytree) expect(l).toContain(",東京都,墨田区,")
  expect(lines.find((l) => l.includes("赤レンガ"))).toContain(",神奈川県,横浜市中区,")

  // 承認したので、もう調べる現場は個人名の1件だけ。開き直しても変更案は戻らない
  await saved(page)
  await open(page, caseUrl)
  await expect(page.getByTestId("next-steps")).toBeVisible({ timeout: 120_000 })
  await expect(page.getByTestId("location-panel").getByTestId("proposal")).toHaveCount(0)
  await openTab(page, "location")
  await expect(page.getByTestId("location-count")).toContainText("現場 1 件（個人名などで調べない 1 件）")
  await showAllRows(page)
  await expect(page.getByTestId("preview-table")).toContainText("墨田区")
})

test("承認の前に行ごとの都道府県・場所名（今 → 新）と出典が見え、行を外して残りを承認できる。自信の無い結果は顧客に確かめる印が付く", async ({ page }) => {
  const { customer, caseUrl } = await openNewCase(page)
  created.push(customer)
  await convertAll(page)
  await seedFinishedRun(page, caseUrl.split("/").at(-1)!, [
    { ...SKYTREE, prefecture: "東京都", place: "墨田区", url: "https://example.com/skytree" },
    { ...REDBRICK, prefecture: "神奈川県", place: "横浜市中区", url: "https://example.com/redbrick", confident: false },
  ])
  await saved(page)
  await reload(page)
  await expect(page.getByTestId("next-steps")).toBeVisible({ timeout: 120_000 })
  await openTab(page, "location")

  // 一覧を開かなくても、カードに行ごとの今 → 新と出典が出る
  const preview = page.getByTestId("location-panel").getByTestId("proposal-preview")
  const sky = preview.getByTestId("proposal-preview-item").filter({ hasText: "東京スカイツリー" })
  await expect(sky.locator('[data-testid="change-part"][data-label="都道府県名"]')).toContainText("東京都")
  await expect(sky.locator('[data-testid="change-part"][data-label="場所名"]').getByTestId("change-to")).toHaveText("墨田区")
  await expect(sky.getByTestId("change-note")).toContainText("出典: Web 検索で推定")
  const brick = preview.getByTestId("proposal-preview-item").filter({ hasText: "横浜赤レンガ" })
  await expect(brick.locator('[data-testid="change-part"][data-label="都道府県名"]')).toContainText("神奈川県")
  await expect(brick.getByTestId("change-note")).toContainText("推定（顧客に確かめる）")

  // スカイツリーの行を外し、残りをまとめて承認する（キーボードで外す）
  await sky.getByTestId("proposal-preview-reject").focus()
  await page.keyboard.press("Enter")
  await expect(preview.getByTestId("proposal-preview-item").filter({ hasText: "東京スカイツリー" })).toHaveCount(0)
  await page.getByTestId("location-panel").getByTestId("proposal-apply-all").click()
  await expect(page.getByTestId("location-panel").getByTestId("proposal")).toHaveCount(0)

  await showAllRows(page)
  const csv = await downloadCsv(page)
  const lines = csv.split(/\r?\n/)
  for (const l of lines.filter((x) => x.includes("東京スカイツリー"))) expect(l).not.toContain(",東京都,墨田区,")
  expect(lines.find((l) => l.includes("赤レンガ"))).toContain(",神奈川県,横浜市中区,")
})

/** 本物の AI と Web 検索（E2E_LIVE_AI=1 のときだけ。費用は1回 $0.2 ほど） */
test("本物の検索で調べる → 進み具合 → 変更案 → 承認 → 表", async ({ page }) => {
  test.skip(process.env.E2E_LIVE_AI !== "1", "E2E_LIVE_AI=1 のときだけ")
  const { customer } = await openNewCase(page)
  created.push(customer)
  await convertAll(page)
  const last = await runSearch(page, { progress: true })
  expect(last).toContain("件中")
  await approveAll(page, { links: false })
  await saved(page)
  await showAllRows(page)
  await expect(page.getByTestId("preview-table")).toContainText("東京都")
})
