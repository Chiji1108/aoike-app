import { describe, expect, test } from "bun:test"
import { legacyRedirectUrl } from "./legacy-host"

const to = (href: string) => legacyRedirectUrl(new URL(href))

describe("legacyRedirectUrl", () => {
  test("勤怠のトップは /kintai へ", () => {
    expect(to("https://kintai.aoike.jp/")).toBe("https://app.aoike.jp/kintai")
  })

  test("勤怠の中のページは /kintai の下へ、クエリはそのまま", () => {
    expect(to("https://kintai.aoike.jp/report?employee=e1&period=2026-11")).toBe(
      "https://app.aoike.jp/kintai/report?employee=e1&period=2026-11",
    )
    expect(to("https://kintai.aoike.jp/employees")).toBe("https://app.aoike.jp/kintai/employees")
  })

  test("ログインは共通のログインへ", () => {
    expect(to("https://kintai.aoike.jp/login")).toBe("https://app.aoike.jp/login")
  })

  test("app.aoike.jp やローカルは転送しない", () => {
    expect(to("https://app.aoike.jp/kintai")).toBeNull()
    expect(to("http://localhost:3210/")).toBeNull()
  })
})
