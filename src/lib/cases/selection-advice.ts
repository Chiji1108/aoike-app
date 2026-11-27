import { isUsableBasis, type Basis, type SelectionMode } from "@/lib/convert/koji-selection"

/**
 * 載せる工事（7割ルール／全件）のおすすめ。「答える」の最初の聞き返しの選択肢に「（おすすめ）」を添える（決まった処理。判断の決まりはここ1か所）。
 * 聞くか・答えたか・去年から引き継ぐかは、作業の selectionBy だけで決める（lib/cases/selection.ts。ここでは決めない）。
 * - データがすでに顧客の側で絞られていそうなら全件: 載せうる行が少ない（FEW_ROWS 行以下）、
 *   または決算書の額を入れていて、表の合計がその FILTERED_RATIO 以下（7割で選んだあとの一覧が届いたように見える）
 * - ほかは7割ルール（初めての顧客の既定）
 * 顧客ルール（文章のルール）からは引かない（決まった形の項目が無い）
 */

/** これ以下の行数なら、顧客の側で絞った一覧と見て全件をすすめる */
export const FEW_ROWS = 12
/** 決算書の額に対する表の合計がこれ以下なら、顧客の側で絞った一覧と見る */
export const FILTERED_RATIO = 0.85

export type SelectionAdvice = { recommended: SelectionMode; reason: string }

export function selectionAdvice(input: {
  /** 載せうる行（除外していない行）の数 */
  rows: number
  /** 表の金額の合計（千円。載せうる行） */
  total: number
  basis: Basis
}): SelectionAdvice {
  if (input.rows <= FEW_ROWS) return { recommended: "all", reason: `工事が ${input.rows} 件と少なく、顧客の側で選んだ一覧に見えます` }
  const book = Object.values(input.basis).reduce((s, b) => s + (isUsableBasis(b?.total) ? b!.total! : 0), 0)
  if (book > 0 && input.total <= book * FILTERED_RATIO)
    return { recommended: "all", reason: `表の合計が決算書の額の ${Math.round((input.total / book) * 100)}% で、顧客の側で選んだ一覧に見えます` }
  return { recommended: "rule7", reason: "初めての顧客は7割ルールから始めます" }
}
