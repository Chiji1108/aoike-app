import { env } from "cloudflare:workers"
import { drizzle } from "drizzle-orm/d1"
import * as authSchema from "./auth-schema"
import * as casesSchema from "./cases-schema"
import * as kintaiSchema from "./kintai-schema"

/** 全ツール共通の認証用 D1（Better Auth のユーザー・セッション） */
export function getAuthDb() {
  return drizzle(env.AUTH_DB, { schema: authSchema })
}

/** 勤怠の D1 */
export function getKintaiDb() {
  return drizzle(env.KINTAI_DB, { schema: kintaiSchema })
}

/** 工事経歴書 CSV の D1（顧客・案件・ルール・要望など） */
export function getCsvDb() {
  return drizzle(env.CSV_DB, { schema: casesSchema })
}

export type CsvDb = ReturnType<typeof getCsvDb>
