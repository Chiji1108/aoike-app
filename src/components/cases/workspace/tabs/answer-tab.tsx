import { QuestionItem } from "@/components/cases/question-item"
import { useCaseActions, useCaseView } from "@/components/cases/store/context"
import { PROPOSAL_QUESTION, useAnswerQuestions, type AnswerQuestion } from "../hooks"
import { StepDone } from "../step-done"

/**
 * 「答える」の段: 載せる工事（最初に聞く）・税込か税抜か・計画の聞き返しはその場で答え、チャットの変更案・AI の聞き返しは中身をチャットで確かめる（そこへ移る）。
 * 答えたものは下にまとめ、取り消せる。載せる工事はどの案件でも最初に1回聞く（去年の選び方はおすすめに出すだけ）。聞き返しに答える場所はここだけ（チャットの報告は数の1行）
 */
export function AnswerTab() {
  const actions = useCaseActions()
  const todo = useCaseView((v) => v.todo)
  const { questions, chatAsks } = useAnswerQuestions()
  const all = [...questions, ...chatAsks]
  const open = all.filter((q) => q.question.answered === null)
  const done = all.filter((q) => q.question.answered !== null)
  const onAnswer = (id: string, value: string) => {
    if (!id.startsWith(PROPOSAL_QUESTION)) return actions.answerReport(id, value)
    if (value === "yes" || value === "no") actions.answerProposal(id.slice(PROPOSAL_QUESTION.length), value)
  }
  return (
    <div className="grid max-w-3xl gap-4 text-sm" data-testid="answer-step" data-left={todo.answer.length}>
      {open.length > 0 && <List title={`答える（あと ${todo.answer.length}）`} items={open} onAnswer={onAnswer} testId="answer-open" />}
      {open.length === 0 && done.length === 0 && (
        <p className="text-muted-foreground" data-testid="answer-none">
          答えることはありません
        </p>
      )}
      {done.length > 0 && <List title="答えたもの" items={done} onAnswer={onAnswer} testId="answer-done" muted />}
      <StepDone step="answer" />
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
