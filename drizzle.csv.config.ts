import { defineConfig } from "drizzle-kit"

// 工事経歴書 CSV の D1（CSV_DB）。認証のテーブルは共通の AUTH_DB にあるので、ここには入れない
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/cases-schema.ts",
  out: "./drizzle/csv",
})
