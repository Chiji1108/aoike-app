import { z } from "zod"
import type { CaseTable } from "../cases/view"
import { editKey, type CellEdit } from "../convert/convert"
import { withNames } from "../convert/persons"
import { nfkc, removeSpaces } from "../convert/text"
import { tryParseJson } from "../json"
import type { KojiFieldId } from "../spec/koji-keireki"

/**
 * 個人名の確かめ。外に送る・案にする文字列（ルールの案・問い合わせのメールの下書き・工事場所の調査）に、
 * 表の人（印の人・配置技術者）と保存した作業から分かっている個人名が入っていないかを見る（AI に見せるメモからは伏せる）
 */

/** 置き換える個人名の最短の長さ（1文字の姓などは地名・言葉と区別できないので置き換えない） */
const MIN_NAME_LENGTH = 2
/** これより長い値は氏名とみなさない（備考などが個人名の項目に入っていたとき） */
const MAX_NAME_LENGTH = 40
/** これ以下の長さの名前（姓だけなど）は、前後が文字でないときだけ当てる（「山田町」「青池工務店」を壊さない） */
const SHORT_NAME_LENGTH = 2

/** 個人名の項目に入る、氏名でない値（名前にすると関係ない文まで当たる） */
const NOT_NAMES = new Set(["なし", "無し", "未定", "不明", "未記入", "該当なし", "同上", "空欄"])

/** 個人名の項目（値そのものが氏名） */
export const PERSON_FIELDS: ReadonlySet<KojiFieldId> = new Set(["engineer"])

/** 値の中の個人名（印の人）と、個人名の項目（配置技術者）の値を集める。names に足していく */
function collectNames(names: Set<string>, value: string, isPersonField = false) {
  withNames(value, (name) => {
    names.add(name)
    return name
  })
  const plain = withNames(value, (name) => name).trim()
  if (isPersonField && plain && plain.length <= MAX_NAME_LENGTH && !NOT_NAMES.has(removeSpaces(nfkc(plain)))) names.add(plain)
}

/** 手直しの key（行の key:項目）が個人名の項目か */
const isPersonEditKey = (key: string) => [...PERSON_FIELDS].some((f) => key.endsWith(editKey("", f)))

type Edits = Iterable<readonly [string, CellEdit]>

/** 表（変換した行と手直し）の人: 印の人と配置技術者。氏名でない値（「なし」「同上」など）・長すぎる値は名前にしない */
export function namesOfTable(table: { rows: readonly { cells: Partial<Record<KojiFieldId, { value: string }>> }[]; edits: Edits }): Set<string> {
  const names = new Set<string>()
  for (const r of table.rows) for (const [f, c] of Object.entries(r.cells)) if (c) collectNames(names, c.value, PERSON_FIELDS.has(f as KojiFieldId))
  for (const [key, e] of table.edits) collectNames(names, e.value, isPersonEditKey(key))
  return names
}

/** 案件の作業（手直し・置換）と AI の結果（匿名化の persons、氏名の区切り）から、分かっている個人名を集める */
export function namesOfCase(work: { edits: Edits; replacements: Partial<Record<KojiFieldId, Readonly<Record<string, CellEdit>>>> }, aiCache: readonly (readonly [string, unknown])[]) {
  const names = new Set<string>()
  for (const [key, edit] of work.edits) collectNames(names, edit.value, isPersonEditKey(key))
  for (const [field, table] of Object.entries(work.replacements) as [KojiFieldId, Readonly<Record<string, CellEdit>>][]) {
    for (const [from, to] of Object.entries(table ?? {})) {
      collectNames(names, from, PERSON_FIELDS.has(field))
      collectNames(names, to.value, PERSON_FIELDS.has(field))
    }
  }
  for (const [key, result] of aiCache) {
    const persons = z.object({ persons: z.array(z.string()) }).safeParse(result)
    if (persons.success) for (const p of persons.data.persons) collectNames(names, p, true)
    const task = z.tuple([z.literal("personName"), z.string(), z.string()]).safeParse(tryParseJson(key))
    const value = z.object({ value: z.string() }).safeParse(result)
    if (task.success) {
      collectNames(names, task.data[2], true)
      if (value.success) collectNames(names, value.data.value, true)
    }
  }
  return names
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const NAME_MARK = "〔個人名〕"

/**
 * 文字列を NFKC にした文字列と、その文字ごとの元の位置（[始まり, 終わり)）。半角カナの濁点・半濁点は前の文字と一緒に直す（ﾀﾞ → ダ）。
 * 空白は消さない（全角の空白は半角になる。空白の数は名前の正規表現の側で問わない）
 */
function normalizedWithOffsets(code: string) {
  let text = ""
  const from: number[] = []
  const to: number[] = []
  const chars = [...code]
  let at = 0
  for (let i = 0; i < chars.length; i++) {
    let unit = chars[i]!
    while (i + 1 < chars.length && /[ﾞﾟ]/.test(chars[i + 1]!)) unit += chars[++i]!
    for (const c of unit.normalize("NFKC")) {
      text += c
      for (let k = 0; k < c.length; k++) {
        from.push(at)
        to.push(at + unit.length)
      }
    }
    at += unit.length
  }
  return { text, from, to }
}

const LETTER_RE = /[\p{L}\p{N}]/u

/**
 * 個人名を〔個人名〕にする関数を作る（名前の正規表現は1回だけ作る）。氏名ごと（空白の有無・数、全角半角の違いも同じ名前）に
 * 置き換え、姓・名だけでは置き換えない。2文字以下の名前（姓だけの値など）は、前後が文字でないときだけ置き換える（「山田町」「青池工務店」を壊さない）
 */
export function nameScrubber(names: Iterable<string>): (text: string) => string {
  const variants = new Set<string>()
  for (const raw of names) {
    const name = nfkc(raw).replace(/\s+/g, " ")
    for (const v of [name, removeSpaces(name)]) if ([...v].length >= MIN_NAME_LENGTH) variants.add(v)
  }
  if (!variants.size) return (text) => text
  const re = new RegExp(
    [...variants]
      .sort((a, b) => b.length - a.length)
      .map((v) => v.split(" ").map(escapeRe).join("\\s+"))
      .join("|"),
    "g",
  )
  return (input) => {
    const { text, from, to } = normalizedWithOffsets(input)
    const hits: [number, number][] = []
    for (const m of text.matchAll(re)) {
      const start = m.index
      const end = start + m[0].length
      const short = [...removeSpaces(m[0])].length <= SHORT_NAME_LENGTH
      if (short && (LETTER_RE.test(text[start - 1] ?? "") || LETTER_RE.test(text[end] ?? ""))) continue
      hits.push([from[start]!, to[end - 1]!])
    }
    let out = ""
    let last = 0
    for (const [a, b] of hits) {
      out += input.slice(last, a) + NAME_MARK
      last = b
    }
    return out + input.slice(last)
  }
}

/**
 * 文字列に個人名（names）が含まれるかを確かめる関数。空白で区切った氏名（「田中 花子」）も見落とさないよう、空白を除いた文字列でも確かめる
 */
export function personalNameTest(names: Iterable<string>): (text: string) => boolean {
  const scrub = nameScrubber(names)
  const has = (t: string) => scrub(t) !== t
  return (text) => has(text) || has(removeSpaces(nfkc(text)))
}

/** 表の記号（〔Ａ〕〔未掲載１〕）と伏せた印（〔個人名〕）。ほかの〔…〕（〔仮称〕など）は個人名としない */
export const MARK_RE = new RegExp(`〔(?:[Ａ-Ｚ]+|未掲載[０-９0-9]+)〕|${NAME_MARK}`)

/**
 * ルールの案・メールの下書きに入れない個人名: 表の印の人・配置技術者・置換と手直しの人（保存の前のものも）と、names（サーバーが保存した作業から集めたもの）。
 * hide は AI に見せる文字列の名前を〔個人名〕にし、has は文に個人名か表の記号があるか（空白で区切った氏名も見る）
 */
export function nameGuard(table: Pick<CaseTable, "rows" | "edits" | "replacements">, names: Iterable<string> = []) {
  const all = namesOfTable(table)
  for (const n of namesOfCase({ edits: table.edits, replacements: table.replacements }, [])) all.add(n)
  for (const n of names) all.add(n)
  const scrub = nameScrubber(all)
  const test = personalNameTest(all)
  return { hide: (s: string) => scrub(withNames(s, () => NAME_MARK)), has: (text: string) => MARK_RE.test(text) || test(text) }
}
export type NameGuard = ReturnType<typeof nameGuard>
