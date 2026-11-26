import { Check, ChevronRight, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FIX_KINDS, FIX_LABELS, fixActionText, type FixCounts } from "@/components/convert/status"
import type { CaseTodo } from "@/lib/cases/todo"
import { cn } from "@/lib/utils"

/**
 * 次にやること: 答える（報告の聞き返し・承認待ちの変更案）→ 業種を決める（7割で載りうる行の業種。決めるたびに載せる行が入れ替わるので直すより先）
 * → 直す（職員が直すセルのある載せる行）→ 問い合わせ（顧客に聞くこと）→ ダウンロード。
 * 数は表の絞り込み・問い合わせのタブ・ダウンロードの前の確認と同じもの（lib/cases/todo.ts が1回だけ数えたものを読むだけ）。済んだ段は済みと出して押せなくし、
 * 押すとそこへ移る
 */

export type StepId = "answer" | "gyoshu" | "fix" | "inquiry" | "export"

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

const STEP_LABEL = { answer: "答える", gyoshu: "業種を決める", fix: "直す", inquiry: "問い合わせ" } as const

export function NextSteps({ steps, onGo, exportDisabled, className }: { steps: CaseTodo; onGo: (id: StepId) => void; exportDisabled?: boolean; className?: string }) {
  const counts = { answer: steps.answer.length, gyoshu: steps.gyoshu.rows.length, fix: steps.fix.rows, inquiry: steps.inquiry.active }
  const done = { answer: counts.answer === 0, gyoshu: counts.gyoshu === 0, fix: steps.fix.rows === 0, inquiry: steps.inquiry.state === "done" }
  const order = ["answer", "gyoshu", "fix", "inquiry"] as const
  const current = order.find((id) => !done[id]) ?? "export"
  const left = remainingSteps(steps).length > 0
  const waiting = steps.inquiry.state === "waiting"
  return (
    <nav aria-label="次にやること" className={cn("flex min-w-0 flex-wrap items-center gap-1 text-xs", className)} data-testid="next-steps" data-current={current}>
      {order.map((id) => (
        <span key={id} className="flex items-center gap-1">
          {done[id] ? (
            // 済んだ段は押せない（移っても空の表・欄になるだけ）
            <span className="inline-flex h-6 items-center gap-1 px-2 text-muted-foreground" data-testid={`next-step-${id}`} data-done="1">
              <Check className="size-3 text-emerald-600" />
              {STEP_LABEL[id]}
              <span className="sr-only">済み</span>
            </span>
          ) : (
            <Button
              size="xs"
              variant={id === current ? "outline" : "ghost"}
              className={cn(id === current ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100" : "text-foreground")}
              aria-current={id === current ? "step" : undefined}
              title={stepTitle(id, steps)}
              onClick={() => onGo(id)}
              data-testid={`next-step-${id}`}
              data-done="0"
              data-state={id === "inquiry" ? steps.inquiry.state : undefined}
            >
              {STEP_LABEL[id]}
              {id === "inquiry" && waiting && <span>返事待ち</span>}
              <span className="num font-medium">
                {counts[id]}
                {id === "fix" || id === "gyoshu" ? "行" : id === "inquiry" ? "件" : ""}
              </span>
            </Button>
          )}
          <ChevronRight className="size-3 text-muted-foreground/60" aria-hidden />
        </span>
      ))}
      <Button
        size="sm"
        className="relative"
        onClick={() => onGo("export")}
        disabled={exportDisabled}
        title={exportTitle(steps)}
        aria-current={current === "export" ? "step" : undefined}
        data-testid="export-button"
        data-left={left ? "1" : "0"}
      >
        <Download />
        ダウンロード（{steps.exportRows}件）
        {/* 残りがあることは右上の点で（意味はツールチップ。残っていてもダウンロードできる） */}
        {left && <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-amber-500 ring-2 ring-background" data-testid="export-badge" aria-hidden />}
      </Button>
    </nav>
  )
}

function stepTitle(id: Exclude<StepId, "export">, s: CaseTodo) {
  if (id === "answer") return "チャットの聞き返し・変更案に答える"
  if (id === "gyoshu") return "業種のタブで、7割で載りうる行の業種をまとめて決める（決めるたびに載せる行が入れ替わるので、直すより先に）"
  if (id === "fix") return [`表で直す行（${fixBreakdown(s.fix)}）`, ...s.fixActions.map(fixActionText)].join("\n")
  return s.inquiry.state === "waiting" ? "顧客に送りました。返ってきた Excel をチャットの📎でアップロードすると取り込みます" : "問い合わせのタブで、顧客に聞くことを確かめて送る"
}
