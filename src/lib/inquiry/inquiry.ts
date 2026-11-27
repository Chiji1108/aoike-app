import { groupBy } from "../group-by"
import { fieldLabel, KOJI_KEIREKI, type KojiFieldId } from "../spec/koji-keireki"
import { addressKey, type AddressBook, type AddressLookup } from "../convert/address"
import { editKey, resolveRows, transformCell, type CellDraft, type CellEdit, type CellResult, type RowDraft, type RowResult } from "../convert/convert"
import { fillAiCache, type AiCache, type AiCaller } from "../convert/pipeline"
import { formatYearMonth, parseYearMonth } from "../convert/dates"
import type { TaxMode } from "../convert/koji-selection"
import type { FieldPlan } from "../convert/plan"
import { getTransform, knownNameSplits, normalizePersonName, type TransformContext, type TransformId } from "../convert/transforms"
import { withNames } from "../convert/persons"
import { collapseSpaces } from "../convert/text"
import { PREFECTURES } from "../spec/prefectures"

/**
 * 顧客への問い合わせ。データに無い・分からないことだけを聞く（聞かなくてもできる整形は事務所でやる）。
 * 対象は CSV に載せる行だけ。聞くことはメールの本文に工事ごとに並べ（email.ts）、顧客の答えはチャットの AI が読んで record_answers で値にする（readAiAnswers）
 */

type KojiRow = RowResult<KojiFieldId>

export type InquiryReason = "missing" | "needsReview"
export type CaseTopic = "tax"

/**
 * current は聞いたときのセルの値（個人名は印のまま。照合はこれで行う）。
 * メールは顧客に送るものなので、個人名は記号ではなく氏名で出す（記号は CSV と画面だけ）。顧客の答えの氏名は元データの値と同じく匿名化する
 */
export type CellInquiry = {
  kind: "cell"
  rowKey: string
  field: KojiFieldId
  reason: InquiryReason
  current: string
}
export type CaseInquiry = { kind: "case"; topic: CaseTopic }
export type Inquiry = CellInquiry | CaseInquiry

export type InquirySettings = { tax: TaxMode }

export const inquiryKey = (q: Inquiry) => (q.kind === "cell" ? editKey(q.rowKey, q.field) : `case:${q.topic}`)

/** セルを問い合わせる理由。上から順に最初に当てはまるもの */
export const REASONS: Record<InquiryReason, { label: string; applies: (cell: CellResult) => boolean }> = {
  /**
   * 元データにあって出さなかった値（withheld）は職員が直すので聞かない。職員が手直しで空にした欄（チャットの変更案の承認も）も聞かない。
   * 職員が聞くと決めた空の欄（ask）は聞く
   */
  missing: { label: "データに無い", applies: (c) => c.value === "" && !c.withheld && (c.ask === true || (c.by !== "staff" && c.by !== "chat")) },
  needsReview: { label: "推定に自信がない", applies: (c) => c.guessed === true },
}

/** 案件全体の問い合わせ。question は決まった質問の文（AI の文が無いときにメールに載せる） */
export const CASE_TOPICS: Record<CaseTopic, { label: string; applies: (s: InquirySettings) => boolean; question: string }> = {
  tax: {
    label: "金額の税込・税抜",
    applies: (s) => s.tax === "unknown",
    question: "いただいた資料の請負代金は、税込・税抜のどちらでしょうか。",
  },
}

type Parsed = { ok: true; values: Partial<Record<KojiFieldId, string>> } | { ok: false; message: string }

/**
 * 顧客に聞く項目（工事場所は都道府県と場所名をまとめて1つ）。show はメールに書く今の値（推定を確かめてもらうとき）と、答えが今の値のままかを比べる値。
 * parse は顧客の答えを項目の値にする
 */
export type AskColumn = {
  /** 顧客に見せる項目の呼び名 */
  label: string
  fields: readonly KojiFieldId[]
  show: (row: KojiRow) => string
  /** メールに載せる答え方 */
  hint?: string
  /** addresses は答えと今の値を住所として引いた結果（工事場所の欄だけが読む） */
  parse?: (answer: string, addresses: AddressBook) => Parsed
  /**
   * 答えを元データの値と同じ変換に通す（注文者・工事名の個人名を印にする。記号は finalizeRows が付けるので、同じ人は同じ記号。
   * 氏名は同じ案件の区切りに合わせ、無ければ AI）。parse は送った値のままかの比較に使う。
   * 答えは必ずこの変換に通す（注文者・工事名なら必ず匿名化する）。計画がその項目に使う変換に値だけを整える部分（cleanAnswer）があれば先に当てる。
   * 計画の指示文は元データの列に向けたものなので使わない。
   * AI が使えなかったときの扱いも元データと同じ（個人名の判定ができなければ反映しない。transforms.ts の withoutAi）
   */
  transform?: TransformId
}

/** セルの値を、送った値（q.current）と比べられる形で。個人名は印どうしで比べる（記号は付け直されるので比べない） */
const storedOf = (cell: CellResult) => cell.stored ?? cell.value
/** 顧客に見せる値。個人名は氏名で出す */
export const namedOf = (cell: CellResult) => withNames(storedOf(cell), (name) => name)
const valueOf = (f: KojiFieldId) => (r: KojiRow) => namedOf(r.cells[f])
/** 文字列の答えは空白だけを整える（半角カナなどの表記は顧客の書いたまま） */
function text(f: KojiFieldId) {
  return (answer: string): Parsed => ({ ok: true, values: { [f]: collapseSpaces(answer) } })
}

function yearMonth(f: KojiFieldId) {
  return (answer: string): Parsed => {
    const ym = parseYearMonth(answer)
    return ym ? { ok: true, values: { [f]: formatYearMonth(ym) } } : { ok: false, message: "年月として読めません（例: 2024年4月）" }
  }
}

/**
 * 「東京都千代田区丸の内1-1」→ 都道府県＋市区町村。都道府県が無ければ場所名だけ。住所の分け方は変換と同じ（address.ts の lookupAddresses。
 * 都道府県は書いてあるときだけ読み、市区町村は住所データで決まるときだけ読む）。都道府県だけの答えは都道府県だけ。市区町村が読めなければ読み取れない
 */
function location(answer: string, addresses: AddressBook): Parsed {
  const a = addressKey(answer)
  if (!a) return { ok: true, values: {} }
  const { prefecture, city } = addresses.get(a) ?? {}
  if (!city && a !== prefecture)
    return { ok: false, message: prefecture ? "市区町村を読み取れません。市区町村まで書いてください（例: 東京都千代田区）" : "都道府県名から書いてください（例: 東京都千代田区）" }
  return { ok: true, values: { ...(prefecture ? { prefecture } : {}), ...(city ? { place: city } : {}) } }
}

/** 年月の値（YYYYMM）を「2024年4月」の形で */
function shownYearMonth(f: KojiFieldId) {
  return (r: KojiRow) => {
    const ym = parseYearMonth(r.cells[f].value)
    return ym ? `${ym.year}年${ym.month}月` : ""
  }
}

/** 年月の答え方（着工年月・完成年月のどちらを聞くときも添える。メールには1回だけ） */
const YEAR_MONTH_HINT = "着工・完成年月は「2024年4月」のようにお知らせください。"

export const ASK_COLUMNS: readonly AskColumn[] = [
  { label: "工事名", fields: ["workName"], show: valueOf("workName"), parse: text("workName"), transform: "ai.anonymizeWorkName" },
  { label: "注文者", fields: ["client"], show: valueOf("client"), parse: text("client"), transform: "ai.anonymizeClient" },
  { label: "着工年月", fields: ["startYm"], show: shownYearMonth("startYm"), hint: YEAR_MONTH_HINT, parse: yearMonth("startYm") },
  { label: "完成年月", fields: ["endYm"], show: shownYearMonth("endYm"), hint: YEAR_MONTH_HINT, parse: yearMonth("endYm") },
  {
    label: "工事場所",
    fields: ["prefecture", "place"],
    show: (r) => r.cells.prefecture.value + r.cells.place.value,
    hint: "工事場所は都道府県から市区町村までお知らせください（例: 東京都千代田区）。",
    parse: location,
  },
  {
    label: "配置技術者",
    fields: ["engineer"],
    show: valueOf("engineer"),
    hint: "配置技術者は、その工事に置いた主任技術者（または監理技術者）の氏名を、姓と名が分かるようにお知らせください。",
    parse: (answer) => ({ ok: true, values: { engineer: normalizePersonName(answer) } }),
    transform: "rule.personNameSpace",
  },
]

const PERSON_FIELDS = KOJI_KEIREKI.fields.filter((f) => f.valueType.type === "personName").map((f) => f.id)

export const columnOf = (field: KojiFieldId) => ASK_COLUMNS.find((c) => c.fields.includes(field))

/** 問い合わせられる項目: CSV の必須か書類に要る項目のうち、聞く項目（ASK_COLUMNS）にあるもの */
const ASKABLE = new Set(KOJI_KEIREKI.fields.filter((f) => (f.required || f.filing) && columnOf(f.id)).map((f) => f.id))

/** そのセルを顧客に聞く理由（聞けない項目・聞かなくてよいセルは undefined）。問い合わせを集めるのと表の「直す」（cellFix）で同じ決まり */
export function askReasonOf(field: string, cell: CellResult): InquiryReason | undefined {
  if (!ASKABLE.has(field as KojiFieldId)) return undefined
  // 値のあるエラーは顧客に聞いても CSV に載らないので聞かない（職員が直す。表の「直す」と問い合わせで1つのセルを二重に数えない）
  if (cell.status === "error" && cell.value !== "") return undefined
  return (Object.keys(REASONS) as InquiryReason[]).find((k) => REASONS[k].applies(cell))
}

/** CSV に載せる行（rows）と案件の設定から、顧客に聞くことを集める */
export function collectInquiries(rows: readonly KojiRow[], settings: InquirySettings): Inquiry[] {
  const cases = (Object.keys(CASE_TOPICS) as CaseTopic[]).filter((t) => CASE_TOPICS[t].applies(settings)).map((topic): Inquiry => ({ kind: "case", topic }))
  const cells = rows.flatMap((r) =>
    KOJI_KEIREKI.fields.flatMap((f): Inquiry[] => {
      const cell = r.cells[f.id]
      const reason = askReasonOf(f.id, cell)
      if (!reason) return []
      return [{ kind: "cell", rowKey: r.key, field: f.id, reason, current: storedOf(cell) }]
    }),
  )
  return [...cases, ...cells]
}

export type AnswerReport = {
  /** 反映する手直し（applied・confirmed・alsoChanged の値） */
  edits: [string, CellEdit][]
  /** 聞いた項目で、顧客の答えを反映したもの */
  applied: CellInquiry[]
  /** 今のデータに無い行の key */
  unknownKeys: string[]
  /** データに無い項目の答えが空のまま、または今の値のまま */
  unanswered: CellInquiry[]
  /** 推定に自信がない値のとおりという答え（顧客が確認した）。推定の印を外し、次からは聞かない */
  confirmed: CellInquiry[]
  /** 答えが今の値と同じ */
  alreadyApplied: CellInquiry[]
  /** 聞いていないのに顧客が書き換えた、同じ欄のもう一方の項目（都道府県など）。適用したうえで確認してもらう */
  alsoChanged: { rowKey: string; field: KojiFieldId; was: string; answer: string }[]
  /** 同じ欄のほかの項目を反映できなかったので、反映しなかった項目（工事場所は都道府県と場所名を必ず一緒に反映する） */
  heldBack: { rowKey: string; field: KojiFieldId; answer: string }[]
  /** 反映したが、変換（個人名の判定など）で要確認になった答え */
  needsCheck: { rowKey: string; field: KojiFieldId; answer: string; message: string }[]
  invalid: { inquiry: CellInquiry; answer: string; message: string }[]
}

export const emptyReport = (): AnswerReport => ({
  edits: [],
  applied: [],
  unknownKeys: [],
  unanswered: [],
  confirmed: [],
  alreadyApplied: [],
  alsoChanged: [],
  heldBack: [],
  needsCheck: [],
  invalid: [],
})

/** 顧客の回答を変換するときの設定（AI の結果は変換と同じ cache に溜める。前に失敗した答えは送り直す）。callAi が無ければ AI は呼ばない */
export type AnswerAi = { ctx: Omit<TransformContext, "addresses">; lookup: AddressLookup; cache: AiCache; callAi?: AiCaller; fields: Partial<Record<KojiFieldId, FieldPlan>> }

/** 答えを欄の変換に通す前に、計画がその項目の元データの列に使う変換の、値だけを整える部分を当てる（無ければそのまま） */
function cleanAnswer(column: AskColumn, fields: AnswerAi["fields"], answer: string) {
  const p = fields[column.fields[0]!]
  const clean = p?.kind === "column" || p?.kind === "columns" ? getTransform(p.transform).cleanAnswer : undefined
  return clean ? clean(answer) : answer
}

const ANSWER_SOURCE = "顧客の回答"

/** 1つの欄への答え（AI が読んだもの）。rowQs はその欄で聞いている項目、shown は欄の今の値 */
type ColumnAnswer = {
  rowKey: string
  row: KojiRow
  column: AskColumn
  rowQs: CellInquiry[]
  answer: string
  shown: string
  /** 聞いていない項目のうち、書き換えてよい項目（AI が訂正として送った項目）。無ければ欄のすべての項目 */
  only?: readonly KojiFieldId[]
}

/**
 * 欄ごとの答えを項目の値にして report に入れる。
 * 変換のある欄（注文者・工事名・配置技術者）の答えは、元データの値と同じくルール → AI の順に変換してから照合する。onInvalid は読めない答え
 */
async function answerColumns(report: AnswerReport, read: readonly ColumnAnswer[], rows: readonly KojiRow[], ai: AnswerAi, onInvalid: (c: ColumnAnswer, message: string) => void) {
  // 工事場所の欄（答えと今の値）は、変換と同じく住所として先に引いておく
  const addresses = await ai.lookup(read.flatMap((c) => (c.column.parse === location && c.answer ? [c.answer, c.shown] : [])))
  const columns = read.map((c) => ({ ...c, unchanged: !!c.answer && untouched(c.column.parse!, c.answer, c.shown, addresses) }))

  const ctx = { ...ai.ctx, addresses, knownNames: knownNameSplits(rows.flatMap((r) => PERSON_FIELDS.flatMap((f) => (splitByAi(r.cells[f]) ? [] : [r.cells[f].value])))) }
  const drafts: RowDraft<KojiFieldId>[] = columns.flatMap(({ rowKey, row, column, answer, unchanged }) => {
    if (!column.transform || !answer || unchanged) return []
    const cell = transformCell(column.transform, [cleanAnswer(column, ai.fields, answer)], ANSWER_SOURCE, ctx)
    return [{ key: rowKey, sheet: row.sheet, row: row.row, cells: { [column.fields[0]!]: cell } as Record<KojiFieldId, CellDraft> }]
  })
  if (ai.callAi) await fillAiCache(drafts, ai.cache, ai.callAi)
  const converted = new Map(resolveRows(drafts, ai.cache).flatMap((r) => Object.entries(r.cells).map(([f, c]) => [editKey(r.key, f), c] as const)))

  for (const c of columns) {
    const { rowKey, row, column, rowQs, answer, unchanged } = c
    if (!answer) {
      report.unanswered.push(...rowQs)
      continue
    }
    if (unchanged) {
      applyColumn(report, rowKey, rowQs.map((q) => kept(row, q)), [], answer)
      continue
    }
    const parsed = readColumn(column, answer, addresses, (f) => converted.get(editKey(rowKey, f)))
    if (!parsed.ok) {
      onInvalid(c, parsed.message)
      continue
    }
    /** 聞いていない項目の書き換え。読んだ値が今の値の頭だけ（住所を市区町村までに縮めて読んだ）なら書き換えではない */
    const unasked = column.fields.filter((f) => !c.only || c.only.includes(f)).flatMap((field) => {
      const value = parsed.values[field]
      const was = row.cells[field].value
      const note = parsed.notes?.[field]
      return !value || rowQs.some((q) => q.field === field) || was.startsWith(value) ? [] : [{ rowKey, field, was, answer: value, ...(note ? { note } : {}) }]
    })
    applyColumn(report, rowKey, rowQs.map((q) => answered(row, q, parsed.values[q.field] ?? "", answer, parsed.notes?.[q.field])), unasked, answer)
  }
}

/** AI が顧客の回答から読める項目（聞く項目のうち答えを読めるもの）。工事場所は都道府県・場所名のどちらで送っても1つの欄として読む */
export const ANSWER_FIELDS = ASK_COLUMNS.flatMap((c) => (c.parse ? c.fields : [])) as [KojiFieldId, ...KojiFieldId[]]

/**
 * AI が顧客の回答（メールの本文・届いたファイル）から読んだ1項目。answer は項目の値として読める形の顧客の答え
 * （年月は「2024年4月」、工事場所は都道府県から市区町村まで、氏名・会社名は書いたまま）。confirm は「今の値のとおり」という答え
 */
export type AiAnswer = { rowKey: string; field: KojiFieldId } & ({ answer: string; confirm?: undefined } | { confirm: true; answer?: undefined })

/** 聞いていない項目を顧客が訂正した値（手直しの message。変更案とセルで、問い合わせへの答えと見分ける） */
export const CORRECTION_MESSAGE = "顧客からの訂正（聞いていない項目）"

/**
 * AI が読んだ顧客の回答の結果。問い合わせへの答えは applied・confirmed など、聞いていない項目の訂正は alsoChanged、読めなかった訂正は uncorrected
 */
export type AiAnswerReport = AnswerReport & { uncorrected: { rowKey: string; field: KojiFieldId; answer: string; message: string }[] }

const startsWithPrefecture = (a: string) => PREFECTURES.some((p) => a.startsWith(p) || (p !== "北海道" && a.startsWith(p.slice(0, -1))))

/**
 * AI が読んだ顧客の回答を、決まった処理（answerColumns）で項目の値にする。照合は今の値と比べる（rows は今の全行）。
 * 欄ごとに、聞いている項目（askReasonOf）があればその問い合わせへの答えとして読み、無ければ送った項目だけの訂正として読む（今と違えば変える）。
 * 同じ欄の項目ごとの答え（工事場所の都道府県と場所名。confirm は今の値）は1つの答えにつなげる。同じ項目に違う答えが2つあれば読まない
 */
export async function readAiAnswers(items: readonly AiAnswer[], rows: readonly KojiRow[], ai: AnswerAi): Promise<AiAnswerReport> {
  const report: AiAnswerReport = { ...emptyReport(), uncorrected: [] }
  const now = new Map(rows.map((r) => [r.key, r]))
  const read: ColumnAnswer[] = []
  const unread = (c: Pick<ColumnAnswer, "rowKey" | "rowQs" | "answer">, fields: readonly KojiFieldId[], message: string) => {
    if (c.rowQs.length) for (const q of c.rowQs) report.invalid.push({ inquiry: q, answer: c.answer, message })
    else for (const field of fields) report.uncorrected.push({ rowKey: c.rowKey, field, answer: c.answer, message })
  }
  for (const [, list] of groupBy(items, (i) => `${i.rowKey}\t${columnOf(i.field)!.label}`)) {
    const { rowKey } = list[0]!
    const row = now.get(rowKey)
    if (!row) {
      report.unknownKeys.push(rowKey)
      continue
    }
    const column = columnOf(list[0]!.field)!
    const rowQs = column.fields.flatMap((field): CellInquiry[] => {
      const reason = askReasonOf(field, row.cells[field])
      return reason ? [{ kind: "cell", rowKey, field, reason, current: storedOf(row.cells[field]) }] : []
    })
    const shown = column.show(row)
    /** 項目ごとの答え（confirm はその項目の今の値） */
    const byField = new Map<KojiFieldId, Set<string>>()
    for (const i of list) {
      const text = i.confirm ? (column.fields.length === 1 ? shown : row.cells[i.field].value) : i.answer.trim()
      byField.set(i.field, new Set([...(byField.get(i.field) ?? []), text]))
    }
    const sent = column.fields.filter((f) => byField.has(f))
    const conflict = [...byField.values()].some((v) => v.size > 1)
    const parts = sent.map((f) => [...byField.get(f)!][0]!)
    // 2つの項目はつなげて1つの住所にする（場所名が都道府県から書いてあれば場所名だけ）。場所名だけで都道府県から書いていなければ、行の都道府県から読む
    const joined = parts.length ? parts.reduce((a, b) => (b.startsWith(a) ? b : a + b)) : ""
    const prefecture = row.cells.prefecture.value
    const answer = column.parse === location && sent.length === 1 && sent[0] === "place" && prefecture && !startsWithPrefecture(joined) ? prefecture + joined : joined
    const c: ColumnAnswer = { rowKey, row, column, rowQs, answer, shown, ...(rowQs.length ? {} : { only: sent }) }
    if (conflict) {
      unread({ ...c, answer: [...byField.values()].flatMap((v) => [...v]).join(" / ") }, sent, "同じ項目に違う答えが2つあります")
      continue
    }
    read.push(c)
  }
  await answerColumns(report, read, rows, ai, (c, message) => unread(c, c.only ?? c.column.fields, message))
  // 聞いていない項目の書き換え（訂正）は、問い合わせへの答えと見分けられるようにする
  const corrected = new Set(report.alsoChanged.map((x) => editKey(x.rowKey, x.field)))
  report.edits = report.edits.map(([key, edit]) => [key, corrected.has(key) ? { ...edit, message: [CORRECTION_MESSAGE, edit.message].filter(Boolean).join(" / ") } : edit])
  return report
}

/** AI が姓と名を区切った氏名（自信があってもなくても）。同じ案件の表記として、ほかの答えの区切りには使わない */
const splitByAi = (c: CellResult) => c.byAi === true

type EditNote = Pick<CellEdit, "status" | "message" | "guessed" | "byAi">

/** 欄の答えを項目の値にする。変換のある欄は変換の結果（AI の判断待ちが解けたもの）を使い、要確認ならその旨を notes に残す */
function readColumn(column: AskColumn, answer: string, addresses: AddressBook, convertedOf: (f: KojiFieldId) => CellResult | undefined): Parsed & { notes?: Partial<Record<KojiFieldId, EditNote>> } {
  if (!column.transform) return column.parse!(answer, addresses)
  const field = column.fields[0]!
  const cell = convertedOf(field)!
  if (cell.status === "error") return { ok: false, message: cell.message ?? `${fieldLabel(field)}を変換できません` }
  const note: EditNote | undefined =
    cell.status === "ai" || cell.status === "warning"
      ? { status: cell.status, ...(cell.message ? { message: cell.message } : {}), ...(cell.guessed ? { guessed: true } : {}), ...(cell.byAi ? { byAi: true } : {}) }
      : undefined
  return { ok: true, values: { [field]: cell.value }, ...(note ? { notes: { [field]: note } } : {}) }
}

/** 聞いた1項目の回答の扱い。invalid があると、同じ欄のほかの項目も反映しない */
type Outcome =
  | { kind: "edit"; q: CellInquiry; value: string; note?: EditNote }
  | { kind: "confirmed"; q: CellInquiry; value: string }
  | { kind: "unanswered" | "alreadyApplied"; q: CellInquiry }
  | { kind: "invalid"; q: CellInquiry; answer: string; message: string }

/** 今の値のままの答え */
function kept(row: KojiRow, q: CellInquiry): Outcome {
  const now = row.cells[q.field]
  if (q.reason === "missing") return { kind: "unanswered", q }
  return now.guessed ? { kind: "confirmed", q, value: q.current } : { kind: "alreadyApplied", q }
}

/** 書き換える答えの、聞いた1項目（value は答えを読んだ値。個人名は印のまま） */
function answered(row: KojiRow, q: CellInquiry, value: string, answer: string, note?: EditNote): Outcome {
  if (!value) return { kind: "invalid", q, answer, message: `${fieldLabel(q.field)}を読み取れません` }
  if (value === q.current) return kept(row, q)
  return { kind: "edit", q, value, ...(note ? { note } : {}) }
}

/** 聞いていない項目の書き換え（note は変換で要確認になったなどの印） */
type Unasked = AnswerReport["alsoChanged"][number] & { note?: EditNote }

/**
 * 1つの欄（工事場所なら都道府県と場所名）の回答をまとめて反映する。
 * どれか1項目でも読めないなら、同じ欄のほかの項目も反映せず heldBack で知らせる。
 */
function applyColumn(report: AnswerReport, rowKey: string, outcomes: Outcome[], unasked: readonly Unasked[], answer: string) {
  type Write = { field: KojiFieldId; edit: CellEdit }
  const writes: Write[] = [
    ...outcomes.flatMap((o): Write[] => {
      if (o.kind === "edit") return [{ field: o.q.field, edit: { value: o.value, by: "customer", ...o.note } }]
      if (o.kind === "confirmed") return [{ field: o.q.field, edit: { value: o.value, by: "confirmed" } }]
      return []
    }),
    ...unasked.map((c): Write => ({ field: c.field, edit: { value: c.answer, by: "customer", ...c.note } })),
  ]
  const rejected = outcomes.some((o) => o.kind === "invalid")
  for (const o of outcomes) {
    if (o.kind === "invalid") report.invalid.push({ inquiry: o.q, answer: o.answer, message: o.message })
    else if (rejected) continue
    else if (o.kind === "unanswered") report.unanswered.push(o.q)
    else if (o.kind === "alreadyApplied") report.alreadyApplied.push(o.q)
    else if (o.kind === "confirmed") report.confirmed.push(o.q)
    else if (o.kind === "edit") report.applied.push(o.q)
  }
  if (rejected) {
    report.heldBack.push(...writes.map((w) => ({ rowKey, field: w.field, answer: w.edit.value })))
    return
  }
  for (const { field, edit } of writes) {
    report.edits.push([editKey(rowKey, field), edit])
    if (edit.status === "warning") report.needsCheck.push({ rowKey, field, answer, message: edit.message ?? "要確認" })
  }
  report.alsoChanged.push(...unasked.map(({ note: _, ...c }) => c))
}

/** 答えが欄の今の値のまま（書式の違いは問わない） */
function untouched(parse: NonNullable<AskColumn["parse"]>, answer: string, shown: string, addresses: AddressBook) {
  if (!shown) return false
  if (answer === shown) return true
  const a = parse(answer, addresses)
  const b = parse(shown, addresses)
  return a.ok && b.ok && JSON.stringify(a.values) === JSON.stringify(b.values)
}
