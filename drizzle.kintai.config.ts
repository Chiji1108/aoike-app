import { defineConfig } from "drizzle-kit"

// 勤怠の D1（KINTAI_DB）
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/kintai-schema.ts",
  out: "./drizzle/kintai",
})
