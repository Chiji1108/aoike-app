import { OFFICE_NAME } from "../constants"
import { groupBy } from "../group-by"
import type { RowResult } from "../convert/convert"
import type { KojiFieldId } from "../spec/koji-keireki"
import { ASK_COLUMNS, CASE_TOPICS, columnOf, namedOf, type AskColumn, type CellInquiry, type Inquiry } from "./inquiry"
import type { InquiryText } from "./text"

/** 宛名の差し込み位置（職員が書き換える） */
export const ADDRESSEE_PLACEHOLDER = "〇〇〇〇"

/** 決まった件名・前置き（AI の文も職員の文も無いとき） */
export const DEFAULT_SUBJECT = `工事経歴書の作成についてのご確認（${OFFICE_NAME}）`
export const DEFAULT_INTRO = [
  "工事経歴書の作成にあたり、お預かりした資料だけでは分からない点がございましたので、",
  "お手数をおかけしますが、以下についてご教示いただけますでしょうか。",
].join("\n")

type KojiRow = RowResult<KojiFieldId>

/** 項目ごとの、聞く工事の数（工事場所の都道府県と場所名は1件。並びは聞く項目の順） */
export function countsByItem(inquiries: readonly Inquiry[]): { label: string; count: number }[] {
  const rows = new Map<AskColumn, Set<string>>()
  for (const q of inquiries) {
    const column = q.kind === "cell" ? columnOf(q.field) : undefined
    if (q.kind === "cell" && column) rows.set(column, (rows.get(column) ?? new Set()).add(q.rowKey))
  }
  return [...rows].sort(([a], [b]) => ASK_COLUMNS.indexOf(a) - ASK_COLUMNS.indexOf(b)).map(([column, keys]) => ({ label: column.label, count: keys.size }))
}

/** メールで工事を見分ける見出し（工事名と注文者。個人名は氏名で出す） */
const workTitle = (row: KojiRow) => {
  const work = namedOf(row.cells.workName) || "（工事名なし）"
  const client = namedOf(row.cells.client)
  return client ? `${work}（${client}）` : work
}

/**
 * 1つの工事で聞く項目の行。データに無い項目は名前だけ、推定に自信がない値は読んだ値を添えて確かめてもらう
 * （工事場所の都道府県と場所名は1つの項目にまとめる）
 */
function askLines(row: KojiRow, qs: readonly CellInquiry[]): string[] {
  return ASK_COLUMNS.flatMap((column) => {
    const asked = qs.filter((q) => column.fields.includes(q.field))
    if (!asked.length) return []
    const shown = column.show(row)
    const guessed = asked.every((q) => q.reason === "needsReview") && shown
    return [`　・${column.label}${guessed ? `: 資料から「${shown}」と読みました。違っていればお知らせください` : ""}`]
  })
}

/**
 * 顧客への問い合わせメールの件名と本文。案件全体の質問（税込・税抜）は1つずつ、セルの問い合わせは工事ごとに聞く項目を並べる
 * （CSV に載せる行の並びの順）。答え方の説明は聞く項目のものだけ。宛名・挨拶・結びは決まった文。rows は画面の表の行
 */
export function inquiryEmail(inquiries: readonly Inquiry[], rows: readonly KojiRow[], text: InquiryText): { subject: string; body: string } {
  const sections: string[] = []
  const cases = inquiries.flatMap((q) => (q.kind === "case" ? [CASE_TOPICS[q.topic].question] : []))
  cases.forEach((t, i) => sections.push(`${i + 1}. ${t}`))
  const cells = inquiries.filter((q): q is CellInquiry => q.kind === "cell")
  const byRow = groupBy(cells, (q) => q.rowKey)
  const works = rows.flatMap((row) => {
    const qs = byRow.get(row.key)
    const lines = qs ? askLines(row, qs) : []
    return lines.length ? [[`■ ${workTitle(row)}`, ...lines].join("\n")] : []
  })
  if (works.length) {
    const asked = new Set(cells.map((q) => columnOf(q.field)))
    const hints = [...new Set(ASK_COLUMNS.flatMap((c) => (c.hint && asked.has(c) ? [c.hint] : [])))]
    sections.push(
      [
        `${cases.length + 1}. 次の工事について、分かる範囲でお知らせください（${works.length}件）。`,
        ...hints.map((h) => `　※${h}`),
        "　※分からない項目は、その旨をお知らせください。",
        "",
        works.join("\n\n"),
      ].join("\n"),
    )
  }
  const body = [
    `${ADDRESSEE_PLACEHOLDER} 様`,
    "",
    `いつもお世話になっております。${OFFICE_NAME}でございます。`,
    text.intro ?? DEFAULT_INTRO,
    "",
    ...sections.flatMap((s) => [s, ""]),
    "ご不明な点がございましたら、お気軽にお問い合わせください。",
    "どうぞよろしくお願いいたします。",
    "",
    OFFICE_NAME,
  ].join("\n")
  return { subject: text.subject ?? DEFAULT_SUBJECT, body }
}
