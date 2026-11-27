import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { test as base, expect, type BrowserContext, type Route } from "@playwright/test"
import { fromCrossJSON, fromJSON } from "seroval"
import { callsServerFn } from "./helpers"

/**
 * e2e では、列の計画（planWithAi）と値ごとの判断（runAiBatch）のサーバー関数を本物の AI に届けず、録っておいた答え（fixtures/ai-answers.json）を返す
 * （チャットを決まった返事にするのと同じく、ブラウザの通信を差し替える。本番のコードは変えない）。
 * 答えは要求の中身で引く: 計画は送った抜き出し（案件の id を除く）の SHA-256、値ごとの判断は種類・指示・値。録っていない要求（録るときは本物の失敗も）は、AI の失敗として返し、
 * テストの終わりに落とす（合成の Excel や送る中身を変えたら `E2E_RECORD_AI=1` で流して録り直す。録るときだけ本物の AI を呼ぶ）。
 * 本物の AI で確かめるテストは liveTest で書く（差し替えず、E2E_LIVE_AI=1 のときだけ走る）。
 * spec が page.route で決めた答えは、こちら（context.route）より先に使われる
 */

const ANSWERS = new URL("./fixtures/ai-answers.json", import.meta.url).pathname
const RECORD = process.env.E2E_RECORD_AI === "1"

type Plan = { sheets: string[]; key: string; json: unknown }
type Answers = { plans: Plan[]; items: Record<string, Record<string, Record<string, unknown>>> }
type Item = { id: number; input: string }
type BatchData = { task: string; instruction?: string; items: Item[] }
type PlanData = { sheets: { name: string }[] }

const load = (): Answers => JSON.parse(readFileSync(ANSWERS, "utf8")) as Answers

/** サーバー関数の要求の data（案件の id を除く）。要求は TanStack Start が seroval の JSON にして送る */
function requestData(route: Route) {
  const payload = fromJSON(JSON.parse(route.request().postData() ?? "null")) as { data: Record<string, unknown> }
  const { caseId: _, ...data } = payload.data
  return data
}

const planKey = (data: object) => createHash("sha256").update(JSON.stringify(data)).digest("hex")
const itemKey = (b: BatchData, input: string) => (b.instruction ? `${b.instruction}\n${input}` : input)

/** サーバー関数の返事（{ result }）を返す */
const fulfill = (route: Route, result: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result }) })

/** 録るとき: 本物のサーバー関数に届けて、返事（seroval の参照つきの JSON）を読む。届かない・HTTP の失敗なら投げる */
async function callReal(route: Route) {
  const res = await route.fetch({ headers: { ...route.request().headers(), accept: "application/json" } })
  if (!res.ok()) throw new Error(`本物のサーバー関数が ${res.status()} を返しました`)
  const body: unknown = await res.json()
  const value = res.headers()["x-tss-serialized"] ? fromCrossJSON(body as never, { refs: new Map() }) : body
  return ((value as { result?: unknown }).result ?? value) as { ok: boolean; json?: unknown; message?: string; usd: number }
}

async function fakeAi(context: BrowserContext, misses: string[]) {
  /** 答えられない（録っていない・録るときに本物が失敗した）: AI の失敗として返し、テストの終わりに落とす */
  const fail = (route: Route, what: string) => {
    misses.push(what)
    return fulfill(route, { ok: false, reason: "error", message: `e2e の AI の答えがありません（${what}）`, usd: 0 })
  }
  /** 答えを引き、無ければ（録るときは）本物に届けて録る。途中で投げたら失敗として返す（ページを待たせない） */
  const handle = (answer: (route: Route) => Promise<void>) => async (route: Route) => {
    try {
      await answer(route)
    } catch (e) {
      await fail(route, `要求を扱えませんでした: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const save = (answers: Answers) => writeFileSync(ANSWERS, `${JSON.stringify(answers, null, 2)}\n`)

  await context.route(
    (url) => callsServerFn(url.href, ["planWithAi"]),
    handle(async (route) => {
      const data = requestData(route)
      const key = planKey(data)
      const what = `計画: シート ${(data as PlanData).sheets.map((s) => s.name).join("・")}`
      const found = load().plans.find((p) => p.key === key)
      if (found) return fulfill(route, { ok: true, json: found.json, usd: 0 })
      if (!RECORD) return fail(route, `${what}（録っていない）`)
      const res = await callReal(route)
      if (!res.ok) return fail(route, `${what}（本物の AI の失敗: ${res.message ?? "不明"}）`)
      const answers = load()
      answers.plans.push({ sheets: (data as PlanData).sheets.map((s) => s.name), key, json: res.json })
      save(answers)
      return fulfill(route, res)
    }),
  )

  await context.route(
    (url) => callsServerFn(url.href, ["runAiBatch"]),
    handle(async (route) => {
      const data = requestData(route) as BatchData
      const known = load().items[data.task] ?? {}
      const lacking = data.items.filter((i) => !(itemKey(data, i.input) in known))
      const what = `${data.task}${data.instruction ? `（指示: ${data.instruction}）` : ""}: ${lacking.map((i) => i.input).join("・")}`
      if (lacking.length && !RECORD) return fail(route, `${what}（録っていない）`)
      if (lacking.length) {
        const res = await callReal(route)
        if (!res.ok) return fail(route, `${what}（本物の AI の失敗: ${res.message ?? "不明"}）`)
        const answers = load()
        const task = (answers.items[data.task] ??= {})
        for (const r of (res.json as { results: ({ id: number } & Record<string, unknown>)[] }).results) {
          const item = data.items.find((i) => i.id === r.id)
          const { id: _, ...rest } = r
          if (item) task[itemKey(data, item.input)] = rest
        }
        save(answers)
        return fulfill(route, res)
      }
      const results = data.items.map((i) => ({ id: i.id, ...known[itemKey(data, i.input)] }))
      return fulfill(route, { ok: true, json: { results }, usd: 0 })
    }),
  )
}

export const test = base.extend<{ liveAi: boolean; fakeAi: void }>({
  /** 本物の AI を呼ぶか（liveTest が true にする） */
  liveAi: [false, { option: true }],
  fakeAi: [
    async ({ context, liveAi }, use, testInfo) => {
      testInfo.skip(liveAi && process.env.E2E_LIVE_AI !== "1", "E2E_LIVE_AI=1 のときだけ")
      const misses: string[] = []
      if (!liveAi) await fakeAi(context, misses)
      await use()
      expect(misses, "答えられなかった AI の要求（録っていなければ E2E_RECORD_AI=1 で録り直す）").toEqual([])
    },
    { auto: true },
  ],
})

/** 本物の AI を呼ぶテスト（AI の通信を差し替えない）。E2E_LIVE_AI=1 のときだけ走る */
export const liveTest = test.extend({ liveAi: true })

export { expect }
