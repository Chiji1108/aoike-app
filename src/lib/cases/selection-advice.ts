import { SELECTION_LABELS, type GyoshuSummary, type SelectionMode } from "@/lib/convert/koji-selection"

/**
 * 載せる工事（7割ルール／全件）のおすすめ。「答える」の最初の聞き返しの選択肢に「（おすすめ）」を添える（決まった処理。判断の決まりはここ1か所）。
 * 聞くか・答えたかは作業の selectionAnswered だけで決める（lib/cases/selection.ts。どの案件でも1回聞き、ここでは決めない）。
 * - 去年の案件の選び方があれば、それ（理由は「去年は全件でした」。引き継がずにおすすめに出すだけ）
 * - データがすでに顧客の側で絞られていそうなら全件: 載せうる行が少ない（1行以上 FEW_ROWS 行以下。0 行は数で決めない）、
 *   または決算書の額を入れた業種で、表の合計がその決算書の額の FILTERED_RATIO 以下（7割で選んだあとの一覧が届いたように見える）。
 *   比べるのは決算書の額を入れた業種の行だけで、金額は7割の計算の税（rule7Tax）にそろえた業種ごとの集計（summarizeKoji。7割の表と同じ数）
 * - ほかは7割ルール（理由は、去年の案件が無ければ初めての顧客、あれば去年は表を出していなかった）
 * 顧客ルール（文章のルール）からは引かない（決まった形の項目が無い）
 */

/** これ以下の行数なら、顧客の側で絞った一覧と見て全件をすすめる */
export const FEW_ROWS = 12
/** 決算書の額に対する表の合計がこれ以下なら、顧客の側で絞った一覧と見る */
export const FILTERED_RATIO = 0.85

export type SelectionAdvice = { recommended: SelectionMode; reason: string }

export function selectionAdvice(input: {
  /** 去年の案件（無ければ null）と、去年に変換して出した選び方（変換していなければ null） */
  previous: { selection: SelectionMode | null } | null
  /** 載せうる行（除外していない行）の数 */
  rows: number
  /** 業種ごとの集計（summarizeKoji。total は載せうる行の合計、basis.total は基準額、fromBook.total は決算書の額を入れたか。どれも rule7Tax の千円） */
  summary: readonly Pick<GyoshuSummary, "total" | "basis" | "fromBook">[]
}): SelectionAdvice {
  const last = input.previous?.selection
  if (last) return { recommended: last, reason: `去年は${SELECTION_LABELS[last]}でした` }
  if (input.rows > 0 && input.rows <= FEW_ROWS) return { recommended: "all", reason: `工事が ${input.rows} 件と少なく、顧客の側で選んだ一覧に見えます` }
  const entered = input.summary.filter((g) => g.fromBook.total)
  const book = entered.reduce((s, g) => s + g.basis.total, 0)
  const table = entered.reduce((s, g) => s + g.total, 0)
  if (book > 0 && table <= book * FILTERED_RATIO)
    return { recommended: "all", reason: `表の合計が決算書の額の ${Math.round((table / book) * 100)}% で、顧客の側で選んだ一覧に見えます` }
  return { recommended: "rule7", reason: input.previous ? "去年は表を出していなかったので、7割ルールから始めます" : "初めての顧客は7割ルールから始めます" }
}
