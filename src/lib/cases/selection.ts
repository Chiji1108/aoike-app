import { z } from "zod"
import type { SelectionMode } from "../convert/koji-selection"
import { selectionSchema } from "../schemas"

/**
 * 載せる工事の選び方（selection）と、それを誰が決めたか（selectionBy）。staff は職員が決めた値（「答える」の答え・表の「載せる」の見出しのチェック・
 * 7割と金額の「載せる工事」・チャットの変更案の承認）、previous は去年の案件で決めた選び方を引き継いだ値、null はまだ誰も決めていない（既定の7割ルールのまま）。
 * 2つはいつも setSelection で一緒に書き（片方だけ書かない）、取り消しも一緒に戻す。「答える」の載せる工事の聞き返しと、翌年に引き継ぐかは selectionBy だけを読む
 */
export type SelectionBy = "staff" | "previous"
export type SelectionSource = { selection: SelectionMode; selectionBy: SelectionBy | null }

export const selectionBySchema = z.enum(["staff", "previous"]).nullable()

/** 選び方と出どころを一緒に書く（ここ以外で selection・selectionBy を書かない） */
export function setSelection<T extends { selection: SelectionMode; selectionBy?: SelectionBy | null }>(t: T, selection: SelectionMode, by: SelectionBy | null): T {
  return t.selection === selection && t.selectionBy === by ? t : { ...t, selection, selectionBy: by }
}

/** 取り消しの記録に残す選び方と出どころ（今の形だけ。前の版の値だけの記録は読まない〔移行 drizzle/csv/0011 で空にした〕） */
export const selectionSettingSchema = z.object({ selection: selectionSchema, selectionBy: selectionBySchema })

/**
 * 翌年に引き継ぐ去年の選び方: 去年に変換して出し、選び方を誰かが決めていたときだけ（既定値のままなら null で、今年は「答える」で聞く）
 */
export const previousSelection = (saved: SelectionSource & { converted: boolean } | undefined): SelectionMode | null =>
  saved?.converted && saved.selectionBy !== null ? saved.selection : null

/**
 * 去年の選び方を引き継ぐ（1か所）。新しい作業（保存した作業が無い）にだけ、去年に決めた選び方を当てて previous にする。
 * 保存した作業は、まだ誰も決めていなくても変えない（開いただけで選び方が黙って変わらないように。「答える」で聞き、去年の値をおすすめにする）
 */
export function carrySelection<T extends SelectionSource>(work: T, previous: SelectionMode | null | undefined, isNew: boolean): T {
  return isNew && work.selectionBy === null && previous ? setSelection(work, previous, "previous") : work
}

/**
 * 「答える」の載せる工事の聞き返し（selectionBy だけで決める）: null は聞く（答えていない）、staff は答えた、previous は聞かない（去年から引き継いだ知らせだけ）
 */
export function selectionQuestion(selectionBy: SelectionBy | null): { answered: boolean } | null {
  return selectionBy === "previous" ? null : { answered: selectionBy === "staff" }
}
