import { defineConfig } from "drizzle-kit"

// 全ツール共通の認証用 D1（AUTH_DB）
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/auth-schema.ts",
  out: "./drizzle/auth",
})
