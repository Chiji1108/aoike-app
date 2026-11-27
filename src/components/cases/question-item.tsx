import { CircleHelp, MessageSquareText, TableProperties, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { cn } from "@/lib/utils"

export type ReportQuestion = {
  id: string
  text: string
  /** 対象の行の数など（例:「該当 12 行」） */
  detail?: string
  options: { value: string; label: string }[]
  /** 答えたなら、その選択肢の表示 */
  answered: string | null
  /** 対象の行を表で見る（答えではない。押しても閉じない） */
  view?: () => void
  /** 答えを取り消して聞き直す（取り消せるときだけ） */
  undo?: (() => void) | null
  /** 「AI に聞く」でチャットに送る決まった質問（説明を頼める聞き返しだけ） */
  prompt?: string
}

/**
 * 職員に聞くこと1つ（「答える」の段）。答えを選ぶと答えを出して閉じ、取り消せる。
 * 「表で見る」「AI に聞く」は答えではない（押しても閉じない）。ask はチャットに決まった質問を送る・チャットのその変更案へ移る
 */
export function QuestionItem({
  question: q,
  onAnswer,
  ask,
}: {
  question: ReportQuestion
  onAnswer: (id: string, value: string) => void
  ask: { label: string; disabled: boolean; run: () => void } | null
}) {
  return (
    <Item
      variant="outline"
      size="sm"
      className={cn("items-start", q.answered === null ? "border-amber-300 bg-amber-50" : "bg-muted/30")}
      data-testid="report-question"
      data-question={q.id}
      data-answered={q.answered ?? undefined}
      data-pending={q.answered === null ? "1" : undefined}
    >
      <ItemMedia variant="icon">
        <CircleHelp className="text-amber-600" />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-2">
        <ItemTitle className="whitespace-pre-wrap">{q.text}</ItemTitle>
        {q.detail && <ItemDescription className="line-clamp-none" data-testid="report-question-detail">{q.detail}</ItemDescription>}
        <div className="flex flex-wrap items-center gap-1.5">
          {q.answered !== null ? (
            <>
              <span className="text-sm font-medium" data-testid="report-question-answer">
                {q.answered}
              </span>
              {q.undo && (
                <Button size="xs" variant="ghost" onClick={q.undo} data-testid="report-question-undo">
                  <Undo2 /> 取り消す
                </Button>
              )}
            </>
          ) : (
            q.options.map((o) => (
              <Button key={o.value} size="sm" variant="outline" className="bg-background" onClick={() => onAnswer(q.id, o.value)} data-testid="report-answer" data-value={o.value}>
                {o.label}
              </Button>
            ))
          )}
          {q.view && (
            <Button size="sm" variant="ghost" onClick={q.view} data-testid="report-question-view">
              <TableProperties /> 表で見る
            </Button>
          )}
          {ask && (
            <Button size="sm" variant="ghost" disabled={ask.disabled} onClick={ask.run} data-testid="report-question-ask">
              <MessageSquareText /> {ask.label}
            </Button>
          )}
        </div>
      </ItemContent>
    </Item>
  )
}
