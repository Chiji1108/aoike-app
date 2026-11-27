import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import type { ReportQuestion } from "@/components/cases/question-item"
import { useCase, useCaseActions, useCaseSession, useCaseView, useTable } from "@/components/cases/store/context"
import { ASK_KINDS } from "@/components/cases/store/case-view"
import { derive } from "@/components/cases/store/derive"
import { reportUndoId } from "@/components/cases/store/actions/table"
import { INQUIRY_SUGGESTION, REVIEW_SUGGESTION } from "@/components/cases/store/actions/ui"
import type { ProposalActions } from "@/components/chat/proposal-card"
import type { Suggestion } from "@/components/chat/chat-panel"
import { awaitsAnswer } from "@/lib/cases/todo"
import { lastSelectionUndo } from "@/lib/cases/undo"
import { carryoverReady } from "@/lib/chat/carryover"
import type { OpenProposal, Proposal, ProposalOrigin } from "@/lib/chat/proposals"
import { REVIEW_PROMPT } from "@/lib/chat/review"
import { SELECTION_LABELS, TAX_LABELS } from "@/lib/convert/koji-selection"
import { aiAnswerPrompt } from "@/lib/inquiry/inquiry"
import { INQUIRY_TEXT_PROMPT } from "@/lib/inquiry/text"
import { useGyoshuTool } from "./tools"

/**
 * 変更案のカード・欄に渡す操作（承認・却下・答え・取り消し）。取り消せるか・答えを待つかは今の状態から読み、変わったときだけ作り直す
 * （カードはこれが変われば描き直る）
 */
export function useProposalActions(): Omit<ProposalActions, "canSend"> {
  const actions = useCaseActions()
  const undoStates = useCase((s) => derive(s).undoStates)
  const todo = useCaseView((v) => v.todo)
  return useMemo(
    () => ({
      decide: (id, indices, d) => void actions.decideProposal(id, indices, d),
      answer: actions.answerProposal,
      undo: (id) => actions.undoWithNotice(id),
      undoState: (id) => undoStates.get(id) ?? null,
      awaiting: (id) => awaitsAnswer(todo, id),
    }),
    [actions, undoStates, todo],
  )
}

/** 業種の AI の案を頼めるか（AI が使える・頼んでいる最中でない・一覧の外の行に前の案の未決が無い）と、頼めない理由・頼む */
export function useGyoshuSuggest() {
  const { config } = useCaseSession()
  const gyoshu = useGyoshuTool()
  const shown = useTable((t) => t.shown)
  // 一覧の行の未決は一覧の「案」に出ていて、頼むのは案の無い行だけなので重ならない
  const outsidePending = useCaseView((v) => v.todo.answer.some((a) => a.kind === "proposal" && a.origin === "fix"))
  const canSuggest = config.chatEnabled && gyoshu.running === null && !outsidePending
  const blocked = canSuggest ? undefined : !config.chatEnabled ? "AI を使えません" : gyoshu.running !== null ? "AI が案を考えています" : "前の AI の案がチャットに残っています（承認か却下してください）"
  const run = (keys: readonly string[]) => {
    if (shown && canSuggest) void gyoshu.run(shown, keys)
  }
  return { canSuggest, blocked, run, state: gyoshu }
}

/**
 * 報告の聞き返し（載せる工事・税込か税抜か・計画の AI の聞き返し）。答えたか・取り消せるかは lib/cases/todo.ts と取り消しの記録から読む
 * （答えるのは「答える」の段だけ。チャットの報告は数の1行）
 */
export function useReportQuestions(): ReportQuestion[] {
  const actions = useCaseActions()
  const { questionStates, askRows, askEffects, planAsks, advice } = useCaseView(
    useShallow((v) => ({ questionStates: v.questionStates, askRows: v.askRows, askEffects: v.askEffects, planAsks: v.planAsks, advice: v.selectionAdvice })),
  )
  const tax = useCase((s) => s.work.tax)
  const selection = useCase((s) => s.work.selection)
  const selectionUndo = useCase(useShallow((s) => lastSelectionUndo(s.work.undo)))
  const reportAnswers = useCase((s) => s.work.reportAnswers)
  const undoStates = useCase((s) => derive(s).undoStates)
  return useMemo(() => {
    /** 答えを取り消せる聞き返しの、取り消し（答えの記録が戻せるときだけ） */
    /** key は税なら tax、計画の聞き返しなら鍵（askKey） */
    const undoAnswer = (key: string) => (undoStates.get(reportUndoId(key))?.can ? () => actions.undoWithNotice(reportUndoId(key), "答え") : null)
    return questionStates.map(({ id, answered }): ReportQuestion => {
      if (id === "selection") {
        // 載せる工事（lib/cases/selection-advice.ts の案を「おすすめ」に添える）。答えたあとも表の見出しのチェック・7割と金額で変えられる
        const recommended = advice.recommended
        return {
          id,
          text: "載せる工事は？",
          detail: [advice.reason, "業種を決める・直すの行の数が変わるので、先に決めます。あとから表の「載せる」の見出しのチェック・ダウンロードの段の「7割と金額」でも変えられます"].filter(Boolean).join("。"),
          options: (["rule7", "all"] as const).map((v) => ({ value: v, label: `${SELECTION_LABELS[v]}${v === recommended ? "（おすすめ）" : ""}` })),
          answered: answered ? SELECTION_LABELS[selection] : null,
          // 取り消せるのは選び方だけを変えた記録（答える・表の見出し・7割と金額）。変更案で決めたときは出どころだけ書く（lib/cases/undo.ts の lastSelectionUndo）
          ...(answered && selectionUndo?.kind === "proposal" ? { detail: "チャットの変更案で決めました（取り消すときはチャットの変更案から）" } : {}),
          undo: answered && selectionUndo?.kind === "undo" && undoStates.get(selectionUndo.proposalId)?.can ? () => actions.undoWithNotice(selectionUndo.proposalId, "載せる工事") : null,
        }
      }
      if (id === "tax") {
        const label = !answered ? null : tax !== "unknown" ? TAX_LABELS[tax] : "分からない（顧客に聞く）"
        return {
          id,
          text: "Excel の金額は税込ですか、税抜ですか？",
          options: [
            { value: "included", label: "税込" },
            { value: "excluded", label: "税抜" },
            { value: "ask", label: "分からない（顧客に聞く）" },
          ],
          answered: label,
          undo: answered ? undoAnswer(id) : null,
        }
      }
      // 計画の AI の聞き返し。答えは計画の行の除外（決まった処理）にし、取り消せる
      const i = askRows.findIndex((r) => r.id === id)
      const r = askRows[i]!
      const kind = ASK_KINDS[planAsks[i]!.kind]
      const label = answered ? (kind.options.find((o) => o.value === reportAnswers[r.key])?.label ?? null) : null
      const { wording, facts, prompt } = askEffects[i]!
      return {
        id,
        text: planAsks[i]!.text,
        // 答えたあとは数だけ（答えで載せ方が変わったあとの件数の説明は事実と合わない）
        detail: [label === null ? wording.detail : wording.count, facts].filter(Boolean).join("。"),
        // 押すとどう変わるか（載せる件数）を答えに添える（変わらないときは detail に理由を書き、ボタンには付けない）
        options: kind.options.map((o) => ({ value: o.value, label: wording.label(o.value, o.label) })),
        answered: label,
        // まだ答えていない聞き返しだけ、チャットの AI に説明を頼める（決まった質問を職員の発言として送る）
        prompt: label === null ? prompt : undefined,
        view: () => actions.viewAsk(r.id),
        undo: label !== null ? undoAnswer(r.key) : null,
      }
    })
  }, [actions, questionStates, askRows, askEffects, planAsks, advice, tax, selection, selectionUndo, reportAnswers, undoStates])
}

/** チャットの案内（返ってきた Excel を AI で読む・問い合わせのメールの下書き・振り返り）。押すと決まった指示を送る */
export function useChatSuggestions(): readonly Suggestion[] {
  const answerHints = useCase((s) => s.runtime.hints.answer)
  const inquiryHint = useCase((s) => s.runtime.hints.inquiry === "shown")
  const reviewHint = useCase((s) => s.runtime.hints.review)
  const subjectSet = useCase((s) => s.work.inquiryText.subject !== null)
  const { pendingReview, pendingInquiryText } = useCase(useShallow((s) => ({ pendingReview: derive(s).pendingReview, pendingInquiryText: derive(s).pendingInquiryText })))
  const { left, active } = useCaseView(useShallow((v) => ({ left: v.todo.inquiry.left, active: v.todo.inquiry.active })))
  return useMemo(
    () => [
      ...(left > 0
        ? answerHints.map((h) => ({
            id: h.fileId,
            fileName: h.name,
            text: `返ってきた Excel「${h.name}」に、色付きの欄の外（印の無いセル・別の列・メモ・別のシート）の記入や読めなかった記入があり、まだ答えの無い問い合わせが ${left} 件あります。`,
            label: "AI で読む",
            prompt: aiAnswerPrompt(h.name),
          }))
        : []),
      ...(inquiryHint && active > 0 && !pendingInquiryText && !subjectSet
        ? [
            {
              id: INQUIRY_SUGGESTION,
              text: `問い合わせ ${active} 件の、顧客へのメールの件名と前置きを AI が下書きできます。承認した文をメールに使います。`,
              label: "AI でメールの下書きを作る",
              prompt: INQUIRY_TEXT_PROMPT,
              // 会話にもう送っていれば出さない（開き直しても）
              once: true as const,
            },
          ]
        : []),
      ...(reviewHint && !pendingReview
        ? [
            {
              id: REVIEW_SUGGESTION,
              text: "案件を完了にしました。今年の指示・手直し・聞き返しの答えを AI が振り返り、来年のための顧客ルールの案（毎年の決まり）を出せます。今年だけの事情は分けて伝え、ルールには足しません。承認した項目だけ顧客ルールに足します。",
              label: "振り返って顧客ルールの案を出す",
              prompt: REVIEW_PROMPT,
              // サーバーは保存した作業の変更案の状態から振り返る。会話に一度送ったら案内しない
              needsSaved: true as const,
              once: true as const,
            },
          ]
        : []),
    ],
    [answerHints, left, inquiryHint, active, pendingInquiryText, subjectSet, reviewHint, pendingReview],
  )
}

/**
 * 「去年のやり方で直す」（同じ顧客の前の年度の案件があるときだけ）。ready は去年との違いを文脈に入れられるようになったか（去年の Excel を読み終えた）、
 * names・headers は送るときにその時点の状態から作る
 */
export function useCarryover() {
  const session = useCaseSession()
  const { previous } = session.config
  const ready = useCase((s) => {
    if (!previous) return false
    const { previousSide, formatDiff } = session.view(s)
    const { grid, plan } = session.table(s)
    const sheets = s.runtime.previous
    return carryoverReady({
      previousSource: !!previous.source,
      currentSource: !!s.work.sourceFileId,
      previousSheets: sheets === null ? "loading" : "error" in sheets ? "error" : previousSide ? "loaded" : "noSheet",
      // 今年の元と計画はあるのに比べるシートが無いときは、違いを作れないので待たない
      formatDiff: formatDiff !== null ? true : s.runtime.source && plan && !grid ? "unavailable" : false,
    })
  })
  return useMemo(
    () => (previous ? { fiscalYear: previous.fiscalYear, ready, names: session.carryoverNames, headers: session.carryoverHeaders } : null),
    [previous, ready, session],
  )
}

/** 変更案の出どころの名前（「答える」の段） */
const PROPOSAL_ORIGIN: Record<ProposalOrigin["kind"], string> = { chat: "チャットの変更案", excel: "Excel で直した分", answer: "顧客の回答", location: "工事場所", fix: "業種の AI の案" }
const ANSWER_LABELS = { yes: "はい", no: "いいえ" } as const
/** 「答える」の段で答える変更案の印（報告の聞き返しの id と分ける） */
export const PROPOSAL_QUESTION = "proposal:"

/** 「答える」の段の1つ。go はチャットへ移る操作（「AI に聞く」・チャットで承認するなど。無ければ出さない） */
export type AnswerQuestion = { question: ReportQuestion; go: { label: string; disabled?: boolean; run: () => void } | null }

/**
 * 「答える」の段に出すもの: 報告の聞き返し（その場で答える。「AI に聞く」は決まった質問をチャットに送ってチャットへ移る）と、
 * チャットのもの（「答える」に数える承認待ちの変更案・AI の聞き返し・一覧の外の業種の AI の案と、答えて閉じたもの）。
 * 変更案の付いた「はい・いいえ」の聞き返しだけその場で答え、ほかはチャットのその変更案へ移る
 */
export function useAnswerQuestions(): { questions: AnswerQuestion[]; chatAsks: AnswerQuestion[] } {
  const { actions, config } = useCaseSession()
  const chatCanSend = useCase((s) => s.ui.chatCanSend)
  const todo = useCaseView((v) => v.todo)
  const proposals = useCase((s) => s.work.proposals)
  const undoStates = useCase((s) => derive(s).undoStates)
  const report = useReportQuestions()
  return useMemo(() => {
    const questions: AnswerQuestion[] = report.map((q) => ({
      question: { ...q, prompt: undefined },
      go:
        q.prompt && config.chatEnabled
          ? { label: "AI に聞く", disabled: !chatCanSend, run: () => actions.askChat(q.prompt!) }
          : null,
    }))
    const answered = (p: Proposal, text: string, a: "yes" | "no"): AnswerQuestion => ({
      question: { id: `${PROPOSAL_QUESTION}${p.id}`, text, options: [], answered: ANSWER_LABELS[a], undo: undoStates.get(p.id)?.can ? () => actions.undoWithNotice(p.id) : null },
      go: null,
    })
    const ask = (p: OpenProposal, waiting: number): AnswerQuestion => {
      const id = `${PROPOSAL_QUESTION}${p.id}`
      const go = (label: string) => ({ label, run: () => actions.goChat({ target: `[data-proposal="${p.id}"]` }) })
      const q = p.question
      if (q && q.answer === null)
        return p.count > 0
          ? { question: { id, text: q.text, detail: `${PROPOSAL_ORIGIN[p.origin.kind]}（${p.count} 件）は、答えてからチャットで承認します`, options: [{ value: "no", label: "いいえ" }, { value: "yes", label: "はい" }], answered: null }, go: go("チャットで見る") }
          : { question: { id, text: q.text, detail: "答えると AI が続けます", options: [], answered: null }, go: go("チャットで答える") }
      return { question: { id, text: `${PROPOSAL_ORIGIN[p.origin.kind]}の承認待ち ${waiting} 件`, detail: "中身をチャットで確かめて、承認か却下します", options: [], answered: null }, go: go("チャットで確かめる") }
    }
    const one = (p: Proposal): AnswerQuestion[] => {
      const item = todo.answer.find((a) => a.kind === "proposal" && a.proposalId === p.id)
      if (item?.kind === "proposal" && p.state === "open") return [ask(p, item.waiting)]
      return p.state === "closed" && p.origin.kind !== "fix" && p.origin.kind !== "location" && p.question?.answer ? [answered(p, p.question.text, p.question.answer)] : []
    }
    const chatAsks = [...proposals.filter((p) => p.origin.kind !== "fix").flatMap(one), ...proposals.filter((p) => p.origin.kind === "fix").flatMap(one)]
    return { questions, chatAsks }
  }, [actions, config.chatEnabled, chatCanSend, todo, proposals, undoStates, report])
}
