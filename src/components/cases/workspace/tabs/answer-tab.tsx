import { ArrowRight, CircleCheck, Info } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { QuestionItem } from "@/components/cases/case-report"
import { useCaseActions, useCaseView } from "@/components/cases/store/context"
import { Button } from "@/components/ui/button"
import { currentStep, VIEW_LABELS } from "@/lib/cases/steps"
import { PROPOSAL_QUESTION, useAnswerQuestions, type AnswerQuestion } from "../hooks"

/**
 * 「答える」の段: 載せる工事（最初に聞く）・税込か税抜か・計画の聞き返しはその場で答え、チャットの変更案・AI の聞き返しは中身をチャットで確かめる（そこへ移る）。
 * 答えたものは下にまとめ、取り消せる。去年で載せる工事が決まっていれば聞かずに知らせだけ出す
 */
export function AnswerTab() {
  const actions = useCaseActions()
  const { todo, advice } = useCaseView(useShallow((v) => ({ todo: v.todo, advice: v.selectionAdvice })))
  const { questions, chatAsks } = useAnswerQuestions()
  const all = [...questions, ...chatAsks]
  const open = all.filter((q) => q.question.answered === null)
  const done = all.filter((q) => q.question.answered !== null)
  const onAnswer = (id: string, value: string) => {
    if (!id.startsWith(PROPOSAL_QUESTION)) return actions.answerReport(id, value)
    if (value === "yes" || value === "no") actions.answerProposal(id.slice(PROPOSAL_QUESTION.length), value)
  }
  const next = currentStep(todo)
  return (
    <div className="grid max-w-3xl gap-4 text-sm" data-testid="answer-step" data-left={todo.answer.length}>
      {!advice.ask && (
        <p className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-muted-foreground" data-testid="selection-carried">
          <Info className="size-4 shrink-0" />
          載せる工事は{advice.note}。表の見出しのチェック・7割と金額でいつでも変えられます
        </p>
      )}
      {open.length > 0 ? (
        <List title={`答える（あと ${todo.answer.length}）`} items={open} onAnswer={onAnswer} testId="answer-open" />
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900" data-testid="answer-none">
          <CircleCheck className="size-4 text-emerald-600" />
          答えることはありません
          {next !== "answer" && (
            <Button size="xs" variant="outline" className="ml-auto bg-background" onClick={() => actions.goStep(next)} data-testid="answer-next">
              次は{VIEW_LABELS[next]} <ArrowRight />
            </Button>
          )}
        </div>
      )}
      {done.length > 0 && <List title="答えたもの" items={done} onAnswer={onAnswer} testId="answer-done" muted />}
    </div>
  )
}

function List({ title, items, onAnswer, testId, muted = false }: { title: string; items: AnswerQuestion[]; onAnswer: (id: string, value: string) => void; testId: string; muted?: boolean }) {
  return (
    <section className="grid gap-1.5" aria-label={title} data-testid={testId}>
      <h3 className={muted ? "text-xs font-medium text-muted-foreground" : "font-medium"}>{title}</h3>
      {items.map(({ question, go }) => (
        <QuestionItem key={question.id} question={question} onAnswer={onAnswer} ask={go && question.answered === null ? { ...go, disabled: go.disabled ?? false } : null} />
      ))}
    </section>
  )
}
