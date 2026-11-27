import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { getCsvDb } from "@/db"
import { rule7TaxSchema, rulesTextSchema, type Rules, type RuleTarget } from "@/lib/chat/rules"
import * as store from "./case-store"
import { authMiddleware } from "./middleware"

/**
 * 全体ルール・顧客ルールの読み書き（どちらも1つの文章）。保存は読んだときの版で断り、ほかの画面が先に保存していたら今の文章と一緒に返す
 * （画面は入力を残して知らせる）
 */

const id = z.string().min(1).max(64)
const target: z.ZodType<RuleTarget> = z.discriminatedUnion("scope", [z.object({ scope: z.literal("global") }), z.object({ scope: z.literal("customer"), customerId: id })])

export type SaveRulesResult = { ok: true; rules: Rules } | { ok: false; rules: Rules }

export const getGlobalRulesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const db = getCsvDb()
    const [rules, settings] = await Promise.all([store.getRules(db, { scope: "global" }), store.getSettings(db)])
    return { rules, settings }
  })

export const saveSettingsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ rule7Tax: rule7TaxSchema }))
  .handler(async ({ data }) => {
    await store.saveSettings(getCsvDb(), data)
  })

export const saveRulesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ target, version: z.number().int().min(0), text: rulesTextSchema }))
  .handler(async ({ data }): Promise<SaveRulesResult> => {
    try {
      return { ok: true, rules: await store.saveRules(getCsvDb(), data.target, data.version, data.text) }
    } catch (e) {
      if (e instanceof store.StaleRuleError) return { ok: false, rules: e.current }
      throw e
    }
  })
