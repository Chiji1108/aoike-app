import { describe, expect, test } from "vitest"
import { kojiRow } from "../../convert/__tests__/helpers"
import { countsByItem, DEFAULT_SUBJECT, inquiryEmail } from "../email"
import { collectInquiries } from "../inquiry"
import { applyInquiryChange, diffInquiryText, EMPTY_INQUIRY_TEXT, inquiryTextDiffSchema, inquiryTextSchema, otherCustomerTest, revertInquiryText } from "../text"

const full = { gyoshu: "8", client: "株式会社テスト", motoukeShitauke: "1", jv: "0", workName: "テストビル電気工事", prefecture: "東京都", place: "千代田区", engineer: "試験　太郎", amount: "5000", specialAmount: "0", startYm: "202404", endYm: "202409" }
const guessedEnd = (n: number) => {
  const r = kojiRow({ ...full, workName: `テスト工事${n}` }, n)
  r.cells.endYm = { value: "202409", status: "warning", source: "J列", original: "", message: "引渡日から推定", guessed: true }
  return r
}
const rows = [guessedEnd(2), guessedEnd(3), kojiRow({ ...full, engineer: "" }, 4), kojiRow({ ...full, engineer: "", prefecture: "", place: "" }, 5)]
const qs = collectInquiries(rows, { tax: "unknown" })

describe("メールの件名と前置き", () => {
  test("年月の答え方は、着工年月・完成年月のどちらを聞くときも1回だけ添える", () => {
    const endOnly = [guessedEnd(2)]
    const body = inquiryEmail(collectInquiries(endOnly, { tax: "included" }), endOnly, EMPTY_INQUIRY_TEXT).body
    expect(body.match(/「2024年4月」のようにお知らせください/g)).toHaveLength(1)
    expect(inquiryEmail(qs, rows, EMPTY_INQUIRY_TEXT).body.match(/「2024年4月」のようにお知らせください/g)).toHaveLength(1)
  })

  test("承認した件名と前置きを使い、無ければ決まった文。前の作業の質問の文（questions）は読み捨てる", () => {
    const text = applyInquiryChange(EMPTY_INQUIRY_TEXT, { kind: "inquiryMail", subject: "工事経歴書のご確認", intro: "資料ありがとうございました。いくつか教えてください。" })
    const mail = inquiryEmail(qs, rows, text)
    expect(mail.subject).toBe("工事経歴書のご確認")
    expect(mail.body).toContain("資料ありがとうございました。")
    expect(inquiryEmail(qs, rows, EMPTY_INQUIRY_TEXT).subject).toBe(DEFAULT_SUBJECT)
    const legacy = { subject: "件名", intro: null, questions: [{ id: "a", text: "前の質問", targets: [{ field: "engineer" }], by: "ai" }] }
    expect(inquiryTextSchema.parse(legacy)).toEqual({ subject: "件名", intro: null })
  })

  test("項目ごとの件数は工事の数（工事場所の都道府県と場所名は1件）。聞く項目の順", () => {
    expect(countsByItem(qs)).toEqual([
      { label: "完成年月", count: 2 },
      { label: "工事場所", count: 1 },
      { label: "配置技術者", count: 2 },
    ])
  })

  test("取り消しは、承認のあとに職員が直していなければ件名・前置きを前に戻す。前の記録の質問の文の違いは読み捨てる", () => {
    const after = { subject: "AI の件名", intro: "AI の前置き" }
    const diff = diffInquiryText(EMPTY_INQUIRY_TEXT, after)!
    expect(revertInquiryText(after, diff)).toEqual({ text: EMPTY_INQUIRY_TEXT, reverted: 2, kept: 0 })
    expect(revertInquiryText({ ...after, intro: "職員が直した" }, diff)).toEqual({ text: { subject: null, intro: "職員が直した" }, reverted: 1, kept: 1 })
    expect(inquiryTextDiffSchema.parse({ questions: [["a", null, null]] })).toBeUndefined()
  })

  test("ほかの顧客の名前は、会社の種類・空白・全角半角の違いを除いて見つける（3文字に満たない名前は見ない）", () => {
    const has = otherCustomerTest(["株式会社サンプル建設", "ＡＢ"])
    expect(has("サンプル建設様の工事と同じく、引渡日でよいですか。")).toBe(true)
    expect(has("サンプル 建設")).toBe(true)
    expect(has("ABの工事")).toBe(false)
    expect(has("この工事は引渡日を完成日としてよいですか。")).toBe(false)
    // この案件の顧客の名前の中にほかの顧客の名前があっても断らない
    expect(otherCustomerTest(["株式会社サンプル建設"], "サンプル建設工業")("サンプル建設工業様 工事経歴書のご確認")).toBe(false)
    const own = otherCustomerTest(["株式会社サンプル建設工業本社"], "サンプル建設")
    expect(own("サンプル建設工業本社様と同じ件")).toBe(true)
    expect(own("サンプル建設様の工事経歴書")).toBe(false)
  })
})
