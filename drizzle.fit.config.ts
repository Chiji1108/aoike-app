import { defineConfig } from "drizzle-kit"

// FIT 申請の D1（FIT_DB）
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/fit-schema.ts",
  out: "./drizzle/fit",
})
