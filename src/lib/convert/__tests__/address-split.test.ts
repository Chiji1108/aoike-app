import { expect, test } from "vitest"
import { fileAddressLookup } from "../address-file"
import { ADDRESSES, SPLIT_SNAPSHOT } from "./address-samples"

test("Node 向けの版で同梱の住所データをファイルから読んで分ける（Worker 向けの版の address-bundled.test.ts と同じファイルと比べる）", async () => {
  const book = await fileAddressLookup(ADDRESSES)
  await expect(JSON.stringify(Object.fromEntries(book), null, 2)).toMatchFileSnapshot(SPLIT_SNAPSHOT)
})
