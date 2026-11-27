import { z } from "zod"
import type { SelectionMode } from "../convert/koji-selection"
import { selectionSchema } from "../schemas"

/**
 * 載せる工事の選び方（selection）と、「答える」の載せる工事に答えたか（selectionAnswered）。どの案件でも1回だけ聞き、去年からは引き継がない
 * （去年の選び方は selection-advice.ts のおすすめに出すだけ）。答えたことになるのは、選び方を職員が決めたとき（「答える」の答え・表の「載せる」の見出しの
 * チェック・7割と金額の「載せる工事」・チャットの変更案の承認）。2つはいつも setSelection で一緒に書き、取り消しも一緒に戻す
 */
export type SelectionSource = { selection: SelectionMode; selectionAnswered: boolean }

/** 選び方と答えたかを一緒に書く（ここ以外で selection・selectionAnswered を書かない） */
export function setSelection<T extends { selection: SelectionMode; selectionAnswered?: boolean }>(t: T, selection: SelectionMode, answered: boolean): T {
  return t.selection === selection && t.selectionAnswered === answered ? t : { ...t, selection, selectionAnswered: answered }
}

/**
 * もう答えた同じ選び方か（何もしなくてよい）。選び方が同じでも、まだ答えていなければ選ぶと答えたことになる。
 * 7割と金額・表の見出しの切り替え（changeSelection）とチャットの set_selection が同じ判定を使う
 */
export const selectionSettled = (now: { selection: SelectionMode; selectionAnswered?: boolean }, mode: SelectionMode) => now.selection === mode && now.selectionAnswered === true

/** 取り消しの記録に残す選び方と答えたか（今の形だけ。前の版の値だけの記録は読まない〔移行 drizzle/csv/0011 で空にした〕） */
export const selectionSettingSchema = z.object({ selection: selectionSchema, selectionAnswered: z.boolean() })
