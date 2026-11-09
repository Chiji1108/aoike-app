import { env } from "cloudflare:workers"
import { drizzle } from "drizzle-orm/d1"
import * as authSchema from "./auth-schema"
import * as kintaiSchema from "./kintai-schema"

/** 全ツール共通の認証用 D1（Better Auth のユーザー・セッション） */
export function getAuthDb() {
  return drizzle(env.AUTH_DB, { schema: authSchema })
}

/** 勤怠の D1 */
export function getDb() {
  return drizzle(env.KINTAI_DB, { schema: kintaiSchema })
}

export type Db = ReturnType<typeof getDb>
