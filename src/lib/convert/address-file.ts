import { readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { ADDRESS_API_PATH, lookupAddresses, type AddressLookup, type ReadJson } from "./address"

/** 同梱の住所データをファイルで読む（照合スクリプト・テスト用。Node だけ。画面は URL で読む） */
const api = pathToFileURL(fileURLToPath(new URL(`../../../public${ADDRESS_API_PATH}`, import.meta.url))).href

/** Node の fetch は file: の URL を読めないので、ファイルとして読む（ライブラリの Node 版は file: をそのまま読める） */
const readFileJson: ReadJson = async (url) => JSON.parse(await readFile(fileURLToPath(url), "utf8"))

export const fileAddressLookup: AddressLookup = (raws) => lookupAddresses(raws, api, readFileJson)
