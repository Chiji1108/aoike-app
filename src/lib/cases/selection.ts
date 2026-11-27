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

/**
 * 保存した作業の出どころを読む（1か所）。この項目より前の保存は選び方をいつも書いていた（既定の7割ルールも）ので、値と控えで分ける:
 * - 全件（既定値ではない。前の形の alreadyApplied が true も読むときに全件にそろえてある）なら職員が決めた値
 * - ダウンロードの控え（CSV・最後の Excel）があれば、その選び方で出したので職員が決めた値（開き直して聞き返さない）
 * - ほかの7割ルール（alreadyApplied が false も既定値）は既定値のままと見なして聞く（はっきり7割を選んでいた案件も一度聞くことになるが、聞き漏らすよりよい）
 * selection は前の形を読み替えたあとの値、downloaded はその案件にダウンロードの控えがあるか（hasDownloadCopies）
 */
export function savedSelectionBy(saved: { selectionBy?: SelectionBy | null; selection: SelectionMode; downloaded: boolean }): SelectionBy | null {
  if (saved.selectionBy !== undefined) return saved.selectionBy
  return saved.selection === "all" || saved.downloaded ? "staff" : null
}

/** 案件にダウンロードの控え（CSV・最後の Excel）があるか（前の形の保存の載せる工事を読む） */
export const hasDownloadCopies = (files: readonly { kind: string }[]) => files.some((f) => f.kind === "csv" || f.kind === "final_sheet")

/**
 * 取り消しの記録に残す選び方。前の版の記録は値だけなので、前の保存と同じ決まり（savedSelectionBy）で出どころを読む
 * （取り消すときに、前の保存から読んだ今の値と合う）
 */
export const selectionSettingSchema = z.union([
  z.object({ selection: selectionSchema, selectionBy: selectionBySchema }),
  selectionSchema.transform((selection): SelectionSource => ({ selection, selectionBy: savedSelectionBy({ selection, downloaded: false }) })),
])

/**
 * 翌年に引き継ぐ去年の選び方: 去年に変換して出し、選び方を誰かが決めていたときだけ（既定値のままなら null で、今年は「答える」で聞く）。
 * 出どころは保存の形から savedSelectionBy で読む（downloaded は去年の案件にダウンロードの控えがあるか）
 */
export const previousSelection = (
  saved: { converted: boolean; selection: SelectionMode; selectionBy?: SelectionBy | null } | undefined,
  downloaded: boolean,
): SelectionMode | null => (saved?.converted && savedSelectionBy({ ...saved, downloaded }) !== null ? saved.selection : null)

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
