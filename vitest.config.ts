import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

/** 住所のライブラリのブラウザ向けの版（Worker が読むもの。住所データを fetch で読む） */
const ADDRESS_BROWSER_BUILD = fileURLToPath(new URL("./node_modules/@geolonia/normalize-japanese-addresses/dist/main-esm.mjs", import.meta.url))

/** Worker でだけ動く仕組みを確かめるテスト（住所のライブラリをブラウザ向けの版で読む） */
const WORKER_LIKE = ["src/lib/convert/__tests__/address-bundled.test.ts"]

/**
 * 単体テスト（pnpm test）。src の下の *.test.ts を Node で流す（画面・Worker のプラグインは使わない）。
 * 手元の D1 の代わりは better-sqlite3（src/server/__tests__/sqlite.ts）
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    projects: [
      { extends: true, test: { name: "unit", include: ["src/**/*.test.ts"], exclude: WORKER_LIKE } },
      {
        extends: true,
        // Node で読むとライブラリの Node 向けの版になるので、Worker と同じブラウザ向けの版に差しかえる
        resolve: { alias: { "@geolonia/normalize-japanese-addresses": ADDRESS_BROWSER_BUILD } },
        test: { name: "worker-like", include: WORKER_LIKE },
      },
    ],
  },
})
