import { describe, expect, test } from "vitest"
import { readWorkbook } from "../../convert/workbook"
import { fileAddressLookup } from "../../convert/address-file"
import { NO_ADDRESSES } from "../../convert/address"
import { finalizeAll, fixture, kojiRow } from "../../convert/__tests__/helpers"
import { heuristicPlan } from "../../convert/heuristic-plan"
import { runConversion, type AiCache, type AiCaller } from "../../convert/pipeline"
import { collectSourceRows } from "../../convert/sources"
import { aiKey, convertRows, editKey, editText, resolveRows, staffEdit, type CellEdits, type RowResult } from "../../convert/convert"
import { personToken } from "../../convert/persons"
import type { MappingPlan } from "../../convert/plan"
import type { AiBatchRequest } from "../../convert/ai-tasks"
import { KOJI_KEIREKI, KOJI_PLAN_HINTS, type KojiFieldId } from "../../spec/koji-keireki"
import { ADDRESSEE_PLACEHOLDER, DEFAULT_SUBJECT, inquiryEmail, inquiryNumbers } from "../email"
import { EMPTY_INQUIRY_TEXT } from "../text"
import { collectInquiries, CORRECTION_MESSAGE, readAiAnswers, type AiAnswer, type AnswerReport, type Inquiry } from "../inquiry"

/** 工事の番号（足した行の無い表） */
const numbersOf = (rows: Parameters<typeof inquiryNumbers>[0]["rows"]) => inquiryNumbers({ rows, added: [] })
const full = {
  gyoshu: "8", client: "株式会社テスト", motoukeShitauke: "1", jv: "0", workName: "テストビル電気工事", prefecture: "東京都",
  place: "千代田区", engineer: "試験　太郎", amount: "5000", specialAmount: "0", startYm: "202404", endYm: "202409",
} satisfies Partial<Record<KojiFieldId, string>>

const complete = kojiRow(full, 1)
const noEngineer = kojiRow({ ...full, engineer: "" }, 2)
const guessedPlace = (() => {
  const r = kojiRow({ ...full, workName: "テスト倉庫改修工事" }, 3)
  r.cells.place = { value: "港区", status: "warning", source: "E列", original: "", message: "現場名から推定", guessed: true }
  return r
})()
const noLocation = kojiRow({ ...full, prefecture: "", place: "", startYm: "" }, 4)

/** 工事名の列だけがあり、都道府県・場所名は工事名から AI で推定する計画 */
const inferPlan = (() => {
  const fields = Object.fromEntries(KOJI_KEIREKI.fields.map((f) => [f.id, { kind: "missing" as const }])) as MappingPlan<KojiFieldId>["fields"]
  fields.workName = { kind: "column", column: 0, transform: "rule.text" }
  fields.prefecture = { kind: "column", column: 0, transform: "ai.inferPrefecture" }
  fields.place = { kind: "column", column: 0, transform: "ai.inferPlace" }
  return { sheets: ["s"], headerRow: 0, dataRows: { start: 1, end: 1 }, skipRows: [], rowFilter: { excludeHidden: false, excludeColumns: [], excludeValues: [] }, amountUnit: "thousandYen", fields, unusedColumns: [], notes: [], asks: [] } satisfies MappingPlan<KojiFieldId>
})()

const cells = (qs: Inquiry[]) => qs.flatMap((q) => (q.kind === "cell" ? [`${q.rowKey}:${q.field}:${q.reason}`] : [`case:${q.topic}`]))
/** APIキーなし（AI を呼ばない）で回答を読む */
const noAi = () => ({ ctx: { rounding: "floor" as const }, lookup: fileAddressLookup, cache: new Map(), fields: {} })
/** 顧客が書き換えた欄の反映（推定をそのまま返した「確認」は除く） */
const customerEdits = (r: AnswerReport) => r.edits.filter(([, e]) => e.by === "customer")
/** AI が読んだ1項目の答え */
const say = (rowKey: string, field: KojiFieldId, answer: string): AiAnswer => ({ rowKey, field, answer })
/** 匿名化の決まった応答: 注文者は全体、工事名は「邸」の前を個人名として印にする（記号はアプリが付ける） */
const cannedAnonymize = async (req: AiBatchRequest) => ({
  ok: true as const,
  json: {
    results: req.items.map((i) => {
      if (req.task === "anonymizeClient") return { id: i.id, value: "〔1〕", persons: [i.input], needsReview: false, note: "" }
      const m = /^(.+?)様?邸/.exec(i.input)
      return m ? { id: i.id, value: i.input.replace(m[1]!, "〔1〕"), persons: [m[1]!], needsReview: false, note: "" } : { id: i.id, value: i.input, persons: [], needsReview: false, note: "" }
    }),
  },
})

describe("collectInquiries", () => {
  test("書類に要る項目が空のセルと、推定に自信がないセルを聞く。揃っている行・CSV で任意の項目（主任技術者など）は聞かない", () => {
    const qs = collectInquiries([complete, noEngineer, guessedPlace, noLocation], { tax: "included" })
    expect(cells(qs)).toEqual([
      "s!2:engineer:missing",
      "s!3:place:needsReview",
      "s!4:prefecture:missing",
      "s!4:place:missing",
      "s!4:startYm:missing",
    ])
  })

  test("匿名化の検算に落ちて出さなかった値は、元データにあるので顧客に聞かない（職員が直す）", async () => {
    const [grid] = readWorkbook("sample-messy.xlsx", fixture("sample-messy.xlsx"))
    const plan = heuristicPlan(KOJI_KEIREKI, KOJI_PLAN_HINTS, grid!)
    const { rows: sources } = collectSourceRows([grid!], plan)
    const leaky = async (req: AiBatchRequest) =>
      req.task === "anonymizeWorkName"
        ? { ok: true as const, json: { results: req.items.map((i) => ({ id: i.id, value: i.input, persons: ["山田太郎"], needsReview: false, note: "" })) } }
        : cannedAnonymize(req)
    const rows = finalizeAll(await runConversion({ lookup: fileAddressLookup, spec: KOJI_KEIREKI, sources, plan, ctx: { rounding: "floor" }, cache: new Map(), callAi: leaky }), { replacements: {}, edits: new Map() }).rows
    const yamada = rows.find((r) => r.cells.client.value === "Ａ")!
    expect(yamada.cells.workName).toMatchObject({ value: "", status: "error" })
    expect(yamada.cells.workName.message).toContain("手で入力してください")
    expect(cells(collectInquiries([yamada], { tax: "included" })).filter((q) => q.includes("workName"))).toEqual([])
  })

  test("AI を使えずに空になった欄は、元データに値があるので顧客に聞かない（職員が変換をやり直す）", async () => {
    const [grid] = readWorkbook("sample-messy.xlsx", fixture("sample-messy.xlsx"))
    const plan = heuristicPlan(KOJI_KEIREKI, KOJI_PLAN_HINTS, grid!)
    const { rows: sources } = collectSourceRows([grid!], plan)
    const failing = async () => ({ ok: false as const, message: "AI のエラー" })
    const rows = finalizeAll(await runConversion({ lookup: fileAddressLookup, spec: KOJI_KEIREKI, sources, plan, ctx: { rounding: "floor" }, cache: new Map(), callAi: failing })).rows
    const noPrefecture = rows.filter((r) => r.cells.prefecture.value === "" && r.cells.prefecture.original !== "")
    expect(noPrefecture.length).toBeGreaterThan(0)
    expect(cells(collectInquiries(noPrefecture, { tax: "included" })).filter((q) => q.includes("prefecture"))).toEqual([])
  })

  test("元データに無い所在地を推定する AI が使えなかった欄は、データに無いので顧客に聞く", () => {
    const drafts = convertRows(KOJI_KEIREKI, [{ sheet: "s", row: 1, cells: ["テスト倉庫改修工事"], hidden: false }], inferPlan, { rounding: "floor", addresses: NO_ADDRESSES })
    const rows = finalizeAll(resolveRows(drafts, new Map())).rows
    expect(rows[0]!.cells.prefecture).toMatchObject({ value: "" })
    expect(rows[0]!.cells.prefecture.withheld).toBeUndefined()
    expect(cells(collectInquiries(rows, { tax: "included" })).filter((q) => q.includes("prefecture") || q.includes("place"))).toEqual(["s!1:prefecture:missing", "s!1:place:missing"])
  })

  test("職員が手直しで空にした欄は、わざと空にしたので聞かない", () => {
    const [cleared] = finalizeAll([complete], { edits: new Map([[editKey("s!1", "engineer"), { value: "", by: "staff" }]]) }).rows
    expect(cleared!.cells.engineer.value).toBe("")
    expect(cells(collectInquiries([cleared!], { tax: "included" }))).toEqual([])
    expect(cells(collectInquiries(finalizeAll([noEngineer]).rows, { tax: "included" }))).toEqual(["s!2:engineer:missing"])
  })

  test("税区分が不明なら案件単位で税込・税抜を聞く", () => {
    expect(cells(collectInquiries([complete], { tax: "unknown" }))).toEqual(["case:tax"])
    expect(collectInquiries([complete], { tax: "excluded" })).toEqual([])
  })
})

describe("問い合わせのメール", () => {
  const rows = [complete, noEngineer, guessedPlace, noLocation]
  const qs = collectInquiries(rows, { tax: "unknown" })

  test("宛名の空欄・税込税抜の質問と、工事ごとに聞く項目を並べる。推定の値は読んだ値を添えて確かめてもらう", () => {
    const { subject, body } = inquiryEmail(qs, rows, numbersOf(rows), EMPTY_INQUIRY_TEXT)
    expect(subject).toBe(DEFAULT_SUBJECT)
    expect(body.startsWith(`${ADDRESSEE_PLACEHOLDER} 様`)).toBe(true)
    expect(body).toContain("1. いただいた資料の請負代金は、税込・税抜のどちらでしょうか。")
    expect(body).toContain("2. 次の工事について、分かる範囲でお知らせください（3件）。")
    expect(body).toContain(
      [
        "■ 2. テストビル電気工事（株式会社テスト）",
        "　（着工 2024年4月・完成 2024年9月・請負代金 5,000千円）",
        "　・配置技術者",
        "",
        "■ 3. テスト倉庫改修工事（株式会社テスト）",
        "　（着工 2024年4月・完成 2024年9月・請負代金 5,000千円）",
        "　・工事場所: 資料から「東京都港区」と読みました。違っていればお知らせください",
        "",
        "■ 4. テストビル電気工事（株式会社テスト）",
        "　（完成 2024年9月・請負代金 5,000千円）",
        "　・着工年月",
        "　・工事場所",
      ].join("\n"),
    )
    // 同じ工事名でも番号と見分ける値で見分け、一覧のすぐ上の決まった文で答えに番号を添えてもらう（前置きを書き換えても消えない）
    expect(body).toContain("（3件）。\n　※工事ごとに番号を振っております。ご回答の際は番号を添えてください。")
    expect(inquiryEmail(qs, rows, numbersOf(rows), { subject: null, intro: "職員の前置き" }).body).toContain("ご回答の際は番号を添えてください")
    // 答え方の説明は聞く項目のものだけ
    expect(body).toContain("　※着工・完成年月は「2024年4月」のようにお知らせください。")
    expect(body).toContain("　※工事場所は都道府県から市区町村までお知らせください（例: 東京都千代田区）。")
    expect(body).not.toContain("管理番号")
  })

  test("工事の番号は元の行の順の通し番号（足した行は後ろ）。答えた・外した・並べ替えたでは変わらず、一覧は番号の順（飛び飛びでよい）", () => {
    const numbers = inquiryNumbers({ rows, added: [{ key: "add-1" }] })
    expect([...numbers]).toEqual([
      [complete.key, 1],
      [noEngineer.key, 2],
      [guessedPlace.key, 3],
      [noLocation.key, 4],
      ["add-1", 5],
    ])
    // 並べ替えた表の行・一部を外した問い合わせでも、番号と並びは同じ
    const reordered = [noLocation, guessedPlace, complete, noEngineer]
    const withoutPlace = qs.filter((q) => !(q.kind === "cell" && q.rowKey === guessedPlace.key))
    const body = inquiryEmail(withoutPlace, reordered, numbers, EMPTY_INQUIRY_TEXT).body
    expect(body.match(/^■ \d+/gm)).toEqual(["■ 2", "■ 4"])
  })

  test("聞く工事が無ければ工事の項は出さない", () => {
    const { body } = inquiryEmail(collectInquiries([complete], { tax: "unknown" }), [complete], numbersOf([complete]), EMPTY_INQUIRY_TEXT)
    expect(body).toContain("1. いただいた資料の請負代金は、税込・税抜のどちらでしょうか。")
    expect(body).not.toContain("次の工事について")
  })
})

describe("AI が読んだ回答を値にする", () => {
  const rows = [complete, noEngineer, guessedPlace, noLocation]
  const finalize = (rs: RowResult<KojiFieldId>[], edits = new Map()) => finalizeAll(rs, { edits }).rows

  test("答えを顧客の回答として適用する。聞いた工事場所の答えで都道府県も変わっていれば、聞いていない都道府県も適用して知らせる", async () => {
    const report = await readAiAnswers(
      [say("s!2", "engineer", "試験 次郎"), say("s!3", "place", "神奈川県横浜市中区山下町1"), say("s!4", "startYm", "2024年5月"), say("s!4", "place", "大阪府大阪市北区梅田1-1")],
      rows,
      noAi(),
    )
    expect(Object.fromEntries(report.edits)).toEqual({
      [editKey("s!2", "engineer")]: { value: "試験　次郎", by: "customer" },
      [editKey("s!3", "place")]: { value: "横浜市中区", by: "customer" },
      [editKey("s!3", "prefecture")]: { value: "神奈川県", by: "customer", message: CORRECTION_MESSAGE },
      [editKey("s!4", "startYm")]: { value: "202405", by: "customer" },
      [editKey("s!4", "prefecture")]: { value: "大阪府", by: "customer" },
      [editKey("s!4", "place")]: { value: "大阪市北区", by: "customer" },
    })
    expect(report.alsoChanged).toEqual([{ rowKey: "s!3", field: "prefecture", was: "東京都", answer: "神奈川県" }])
    expect(report.applied.map((q) => `${q.rowKey}:${q.field}`).sort()).toEqual(["s!2:engineer", "s!3:place", "s!4:place", "s!4:prefecture", "s!4:startYm"])
    const out = finalize(rows, new Map(report.edits))
    expect(out[2]!.cells.prefecture.value + out[2]!.cells.place.value).toBe("神奈川県横浜市中区")
    expect(out[1]!.cells.engineer).toMatchObject({ value: "試験　次郎", status: "changed", message: "顧客の回答" })
    expect(collectInquiries(out, { tax: "included" })).toEqual([])
  })

  test("工事場所の片方だけ読めたときは、読めた側も反映しない", async () => {
    const report = await readAiAnswers([say("s!4", "place", "千代田区")], rows, noAi())
    expect(report.edits).toEqual([])
    expect(report.heldBack).toEqual([{ rowKey: "s!4", field: "place", answer: "千代田区" }])
    expect(report.invalid.map((x) => `${x.inquiry.rowKey}:${x.inquiry.field}`)).toEqual(["s!4:prefecture"])
  })

  test("工事場所の答えに市区町村が読み取れなければ、残りを場所名にせず読み取れないと知らせる", async () => {
    const report = await readAiAnswers([say("s!4", "place", "東京都丸の内1-1")], rows, noAi())
    expect(report.edits).toEqual([])
    expect(report.invalid.map((x) => `${x.inquiry.field}:${x.answer}`).sort()).toEqual(["place:東京都丸の内1-1", "prefecture:東京都丸の内1-1"])
  })

  test("工事場所の答えは変換と同じく住所データで分ける。都府県を省いた名前（「神奈川横浜市中区」）は続く市区町村で確かめ、「長野原町」を長野県と読み違えない", async () => {
    const at = (rowKey: string, answer: string) => readAiAnswers([say(rowKey, "place", answer)], rows, noAi())
    const placeEdits = (r: AnswerReport, row: string) => Object.fromEntries(r.edits.filter(([k]) => k.startsWith(`${row}:p`)))
    const naganohara = await at("s!4", "長野原町大字長野原")
    expect(placeEdits(naganohara, "s!4")).toEqual({})
    expect(naganohara.heldBack).toEqual([{ rowKey: "s!4", field: "place", answer: "吾妻郡長野原町" }])
    expect(placeEdits(await at("s!3", "京都市中京区"), "s!3")).toEqual({ [editKey("s!3", "place")]: { value: "京都市中京区", by: "customer" } })
    expect(placeEdits(await at("s!4", "神奈川横浜市中区山下町1"), "s!4")).toEqual({
      [editKey("s!4", "prefecture")]: { value: "神奈川県", by: "customer" },
      [editKey("s!4", "place")]: { value: "横浜市中区", by: "customer" },
    })
    expect(placeEdits(await at("s!4", "神奈川県横浜市"), "s!4")).toEqual({
      [editKey("s!4", "prefecture")]: { value: "神奈川県", by: "customer" },
      [editKey("s!4", "place")]: { value: "横浜市", by: "customer" },
    })
    const noCity = await at("s!4", "東京都丸の内1-1")
    expect(noCity.invalid[0]!.message).toContain("市区町村を読み取れません")
    const unreadable = await at("s!4", "丸の内1-1")
    expect(unreadable.invalid.map((x) => x.inquiry.field).sort()).toEqual(["place", "prefecture"])
    expect(unreadable.invalid[0]!.message).toContain("都道府県名から書いてください")
  })

  test("都道府県だけ聞いて住所ごと書き直されたとき、市区町村までに縮めた場所名で聞いていない場所名を上書きしない（書き換えた場所名は反映する）", async () => {
    const detailed = kojiRow({ ...full, prefecture: "", place: "千代田区丸の内" }, 7)
    expect(cells(collectInquiries([detailed], { tax: "included" }))).toEqual(["s!7:prefecture:missing"])
    const rewritten = await readAiAnswers([say("s!7", "place", "東京都千代田区丸の内1-1")], [detailed], noAi())
    expect(Object.fromEntries(rewritten.edits)).toEqual({ [editKey("s!7", "prefecture")]: { value: "東京都", by: "customer" } })
    expect(rewritten.alsoChanged).toEqual([])
    const moved = await readAiAnswers([say("s!7", "place", "神奈川県横浜市中区")], [detailed], noAi())
    expect(moved.alsoChanged).toEqual([{ rowKey: "s!7", field: "place", was: "千代田区丸の内", answer: "横浜市中区" }])
  })

  test("工事場所の片方だけ聞いたとき、もう片方を今のとおりと返されたら未回答（読み取れないとは言わない）", async () => {
    const placeOnly = kojiRow({ ...full, place: "" }, 5)
    const prefectureOnly = kojiRow({ ...full, prefecture: "" }, 6)
    const rs = [placeOnly, prefectureOnly]
    expect(cells(collectInquiries(rs, { tax: "included" }))).toEqual(["s!5:place:missing", "s!6:prefecture:missing"])
    const report = await readAiAnswers(
      [
        { rowKey: "s!5", field: "prefecture", confirm: true },
        { rowKey: "s!6", field: "place", confirm: true },
      ],
      rs,
      noAi(),
    )
    expect(report.invalid).toEqual([])
    expect(report.edits).toEqual([])
    expect(report.unanswered.map((q) => `${q.rowKey}:${q.field}`)).toEqual(["s!5:place", "s!6:prefecture"])
  })

  test("反映済みの答えをもう一度読んでも、何も変えない（もう聞いていない項目の、今と同じ値の訂正として読む）", async () => {
    const items = [say("s!2", "engineer", "試験 次郎"), say("s!3", "place", "神奈川県横浜市中区")]
    const first = await readAiAnswers(items, rows, noAi())
    const again = await readAiAnswers(items, finalize(rows, new Map(first.edits)), noAi())
    expect(again.edits).toEqual([])
    expect(again.alsoChanged).toEqual([])
    expect([...again.applied, ...again.invalid, ...again.uncorrected]).toEqual([])
  })

  test("注文者の答えは空白だけを整え、半角の表記（半角英数・半角カナ）は顧客の書いたまま", async () => {
    const noClient = kojiRow({ ...full, client: "" }, 7)
    const report = await readAiAnswers([say("s!7", "client", "株式会社  ABC ﾃｸﾉ")], [noClient], noAi())
    expect(report.edits).toEqual([[editKey("s!7", "client"), { value: "株式会社 ABC ﾃｸﾉ", by: "customer" }]])
    expect(finalize([noClient], new Map(report.edits))[0]!.cells.client).toMatchObject({ status: "changed" })
  })

  test("推定に自信がない値のとおりという答えは、顧客が確認したものとして推定の印を外し、次からは聞かない", async () => {
    const report = await readAiAnswers([{ rowKey: "s!3", field: "place", confirm: true }], rows, noAi())
    expect(report.edits).toEqual([[editKey("s!3", "place"), { value: "港区", by: "confirmed" }]])
    const out = finalize(rows, new Map(report.edits))
    expect(out[2]!.cells.place).toMatchObject({ value: "港区", message: "顧客が確認" })
    expect(out[2]!.cells.place.guessed).toBeUndefined()
    expect(cells(collectInquiries(out, { tax: "included" }))).not.toContain("s!3:place:needsReview")

    const again = await readAiAnswers([{ rowKey: "s!3", field: "place", confirm: true }], out, noAi())
    expect(again.edits).toEqual([])
    expect(again.confirmed).toEqual([])
  })

  test("メールは顧客に送るので個人名を氏名で出す。推定のとおりという答えは、記号が付け直されても確認として扱う", async () => {
    const yamada = personToken("山田太郎")
    const guessedClient = kojiRow(full, 5)
    guessedClient.cells.client = { value: yamada, status: "ai", source: "C列", original: "山田太郎", guessed: true }
    const sentRows = finalize([guessedClient])
    expect(sentRows[0]!.cells.client.value).toBe("Ａ")
    const { body } = inquiryEmail(collectInquiries(sentRows, { tax: "included" }), sentRows, numbersOf(sentRows), EMPTY_INQUIRY_TEXT)
    expect(body).toContain("　・注文者: 資料から「山田太郎」と読みました。違っていればお知らせください")
    expect(body).not.toMatch(/Ａ/)

    const nowRows = finalize([kojiRow({ ...full, client: personToken("鈴木一郎") }, 4), guessedClient])
    expect(nowRows[1]!.cells.client.value).toBe("Ｂ")
    const report = await readAiAnswers([{ rowKey: "s!5", field: "client", confirm: true }], nowRows, noAi())
    expect(report.edits).toEqual([[editKey("s!5", "client"), { value: yamada, by: "confirmed" }]])
  })

  test("答えの氏名は元データの値と同じく匿名化し、案件のほかの行と同じ人には同じ記号が付く。「Ａ棟」のような文字はそのまま", async () => {
    const yamada = personToken("山田太郎")
    const guessedWork = kojiRow(full, 40)
    guessedWork.cells.workName = { value: `${yamada}邸新築工事`, status: "warning", source: "C列", original: "山田太郎邸新築工事", guessed: true }
    const before = [kojiRow({ ...full, client: personToken("鈴木一郎") }, 4), guessedWork]
    const nowRows = finalize(before)
    expect(nowRows[1]!.cells.workName.value).toBe("Ｂ邸新築に伴う電気工事")
    const sentToAi: string[] = []
    const callAi = async (req: AiBatchRequest) => (sentToAi.push(...req.items.map((i) => i.input)), cannedAnonymize(req))
    const report = await readAiAnswers([say("s!40", "workName", "山田太郎邸改修工事（Ａ棟）")], nowRows, { ...noAi(), callAi })
    expect(sentToAi).toEqual(["山田太郎邸改修工事（Ａ棟）"])
    expect(customerEdits(report)).toEqual([[editKey("s!40", "workName"), { value: `${yamada}邸改修工事（Ａ棟）`, by: "customer", status: "ai", byAi: true }]])
    expect(finalize(before, new Map(report.edits))[1]!.cells.workName.value).toBe("Ｂ邸改修工事（Ａ棟）に伴う電気工事")
  })

  test("注文者・工事名の答えも元データの値と同じ変換を通す。個人名は AI で「Ａ」等にし、AI が使えなければ反映せず前の値のまま知らせる", async () => {
    const blank = kojiRow({ ...full, client: "", workName: "" }, 8)
    const items = [say("s!8", "client", "山田 太郎"), say("s!8", "workName", "山田太郎邸新築工事")]
    const sentToAi: string[] = []
    const callAi = async (req: AiBatchRequest) => {
      sentToAi.push(...req.items.map((i) => `${req.task}:${i.input}`))
      return cannedAnonymize(req)
    }

    const report = await readAiAnswers(items, [blank], { ...noAi(), callAi })
    expect(sentToAi.sort()).toEqual(["anonymizeClient:山田 太郎", "anonymizeWorkName:山田太郎邸新築工事"])
    const out = finalize([blank], new Map(report.edits))[0]!.cells
    expect([out.client.value, out.workName.value]).toEqual(["Ａ", "Ａ邸新築に伴う電気工事"])
    expect(out.client).toMatchObject({ status: "ai", source: "顧客の回答" })

    for (const unavailable of [noAi(), { ...noAi(), callAi: async () => ({ ok: false as const, message: "通信エラー" }) }]) {
      const offline = await readAiAnswers(items, [blank], unavailable)
      expect(offline.edits).toEqual([])
      const held = finalize([blank], new Map(offline.edits))[0]!.cells
      expect([held.client.value, held.workName.value]).toEqual(["", ""])
      expect(offline.invalid.map((c) => [c.inquiry.field, c.answer]).sort()).toEqual([["client", "山田 太郎"], ["workName", "山田太郎邸新築工事"]])
      for (const c of offline.invalid) expect(c.message).toContain("個人名の判定ができませんでした。手で入力してください")
    }
  })

  test("工事名の答えは、計画の変換の値だけを整える部分を当ててから匿名化する（列をつなぐ工事名なら空白を除く）。元データの列に向けた指示文は使わない", async () => {
    const blank = kojiRow({ ...full, workName: "" }, 8)
    const sent: string[] = []
    const callAi = async (req: AiBatchRequest) => (sent.push(...req.items.map((i) => `${req.task}:${req.instruction ?? ""}:${i.input}`)), cannedAnonymize(req))
    const fields = { workName: { kind: "columns" as const, columns: [3, 4], transform: "rule.joinWorkName" as const, instruction: "「邸」の前は個人名" } }
    const report = await readAiAnswers([say("s!8", "workName", "山田太郎邸 改修工事")], [blank], { ...noAi(), callAi, fields })
    expect(sent).toEqual(["anonymizeWorkName::山田太郎邸改修工事"])
    expect(customerEdits(report)).toEqual([[editKey("s!8", "workName"), { value: `${personToken("山田太郎")}邸改修工事`, by: "customer", status: "ai", byAi: true }]])
  })

  test("注文者の答えは、計画が法人だけの元データに匿名化しない変換・指示文の AI を使っていても、必ず匿名化を通す", async () => {
    const blank = kojiRow({ ...full, client: "" }, 8)
    const plans = [
      { kind: "column" as const, column: 3, transform: "rule.text" as const },
      { kind: "column" as const, column: 3, transform: "ai.freeform" as const, instruction: "C列の略称を正式名に" },
    ]
    for (const client of plans) {
      const sent: string[] = []
      const callAi = async (req: AiBatchRequest) => (sent.push(...req.items.map((i) => `${req.task}:${req.instruction ?? ""}:${i.input}`)), cannedAnonymize(req))
      const report = await readAiAnswers([say("s!8", "client", "山田太郎")], [blank], { ...noAi(), callAi, fields: { client } })
      expect(sent).toEqual(["anonymizeClient::山田太郎"])
      expect(finalize([blank], new Map(report.edits))[0]!.cells.client.value).toBe("Ａ")
    }
  })

  test("答えを読むときは自分の答えの AI の失敗だけを送り直し、変換の失敗の記録には触らない", async () => {
    const blank = kojiRow({ ...full, client: "" }, 8)
    const items = [say("s!8", "client", "山田 太郎")]
    const cache: AiCache = new Map([[aiKey("anonymizeClient", undefined, "鈴木 一郎"), { error: "変換のときの失敗" }]])
    const failing = { ctx: { rounding: "floor" as const }, lookup: fileAddressLookup, cache, fields: {}, callAi: async () => ({ ok: false as const, message: "通信エラー" }) }
    await readAiAnswers(items, [blank], failing)
    const sent: string[] = []
    const report = await readAiAnswers(items, [blank], { ...failing, callAi: async (req: AiBatchRequest) => (sent.push(...req.items.map((i) => i.input)), cannedAnonymize(req)) })
    expect(sent).toEqual(["山田 太郎"])
    expect(cache.get(aiKey("anonymizeClient", undefined, "鈴木 一郎"))).toEqual({ error: "変換のときの失敗" })
    expect(finalize([blank], new Map(report.edits))[0]!.cells.client.value).toBe("Ａ")
  })

  test("区切りに自信がない配置技術者は聞き、メールに読んだ値を添える。答えは元データと同じ変換（同じ案件の表記・AI）に通す", async () => {
    const unsure = kojiRow({ ...full, engineer: "仮名　次郎" }, 10)
    unsure.cells.engineer = { ...unsure.cells.engineer, status: "warning", guessed: true }
    const other = kojiRow({ ...full, engineer: "" }, 11)
    const third = kojiRow({ ...full, engineer: "" }, 12)
    const rs = [complete, unsure, other, third]
    const qs = collectInquiries(rs, { tax: "included" })
    expect(cells(qs)).toEqual(["s!10:engineer:needsReview", "s!11:engineer:missing", "s!12:engineer:missing"])
    expect(inquiryEmail(qs, rs, numbersOf(rs), EMPTY_INQUIRY_TEXT).body).toContain("　・配置技術者: 資料から「仮名　次郎」と読みました。違っていればお知らせください")

    const sent: string[] = []
    const callAi = async (req: AiBatchRequest) => {
      sent.push(...req.items.map((i) => `${req.task}:${i.input}`))
      return { ok: true as const, json: { results: req.items.map((i) => ({ id: i.id, value: "空想　花子", needsReview: false, note: "" })) } }
    }
    const report = await readAiAnswers([say("s!10", "engineer", "仮名 次郎"), say("s!11", "engineer", "試験太郎"), say("s!12", "engineer", "空想花子")], rs, { ...noAi(), callAi })
    expect(sent).toEqual(["personName:空想花子"])
    expect(report.confirmed.map((q) => q.rowKey)).toEqual(["s!10"])
    const edits = Object.fromEntries(report.edits)
    expect(edits[editKey("s!10", "engineer")]).toEqual({ value: "仮名　次郎", by: "confirmed" })
    expect(edits[editKey("s!11", "engineer")]).toMatchObject({ value: "試験　太郎", by: "customer" })
    expect(edits[editKey("s!12", "engineer")]).toMatchObject({ value: "空想　花子", by: "customer" })
  })

  test("区切りの無い氏名を AI で区切れなかったときは、元データでも答えでも推定として残し、もう一度聞く", async () => {
    const [grid] = readWorkbook("sample-messy.xlsx", fixture("sample-messy.xlsx"))
    const plan = heuristicPlan(KOJI_KEIREKI, KOJI_PLAN_HINTS, grid!)
    const { rows: sources } = collectSourceRows([grid!], plan)
    const down = async () => ({ ok: false as const, message: "通信エラー" })
    const converted = finalize(await runConversion({ lookup: fileAddressLookup, spec: KOJI_KEIREKI, sources, plan, ctx: { rounding: "floor" }, cache: new Map(), callAi: down }))
    const unsplit = converted.find((r) => r.cells.engineer.value === "青池一郎")!
    expect(unsplit.cells.engineer).toMatchObject({ status: "warning", guessed: true })
    expect(cells(collectInquiries([unsplit], { tax: "included" }))).toContain(`${unsplit.key}:engineer:needsReview`)

    const blank = kojiRow({ ...full, engineer: "" }, 30)
    const report = await readAiAnswers([say("s!30", "engineer", "空想花子")], [blank], { ...noAi(), callAi: down })
    expect(report.edits).toEqual([[editKey("s!30", "engineer"), expect.objectContaining({ value: "空想花子", by: "customer", status: "warning", guessed: true })]])
    expect(report.needsCheck.map((c) => c.field)).toEqual(["engineer"])
    expect(cells(collectInquiries(finalize([blank], new Map(report.edits)), { tax: "included" }))).toEqual(["s!30:engineer:needsReview"])
  })

  test("答えの氏名の区切りに使う同じ案件の表記は、元データ・確認済みの値だけ。AI が区切った氏名には合わせない", async () => {
    const byAi = kojiRow({ ...full, engineer: "架空　一郎" }, 20)
    byAi.cells.engineer = { ...byAi.cells.engineer, status: "ai", byAi: true }
    const unsure = kojiRow({ ...full, engineer: "仮名　次郎" }, 21)
    unsure.cells.engineer = { ...unsure.cells.engineer, status: "warning", guessed: true, byAi: true }
    const asked = [kojiRow({ ...full, engineer: "" }, 22), kojiRow({ ...full, engineer: "" }, 23), kojiRow({ ...full, engineer: "" }, 24)]
    const sent: string[] = []
    const callAi = async (req: AiBatchRequest) => {
      sent.push(...req.items.map((i) => i.input))
      return { ok: true as const, json: { results: req.items.map((i) => ({ id: i.id, value: `${i.input.slice(0, 2)}　${i.input.slice(2)}`, needsReview: false, note: "" })) } }
    }
    const items = [say("s!22", "engineer", "架空一郎"), say("s!23", "engineer", "仮名次郎"), say("s!24", "engineer", "試験太郎")]
    const report = await readAiAnswers(items, [complete, byAi, unsure, ...asked], { ...noAi(), callAi })
    expect(sent.sort()).toEqual(["仮名次郎", "架空一郎"])
    expect(Object.fromEntries(report.edits)[editKey("s!24", "engineer")]).toEqual({ value: "試験　太郎", by: "customer" })
  })

  test("AI が区切った氏名は、検証で状態がエラーに変わっても AI が区切ったものとして、答えの区切りに使わない", async () => {
    const g = { name: "s", rows: [["業種", "注文者", "工事名", "請負代金", "配置技術者"], ["電気", "株式会社テスト", "テスト工事", "1000000", "𠮷田一郎"]], hidden: [false, false] }
    const p = heuristicPlan(KOJI_KEIREKI, KOJI_PLAN_HINTS, g)
    const sent: string[] = []
    const split = async (req: AiBatchRequest) => {
      if (req.task !== "personName") return { ok: false as const, message: "この確認では使わない" }
      sent.push(...req.items.map((i) => i.input))
      return { ok: true as const, json: { results: req.items.map((i) => ({ id: i.id, value: `${[...i.input].slice(0, 2).join("")}　${[...i.input].slice(2).join("")}`, needsReview: false, note: "" })) } }
    }
    const converted = finalize(await runConversion({ lookup: fileAddressLookup, spec: KOJI_KEIREKI, sources: collectSourceRows([g], p).rows, plan: p, ctx: { rounding: "floor" }, cache: new Map(), callAi: split }))
    expect(converted[0]!.cells.engineer).toMatchObject({ value: "𠮷田　一郎", status: "error" })
    sent.length = 0

    const blank = kojiRow({ ...full, engineer: "" }, 30)
    await readAiAnswers([say("s!30", "engineer", "𠮷田一郎")], [...converted, blank], { ...noAi(), callAi: split })
    expect(sent).toEqual(["𠮷田一郎"])
  })
})

test("sample-inquiry.xlsx（APIキーなし）: 配置技術者の列が無い・完成日と工事場所が空の行を問い合わせにする", async () => {
  const sheets = readWorkbook("sample-inquiry.xlsx", fixture("sample-inquiry.xlsx"))
  const plan = heuristicPlan(KOJI_KEIREKI, KOJI_PLAN_HINTS, sheets[0]!)
  const { rows: sources } = collectSourceRows(sheets, plan)
  const noKey = async () => ({ ok: false as const, message: "APIキー未設定" })
  const { rows } = finalizeAll(await runConversion({ lookup: fileAddressLookup, spec: KOJI_KEIREKI, sources, plan, ctx: { rounding: "floor" }, cache: new Map(), callAi: noKey }), {
    replacements: {},
    edits: new Map(),
  })
  expect(cells(collectInquiries(rows, { tax: "unknown" }))).toEqual([
    "case:tax",
    "工事経歴!1:engineer:missing",
    "工事経歴!2:engineer:missing",
    "工事経歴!2:endYm:missing",
    "工事経歴!3:prefecture:missing",
    "工事経歴!3:place:missing",
    "工事経歴!3:engineer:missing",
    "工事経歴!4:engineer:missing",
  ])
})

describe("個人名の記号（セルには人を入れ、記号は最後の行から決める）", () => {
  const [grid] = readWorkbook("sample-messy.xlsx", fixture("sample-messy.xlsx"))
  const plan = heuristicPlan(KOJI_KEIREKI, KOJI_PLAN_HINTS, grid!)
  const { rows: sources } = collectSourceRows([grid!], plan)
  const ctx = { rounding: "floor" as const, addresses: NO_ADDRESSES }
  const finalize = (rs: RowResult<KojiFieldId>[], edits: CellEdits = new Map()) => finalizeAll(rs, { edits }).rows
  const convert = (cache: AiCache, callAi: AiCaller = cannedAnonymize) => runConversion({ lookup: fileAddressLookup, spec: KOJI_KEIREKI, sources, plan, ctx, cache, callAi })
  /** 鈴木の名前を含む依頼は AI が使えない（同じ依頼にまとめた山田も） */
  const suzukiDown = async (req: AiBatchRequest) => (req.items.some((i) => i.input.includes("鈴木")) ? { ok: false as const, message: "通信エラー" } : cannedAnonymize(req))
  /** 1つの行への注文者・工事名の答え */
  const ask = (row: RowResult<KojiFieldId>, fill: Partial<Record<"client" | "workName", string>>) =>
    (Object.entries(fill) as ["client" | "workName", string][]).map(([field, answer]) => say(row.key, field, answer))
  const answerAi = (cache: AiCache) => ({ ctx, lookup: fileAddressLookup, cache, callAi: cannedAnonymize, fields: plan.fields })
  const shown = (rs: RowResult<KojiFieldId>[]) => rs.map((r) => `${r.cells.client.value}/${r.cells.workName.value}`)
  const blank = kojiRow({ ...full, client: "", workName: "" }, 90)

  test("回答: 元データにいる人は同じ記号、新しい人は次の記号。同じ人の2回目の回答も同じ記号", async () => {
    const cache: AiCache = new Map()
    const all = [...(await convert(cache)), blank]
    expect(shown(finalize(all)).filter((v) => v.includes("Ａ") || v.includes("Ｂ"))).toEqual(["Ａ/Ａ邸新築工事", "Ｂ/Ｃ様邸リフォーム工事"])
    const first = await readAiAnswers(ask(blank, { client: "田中 花子", workName: "山田太郎邸改修工事" }), finalize(all), answerAi(cache))
    const edits = new Map(first.edits)
    expect(shown(finalize(all, edits)).at(-1)).toBe("Ｄ/Ａ邸改修に伴う電気工事")

    const second = kojiRow({ ...full, client: "" }, 91)
    const withSecond = [...all, second]
    const next = await readAiAnswers(ask(second, { client: "田中花子" }), finalize(withSecond, edits), answerAi(cache))
    expect(finalize(withSecond, new Map([...edits, ...next.edits])).at(-1)!.cells.client.value).toBe("Ｄ")
  })

  test("AI が直ってから変換をやり直しても、先に読んだ回答の人と記号がぶつからない", async () => {
    const cache: AiCache = new Map()
    const before = [...(await convert(cache, suzukiDown)), blank]
    const answers = await readAiAnswers(ask(blank, { client: "田中 花子" }), finalize(before), answerAi(cache))
    const edits = new Map(answers.edits)
    expect(finalize(before, edits).at(-1)!.cells.client.value).toBe("Ａ")

    const after = finalize([...(await convert(cache)), blank], edits)
    expect(shown(after).filter((v) => /[Ａ-Ｚ]/.test(v))).toEqual(["Ａ/Ａ邸新築工事", "Ｂ/Ｃ様邸リフォーム工事", "Ｄ/"])
  })

  test("職員の手直し: 〔Ａ〕で書いた記号はその人のまま。人が残るので次の回答の新しい人は別の記号。表に無い記号はエラー", async () => {
    const cache: AiCache = new Map()
    const all = [...(await convert(cache)), blank]
    const { rows: before, letters } = finalizeAll(all)
    const yamadaRow = before.find((r) => r.cells.client.value === "Ａ")!
    expect(editText(yamadaRow.cells.client, letters)).toBe("〔Ａ〕")
    const staff = new Map([
      [editKey(yamadaRow.key, "client"), staffEdit("〔Ａ〕様", letters)],
      [editKey(yamadaRow.key, "workName"), staffEdit("〔Ａ〕邸増築工事", letters)],
    ])
    const edited = finalize(all, staff)
    expect(shown(edited).filter((v) => v.includes("Ａ"))).toEqual(["Ａ様/Ａ邸増築工事"])

    const answers = await readAiAnswers(ask(blank, { client: "田中 花子" }), edited, answerAi(cache))
    expect(finalize(all, new Map([...staff, ...answers.edits])).at(-1)!.cells.client.value).toBe("Ｄ")

    const unknown = finalize(all, new Map([[editKey(yamadaRow.key, "workName"), staffEdit("〔Ｚ〕邸新築工事", letters)]]))
    expect(unknown.find((r) => r.key === yamadaRow.key)!.cells.workName).toMatchObject({ value: "〔Ｚ〕邸新築工事", status: "error" })
    expect(finalize(all, new Map([[editKey(yamadaRow.key, "workName"), staffEdit("Ａ棟改修工事", letters)]])).find((r) => r.key === yamadaRow.key)!.cells.workName).toMatchObject({ value: "Ａ棟改修工事", status: "changed" })
  })
})
