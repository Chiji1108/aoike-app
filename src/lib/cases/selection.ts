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

/** 決めた選び方か（既定値で埋めた値ではない）。翌年に引き継ぐのも、「答える」で答えたことにするのもこれだけ */
export const selectionDecided = (s: { selectionBy?: SelectionBy | null }) => (s.selectionBy ?? null) !== null

/**
 * 保存した作業の出どころを読む。この項目より前の保存は、選び方を明示して保存していれば（selection か前の形の alreadyApplied がある）決めた値と見なし、
 * どちらも無ければ（既定値だけ）まだ誰も決めていない
 */
export function savedSelectionBy(selectionBy: SelectionBy | null | undefined, explicit: boolean): SelectionBy | null {
  return selectionBy !== undefined ? selectionBy : explicit ? "staff" : null
}

/**
 * 取り消しの記録に残す選び方。前の版の記録は値だけで、選び方を変えるのは職員の操作か承認だけだったので、職員が決めた値として読む
 * （前の保存の選び方も savedSelectionBy で職員が決めた値になるので、取り消すときに今の値と合う）
 */
export const selectionSettingSchema = z.union([
  z.object({ selection: selectionSchema, selectionBy: selectionBySchema }),
  selectionSchema.transform((selection): SelectionSource => ({ selection, selectionBy: "staff" })),
])

/**
 * 翌年に引き継ぐ去年の選び方: 去年に変換して出し、選び方を誰かが決めていたときだけ（既定値のままなら null で、今年は「答える」で聞く）
 */
export const previousSelection = (saved: { converted: boolean; selection: SelectionMode; selectionBy: SelectionBy | null } | undefined): SelectionMode | null =>
  saved?.converted && selectionDecided(saved) ? saved.selection : null
