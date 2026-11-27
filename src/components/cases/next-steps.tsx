import { FIX_KINDS, FIX_LABELS, type FixCounts } from "@/components/convert/status"
import type { StepId } from "@/lib/cases/steps"
import type { CaseTodo } from "@/lib/cases/todo"

/**
 * 段の残りの言葉（段の並びは workspace/step-bar.tsx）。次にやること: 答える（報告の聞き返し・承認待ちの変更案）→ 業種を決める（7割で載りうる行の業種。決めるたびに載せる行が入れ替わるので直すより先）
 * → 直す（職員が直すセルのある載せる行）→ 問い合わせ（顧客に聞くこと）→ ダウンロード。
 * 数は表の絞り込み・問い合わせのタブ・ダウンロードの前の確認と同じもの（lib/cases/todo.ts が1回だけ数えたものを読むだけ）。済んだ段も押せる（縛らない）
 */

export type { StepId }

type Remaining = { id: Exclude<StepId, "export">; text: string }

/** ダウンロードの前に残っていること（無ければ空）。次にやること・ダウンロードのツールチップ・ダウンロードの前の確認で同じ言葉にする */
export function remainingSteps(s: CaseTodo): Remaining[] {
  const out: Remaining[] = []
  if (s.answer.length > 0) out.push({ id: "answer", text: `答える ${s.answer.length}` })
  if (s.gyoshu.rows.length > 0) out.push({ id: "gyoshu", text: `業種を決める ${s.gyoshu.rows.length}行` })
  if (s.fix.rows > 0) out.push({ id: "fix", text: `直す ${s.fix.rows}行（${fixBreakdown(s.fix)}）` })
  if (s.inquiry.state !== "done") out.push({ id: "inquiry", text: `問い合わせ ${s.inquiry.active}件${s.inquiry.state === "waiting" ? "（送った・返事待ち）" : ""}` })
  return out
}

/** 直す行の理由ごとの数（例:「必須が空 3・AI の推定 2」） */
export const fixBreakdown = (f: FixCounts) =>
  FIX_KINDS.filter((k) => f.byKind[k] > 0)
    .map((k) => `${FIX_LABELS[k]} ${f.byKind[k]}`)
    .join("・")

/** ダウンロードのボタンのツールチップ（右上の点の意味） */
export const exportTitle = (s: CaseTodo) => {
  const left = remainingSteps(s)
  return left.length ? `残り: ${left.map((r) => r.text).join(" → ")}` : "残りはありません"
}

