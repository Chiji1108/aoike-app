import type { RowResult } from "../convert/convert"
import type { KojiFieldId } from "../spec/koji-keireki"

type Row = RowResult<KojiFieldId>

/** 「AI に聞く」の質問に並べる元の行番号の数（多いときは残りの数だけ書く。AI は計画の聞き返しの列と値から全行を読める） */
const PROMPT_ROWS = 20

/**
 * 計画の聞き返しの「AI に聞く」で、チャットに職員の発言として送る決まった質問。どの聞き返しか取り違えないよう、聞き返しの文（チャットの指示の
 * 「この案件」にも同じ文がある）と、対象の行の元の Excel の行番号（get_table の source と同じ番号）を入れる。
 * 数はカードと同じ表の行で数え（rows は表の行）、行番号は場所として重ねずに並べる。対象の行が無ければ作らない
 */
export function askPrompt(text: string, rows: readonly Pick<Row, "sheet" | "row">[]): string | undefined {
  if (!rows.length) return undefined
  const bySheet = new Map<string, Set<number>>()
  for (const r of rows) bySheet.set(r.sheet, (bySheet.get(r.sheet) ?? new Set()).add(r.row))
  let left = PROMPT_ROWS
  let rest = 0
  const parts: string[] = []
  for (const [sheet, set] of bySheet) {
    const xs = [...set].sort((a, b) => a - b)
    const shown = xs.slice(0, left)
    left -= shown.length
    rest += xs.length - shown.length
    if (shown.length) parts.push(`「${sheet}」${shown.map((x) => x + 1).join("・")}行目`)
  }
  const where = [...parts, ...(rest ? [`ほか ${rest} 行`] : [])].join("、")
  return `計画の聞き返し「${text}」は、どういうことですか？ 対象は表の ${rows.length} 行（元の Excel の${where}）です。中身を見て、判断に要ることを教えてください。`
}
