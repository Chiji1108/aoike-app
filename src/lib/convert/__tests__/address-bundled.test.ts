import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { bundledAddressLookup } from "../address"
import { ADDRESSES, SPLIT_SNAPSHOT } from "./address-samples"

describe("サーバーで同梱の住所データを読む", () => {
  test("Worker と同じライブラリの版（ブラウザ向け。住所データを fetch で読む）で、Node 向けの版でファイルから読んだときと同じに分ける（異体字も）", async () => {
    // このファイルは vitest.config.ts でライブラリをブラウザ向けの版に差しかえて流す（Worker と同じ）。
    // Node 向けの版の結果（address-split.test.ts）と同じファイルと比べる
    const ja: unknown = JSON.parse(readFileSync(new URL("../../../../public/japanese-addresses/api/ja.json", import.meta.url), "utf8"))
    const bundled = await bundledAddressLookup(ja)(ADDRESSES)
    await expect(JSON.stringify(Object.fromEntries(bundled), null, 2)).toMatchFileSnapshot(SPLIT_SNAPSHOT)
  })
})
