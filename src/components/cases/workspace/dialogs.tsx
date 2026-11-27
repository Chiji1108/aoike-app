import { useRouter } from "@tanstack/react-router"
import { useShallow } from "zustand/react/shallow"
import type { ReportQuestion } from "@/components/cases/case-report"
import { DeleteDialog } from "@/components/cases/delete-dialog"
import { useCase, useCaseActions, useCaseSession, useCaseView, useTable } from "@/components/cases/store/context"
import { derive } from "@/components/cases/store/derive"
import { PENDING_TARGET } from "@/components/cases/store/actions/ui"
import { ExportDialog, type ExportQuestion } from "@/components/convert/export-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { OpenProposal, Proposal, ProposalOrigin } from "@/lib/chat/proposals"
import { DownloadsDialog } from "./downloads-dialog"
import { chatTarget } from "./focus-effects"
import { useReportQuestions } from "./hooks"

/** ダウンロードの前の確認で答える変更案の印（報告の聞き返しの id と分ける） */
const EXPORT_PROPOSAL = "proposal:"
/** 変更案の出どころの名前（ダウンロードの前の確認の「答える」） */
const PROPOSAL_ORIGIN: Record<ProposalOrigin["kind"], string> = { chat: "チャットの変更案", excel: "Excel で直した分", answer: "顧客の回答", location: "工事場所", fix: "業種の AI の案" }
const ANSWER_LABELS = { yes: "はい", no: "いいえ" } as const

/** 案件の画面のダイアログ（削除・ダウンロードの履歴・ダウンロードの前の確認・聞き返しの答えの確かめ・変換の元の確かめ）。開くかは ui.dialogs */
export function CaseDialogs({ customer, fiscalYear }: { customer: { id: string; name: string }; fiscalYear: number }) {
  const router = useRouter()
  const { config, actions } = useCaseSession()
  const deleteOpen = useCase((s) => s.ui.dialogs.delete)
  const hasOutput = useTable((t) => !!t.output)
  const exportOpen = useCase((s) => s.ui.dialogs.export.open)
  return (
    <>
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={actions.setDeleteOpen}
        target={{ caseId: config.caseId }}
        title={`${fiscalYear}年度の案件`}
        customerName={customer.name}
        onDeleted={() => router.navigate({ to: "/csv/customers/$customerId", params: { customerId: customer.id } })}
      />
      {hasOutput && <CaseExportDialog />}
      {/* ダウンロードの前の確認を開いている間は、確かめをその中に置いて上に重ねる（Escape・外の押下は上の確かめだけが受ける） */}
      {!(hasOutput && exportOpen) && <AskConfirmDialog />}
      <SourceConfirmDialog />
      <DownloadsDialog />
    </>
  )
}

/**
 * ダウンロードの前の確認。報告の聞き返しはその場で答える（「表で見る」「AI に聞く」は確認を閉じて移る。AI に聞くはチャットのその聞き返しへ）。
 * チャットのものは「答える」に数えるもの（承認待ちの変更案・AI の聞き返し・一覧の外の業種の AI の案）と、この確認で答えて閉じたもの
 */
function CaseExportDialog() {
  const session = useCaseSession()
  const { actions, config, store } = session
  const open = useCase((s) => s.ui.dialogs.export.open)
  const chatCanSend = useCase((s) => s.ui.chatCanSend)
  const output = useTable((t) => t.output)
  const { summary, todo } = useCaseView(useShallow((v) => ({ summary: v.summary, todo: v.todo })))
  const { basis, rule7Tax, tax, proposals } = useCase(useShallow((s) => ({ basis: s.work.basis, rule7Tax: s.work.rule7Tax, tax: s.work.tax, proposals: s.work.proposals })))
  const undoStates = useCase((s) => derive(s).undoStates)
  const questions = useReportQuestions()
  if (!output) return null

  /** ダウンロードの前の確認を閉じてから移る */
  const fromExport = (run: () => void) => () => {
    actions.closeExport()
    run()
  }
  const exportQuestions: ExportQuestion[] = questions.map((q: ReportQuestion) => ({
    question: { ...q, view: q.view && fromExport(q.view), prompt: undefined },
    // 報告と同じ条件（チャットが使え、返事の途中でない）で押せる
    go:
      q.prompt && config.chatEnabled
        ? { label: "AI に聞く", disabled: !chatCanSend, run: () => actions.exportToChat({ target: `[data-testid="case-report"] [data-question="${q.id}"]`, button: '[data-testid="report-question-ask"]:not([disabled])' }) }
        : null,
  }))
  /** この確認で答えて閉じたもの（いいえで全部を却下）。チャットのカードと同じく、取り消せる記録があれば取り消せる */
  const exportAnswered = (p: Proposal, text: string, a: "yes" | "no"): ExportQuestion => ({
    question: { id: `${EXPORT_PROPOSAL}${p.id}`, text, options: [], answered: ANSWER_LABELS[a], undo: undoStates.get(p.id)?.can ? () => actions.undoWithNotice(p.id) : null },
    go: null,
  })
  /** 答えるものの変更案（waiting は todo.ts が数えた承認待ちの項目の数） */
  const exportChatAsk = (p: OpenProposal, waiting: number): ExportQuestion => {
    const id = `${EXPORT_PROPOSAL}${p.id}`
    const go = (label: string) => ({ label, run: () => actions.exportToChat({ target: `[data-proposal="${p.id}"]` }) })
    const q = p.question
    // 変更案の付いた聞き返しはここで答える（はいで承認できるようになり、いいえで全部を却下）。変更案の無い聞き返しは答えを AI に送るのでチャットで
    if (q && q.answer === null)
      return p.count > 0
        ? { question: { id, text: q.text, detail: `${PROPOSAL_ORIGIN[p.origin.kind]}（${p.count} 件）は、答えてからチャットで承認します`, options: [{ value: "no", label: "いいえ" }, { value: "yes", label: "はい" }], answered: null }, go: go("チャットで見る") }
        : { question: { id, text: q.text, detail: "答えると AI が続けます", options: [], answered: null }, go: go("チャットで答える") }
    return { question: { id, text: `${PROPOSAL_ORIGIN[p.origin.kind]}の承認待ち ${waiting} 件`, detail: "中身をチャットで確かめて、承認か却下します", options: [], answered: null }, go: go("チャットで確かめる") }
  }
  /** 変更案のうち、答えるもの（todo.ts が数えたもの）と、この確認で答えて閉じたもの */
  const exportProposal = (p: Proposal): ExportQuestion[] => {
    const item = todo.answer.find((a) => a.kind === "proposal" && a.proposalId === p.id)
    if (item?.kind === "proposal" && p.state === "open") return [exportChatAsk(p, item.waiting)]
    return p.state === "closed" && p.origin.kind !== "fix" && p.origin.kind !== "location" && p.question?.answer ? [exportAnswered(p, p.question.text, p.question.answer)] : []
  }
  const chatAsks: ExportQuestion[] = [
    ...proposals.filter((p) => p.origin.kind !== "fix").flatMap(exportProposal),
    // 業種の AI の案は、一覧の外の行に未決があるものだけ（一覧の行は「業種を決める」に数える）
    ...proposals.filter((p) => p.origin.kind === "fix").flatMap(exportProposal),
  ]

  return (
    <ExportDialog
      open={open}
      onOpenChange={(o) => (o ? actions.openExport() : actions.closeExport())}
      output={output}
      summary={summary}
      basis={basis}
      rule7Tax={rule7Tax}
      onBasisChange={actions.setBasis}
      onExcel={() => void actions.downloadFinalExcel()}
      onCsv={actions.downloadCsv}
      steps={todo}
      onGo={(id) => (id === "answer" ? actions.exportToChat(PENDING_TARGET) : fromExport(() => actions.goStep(id))())}
      // 閉じたあとにフォーカスを合わせる先（チャットへ移るとき。確認は閉じると開いたボタンにフォーカスを戻すので、その代わりに）
      finalFocus={() => {
        const to = store.getState().ui.dialogs.export.returnTo
        return (to && chatTarget(to)?.button) || true
      }}
      onFixAction={(action, keys) => {
        actions.closeExport()
        actions.runFixAction(action, keys)
      }}
      questions={exportQuestions}
      amountsUnsettled={tax === "unknown"}
      chatAsks={chatAsks}
      onAnswer={(id, value) => {
        if (!id.startsWith(EXPORT_PROPOSAL)) return actions.answerReport(id, value)
        if (value === "yes" || value === "no") actions.answerProposal(id.slice(EXPORT_PROPOSAL.length), value)
      }}
    >
      {open && <AskConfirmDialog />}
    </ExportDialog>
  )
}

/** 載せる件数が大きく減る答えを押したときの確かめ（押す前に何件減るか・7割に届くかを出す） */
function AskConfirmDialog() {
  const actions = useCaseActions()
  const confirm = useCase((s) => s.ui.dialogs.askConfirm)
  return (
    <AlertDialog open={!!confirm} onOpenChange={(open) => !open && actions.closeAskConfirm(false)}>
      <AlertDialogContent data-testid="ask-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription className="grid gap-1">
            {confirm?.lines.map((l) => (
              <span key={l}>{l}</span>
            ))}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="ask-confirm-cancel">やめる</AlertDialogCancel>
          <AlertDialogAction onClick={() => actions.closeAskConfirm(true)} data-testid="ask-confirm-ok">
            {confirm?.option}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** 「変換の元にしますか」（今の変換の結果と手直しが消える。付けるだけにもできる） */
function SourceConfirmDialog() {
  const actions = useCaseActions()
  // 一度に複数付けたら、先頭から1つずつ聞く
  const pending = useCase((s) => s.ui.dialogs.pendingSources[0] ?? null)
  return (
    <AlertDialog open={!!pending} onOpenChange={(open) => !open && pending && actions.confirmSource(pending.id, false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>変換の元を「{pending?.name}」にしますか</AlertDialogTitle>
          <AlertDialogDescription>今の変換の結果と手直しは消えます（設定は残ります）。参考に付けるだけなら「付けるだけ」。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="source-keep">付けるだけ</AlertDialogCancel>
          <AlertDialogAction onClick={() => pending && actions.confirmSource(pending.id, true)} data-testid="source-replace">
            変換の元にする
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
