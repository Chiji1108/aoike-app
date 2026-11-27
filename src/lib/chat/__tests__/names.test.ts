import { describe, expect, test } from "vitest"
import { EMPTY_INQUIRY_TEXT } from "../../inquiry/text"
import { aiKey } from "../../convert/convert"
import { kojiRow } from "../../convert/__tests__/helpers"
import { personToken } from "../../convert/persons"
import type { CaseTable } from "../../cases/view"
import { nameGuard, namesOfCase, namesOfTable, nameScrubber } from "../names"
import { chatTools, newTurnState } from "../turn"

const yamada = personToken("山田太郎")
const base = { gyoshu: "8", motoukeShitauke: "1", prefecture: "東京都", place: "千代田区", engineer: "試験　太郎", startYm: "202404", endYm: "202409" }
const rows = [
  kojiRow({ ...base, client: yamada, workName: `${yamada}邸新築工事`, amount: "5000" }, 1),
  kojiRow({ ...base, client: "株式会社　テスト", workName: "テストビル 電気工事", amount: "3000" }, 2),
  kojiRow({ ...base, client: "有限会社サンプル", workName: "サンプル倉庫改修", amount: "1000" }, 3),
]
const table: CaseTable = {
  rows,
  added: [],
  edits: new Map([
    ["s!2:client", { value: "㈱テスト", by: "chat" }],
    ["s!3:client", { value: "㈲サンプル", by: "staff" }],
    ["s!2:workName", { value: "テストビル電気工事", by: "chat" }],
    ["s!3:endYm", { value: "202410", by: "customer" }],
    ["s!1:engineer", { value: "見本　花子", by: "customer" }],
  ]),
  replacements: { client: { "株式会社　テスト": { value: "㈱テスト", by: "staff" } } },
  manual: new Map([
    ["s!3", true],
    ["s!1", false],
  ]),
  tax: "excluded",
  basis: {},
  rule7Tax: "excluded",
  selection: "all",
  rounding: "floor",
  dismissed: new Set<string>(),
  inquiryText: EMPTY_INQUIRY_TEXT,
}

describe("個人名の集め方と置き換え", () => {
  test("案件の作業と AI の結果で分かっている個人名（匿名化の persons・氏名の区切り・手直しの印・配置技術者）を〔個人名〕にする", () => {
    const work = {
      edits: [
        ["s!1:workName", { value: `${personToken("山田太郎")}邸新築工事`, by: "staff" as const }],
        ["s!2:engineer", { value: "青池　一郎", by: "chat" as const }],
        ["s!3:client", { value: "株式会社中村建設", by: "staff" as const }],
        ["s!4:engineer", { value: "未定", by: "staff" as const }],
      ] as const,
      replacements: { engineer: { "佐藤　花子": { value: "佐藤　次郎", by: "staff" as const } } },
    }
    const aiCache = [
      [aiKey("anonymizeClient", undefined, "鈴木一郎"), { id: 0, value: "〔1〕", needsReview: false, note: "", persons: ["鈴木一郎"] }],
      [aiKey("personName", undefined, "高橋健"), { id: 0, value: "高橋　健", needsReview: false, note: "" }],
      [aiKey("gyoshu", undefined, "内装"), { id: 0, value: "13", needsReview: false, note: "" }],
    ] as const
    const names = namesOfCase(work, aiCache)
    expect([...names].sort()).toEqual(["佐藤　次郎", "佐藤　花子", "山田太郎", "青池　一郎", "高橋　健", "高橋健", "鈴木一郎"].sort())
    const src = `m = {"山田太郎": "x", "青池一郎": "y", "青池 一郎": "z", "鈴木一郎": "w"}\nif c == "株式会社中村建設": pass  # 佐藤`
    const out = nameScrubber(names)(src)
    expect(out).toBe(`m = {"〔個人名〕": "x", "〔個人名〕": "y", "〔個人名〕": "z", "〔個人名〕": "w"}\nif c == "株式会社中村建設": pass  # 佐藤`)
  })

  test("氏名は氏名ごと置き換え、会社名・地名の中の姓は壊さない。2文字以下の名前は前後が文字でないときだけ。全角半角の違う書き方も置き換える", () => {
    const names = ["中村　一郎", "山田", "ヤマダタロウ", "青池"]
    const src = [`a = "株式会社中村建設"`, `b = "山田町"`, `c = "山田"`, `d = "中村一郎邸新築工事"`, `e = "ﾔﾏﾀﾞﾀﾛｳ"`, `f = "中村 一郎"`, `g = ["青池", "青池工務店"]`].join("\n")
    expect(nameScrubber(names)(src)).toBe(
      [`a = "株式会社中村建設"`, `b = "山田町"`, `c = "〔個人名〕"`, `d = "〔個人名〕邸新築工事"`, `e = "〔個人名〕"`, `f = "〔個人名〕"`, `g = ["〔個人名〕", "青池工務店"]`].join("\n"),
    )
  })

  test("空白で囲まれた短い名前・空白の入った氏名も置き換える（空白は消さずに比べる）", () => {
    expect(nameScrubber(["山田"])("# 担当 山田 の行")).toBe("# 担当 〔個人名〕 の行")
    expect(nameScrubber(["山田　太郎"])(`a = "山田 太郎"\nb = "山田　太郎"\nc = "山田  太郎"`)).toBe(`a = "〔個人名〕"\nb = "〔個人名〕"\nc = "〔個人名〕"`)
  })

  test("表の人: 印の人と配置技術者。氏名でない値・長すぎる値は名前にしない", () => {
    const names = namesOfTable({
      rows: [kojiRow({ engineer: "佐藤　花子", client: `${personToken("鈴木一郎")}` }, 1), kojiRow({ engineer: "同上" }, 2), kojiRow({ engineer: "x".repeat(300) }, 3)],
      edits: [["s!1:engineer", { value: "高橋　健", by: "staff" }], ["s!2:engineer", { value: "なし", by: "staff" }]],
    })
    expect([...names].sort()).toEqual(["佐藤　花子", "高橋　健", "鈴木一郎"].sort())
  })

  test("ルールの案の個人名: 表の人・分かっている名前（空白・全角半角の違いも、空白で区切って書いても）・保存の前の置換の人・表の記号を見つける。地名の一部・ほかの〔…〕は名前にしない", () => {
    const withReplacement: CaseTable = { ...table, replacements: { engineer: { "旧姓　花子": { value: "新姓　花子", by: "staff" } } } }
    const { has } = nameGuard(withReplacement, ["佐藤", "高橋一郎"])
    expect(has("注文者が山田 太郎のときは株式会社を付ける")).toBe(true)
    expect(has("配置技術者は試験太郎にする")).toBe(true)
    expect(has("高橋 一郎の工事は外す")).toBe(true)
    expect(has("旧姓花子は新姓にする")).toBe(true)
    expect(has("〔Ａ〕の工事は載せない")).toBe(true)
    expect(has("〔未掲載１〕は載せない")).toBe(true)
    expect(has("〔個人名〕の工事は載せない")).toBe(true)
    expect(has("佐藤 の工事は外す")).toBe(true)
    expect(has("佐藤町の工事は外す")).toBe(false)
    expect(has("工事名の〔仮称〕と【支店名】は先頭に移す")).toBe(false)
  })
})

describe("ルールの案の個人名の確かめ（propose_rule）", () => {
  const known = async () => ["佐藤　次郎"]
  async function call(tools: ReturnType<typeof chatTools>, name: keyof ReturnType<typeof chatTools>, input: unknown) {
    const t = tools[name] as unknown as { execute: (input: unknown, options: unknown) => Promise<string> }
    const out = await t.execute(input, { toolCallId: "t", messages: [] })
    try {
      return JSON.parse(out)
    } catch {
      return out
    }
  }

  test("まだ保存した作業が無い（分かっている個人名が空）案件でも、表の人で確かめて propose_rule の案を出す", async () => {
    const state = newTurnState(table, undefined, undefined, null, null, async () => [])
    const tools = chatTools(state)
    expect(await call(tools, "propose_rule", { scope: "customer", items: ["工事名の読点は取る"] })).toBe("職員に1項目の案を見せました（承認待ち）。")
    expect(await call(tools, "propose_rule", { scope: "customer", items: ["試験太郎は配置技術者にしない"] })).toMatchObject({ ok: false })
  })

  test("同じ指示の中で AI が手直しに入れた個人名も、ルールの案に入れない（確かめるときの表から集める）", async () => {
    const state = newTurnState(table, undefined, undefined, null, null, known)
    const tools = chatTools(state)
    expect(await call(tools, "propose_rule", { scope: "customer", items: ["工事名の読点は取る"] })).toBe("職員に1項目の案を見せました（承認待ち）。")
    expect(await call(tools, "set_cells", { changes: [{ key: "s!2", field: "engineer", value: "新顔　一郎" }] })).toMatchObject({ ok: true })
    expect(await call(tools, "propose_rule", { scope: "customer", items: ["配置技術者は新顔一郎にする"] })).toMatchObject({ ok: false, items: [0] })
  })

  test("個人名（表の人・分かっている名前・表の記号）の入った案は、propose_rule は何も受け取らない", async () => {
    const state = newTurnState(table, undefined, undefined, null, null, known)
    const tools = chatTools(state)
    expect(await call(tools, "propose_rule", { scope: "customer", items: ["注文者の株式会社は㈱にする。", "佐藤次郎の工事は載せない。"] })).toMatchObject({ ok: false, items: [1] })
    expect(await call(tools, "propose_rule", { scope: "customer", items: ["配置技術者は試験太郎にする"] })).toMatchObject({ ok: false, items: [0] })
    expect(await call(tools, "propose_rule", { scope: "global", items: ["〔Ａ〕邸は載せない"] })).toMatchObject({ ok: false, items: [0] })
    expect(state.pending).toEqual([])
    // 分かっている個人名を集められない（保存した作業を読めない）ときは、何も出さずに理由を返す
    const broken = newTurnState(table, undefined, undefined, null, null, async () => Promise.reject(new Error("読めない")))
    const brokenTools = chatTools(broken)
    expect(await call(brokenTools, "propose_rule", { scope: "customer", items: ["工事名の読点は取る"] })).toMatchObject({ ok: false, error: expect.stringContaining("読めない") })
    expect(broken.pending).toEqual([])
    // 分かっている個人名が無くても、表の人で確かめる
    expect(await call(chatTools(newTurnState(table)), "propose_rule", { scope: "customer", items: ["山田太郎の件は外す"] })).toMatchObject({ ok: false })
  })
})
