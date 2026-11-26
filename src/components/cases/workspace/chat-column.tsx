import { lazy, Suspense, useRef } from "react"
import { Paperclip } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { CaseReport, type ReportChat, type ReportProps } from "@/components/cases/case-report"
import { useCase, useCaseActions, useCaseSession, useCaseView, useTable } from "@/components/cases/store/context"
import { derive } from "@/components/cases/store/derive"
import { AnswerImportPanel, FinalImportPanel } from "@/components/convert/final-import-panel"
import { FixSuggestionPanel } from "@/components/convert/fix-suggestion"
import { Button } from "@/components/ui/button"
import { reportPhase } from "@/lib/cases/phase"
import { ATTACH_ACCEPT } from "@/lib/cases/types"
import { TAX_LABELS } from "@/lib/convert/koji-selection"
import { useGyoshuSuggest, useProposalActions, useReportQuestions } from "./hooks"
import { useLocationTool } from "./tools"

/** チャット（Markdown の描画・AI SDK）は画面を開いたあとに読み込む */
const ChatPanel = lazy(() => import("@/components/chat/chat-panel").then((m) => ({ default: m.ChatPanel })))

/** 報告はチャットの欄の流れの最初（チャットが渡す chat で決まった質問を送れる） */
const report = (chat: ReportChat | null) => <ChatReport chat={chat} />

/**
 * チャットの欄の中身: チャット（変換の報告・直した Excel と顧客の回答の変更案・業種の AI の案を流れに出す）。
 * チャットが使えない（APIキーが無い）ときは、報告と📎と同じアップロードの入口をチャットの代わりに出す
 */
export function ChatColumn() {
  const { config } = useCaseSession()
  if (config.chatEnabled)
    return (
      <Suspense fallback={<div className="h-full" />}>
        <ChatPanel report={report} tail={<FixTail />} />
      </Suspense>
    )
  return <NoChat />
}

function NoChat() {
  const actions = useCaseActions()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="grid h-full content-start gap-3 overflow-auto p-4">
      {report(null)}
      <Button size="sm" className="w-fit" onClick={() => input.current?.click()} data-testid="chat-attach">
        <Paperclip /> アップロード
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ATTACH_ACCEPT}
        className="sr-only"
        data-testid="chat-file-input"
        onChange={(e) => {
          if (e.target.files?.length) void actions.attach([...e.target.files])
          e.target.value = ""
        }}
      />
    </div>
  )
}

/** 変換の報告（チャットの最初の返事）と、その下の直した Excel・顧客の回答の変更案 */
function ChatReport({ chat }: { chat: ReportChat | null }) {
  const actions = useCaseActions()
  const proposalActions = useProposalActions()
  const view = useTable((t) => t.view)
  const contents = useCase((s) => s.contents)
  const busy = useCase((s) => s.runtime.busy.rule)
  const finalResult = useCase((s) => s.runtime.finalResult)
  const { excel, answer } = useCase((s) => derive(s).panels)
  return (
    <>
      <ReportBody chat={chat} onAnswer={actions.answerReport} onRetry={actions.retry} />
      <FinalImportPanel result={finalResult} view={view} proposals={excel} changes={contents} actions={proposalActions} busy={busy} />
      <AnswerImportPanel view={view} proposals={answer} changes={contents} actions={proposalActions} busy={busy} />
    </>
  )
}

/** 変換の報告。進み具合・知らせ・聞き返し・去年との違い・工事場所の調査をストアから作る */
function ReportBody({ chat, onAnswer, onRetry }: { chat: ReportChat | null; onAnswer: (id: string, value: string) => void; onRetry: (what: "source" | "convert") => void }) {
  const { config, actions } = useCaseSession()
  const location = useLocationTool()
  const work = useCase(
    useShallow((s) => ({
      plan: s.work.plan,
      converted: s.work.converted,
      sourceFileId: s.work.sourceFileId,
      taxBy: s.work.taxBy,
      tax: s.work.tax,
      aiNotice: s.work.aiNotice,
    })),
  )
  const rt = useCase(
    useShallow((s) => ({
      loading: s.runtime.loading,
      sourceError: s.runtime.sourceError,
      planning: s.runtime.planDraft !== null,
      convertError: s.runtime.convertError,
      files: s.runtime.files,
      notes: s.runtime.notes,
      previousSheets: s.runtime.previous,
      previousUnsaved: s.runtime.previousUnsaved,
      closedMissing: s.runtime.closedMissing,
      unreadable: s.runtime.unreadable,
    })),
  )
  const { reconverting, hasTable, sources, unmarked, shown, output } = useTable(
    useShallow((t) => ({ reconverting: t.reconverting, hasTable: t.hasTable, sources: t.sources, unmarked: t.unmarked, shown: t.shown, output: t.output })),
  )
  const { noSheetSource, formatDiff } = useCaseView(useShallow((v) => ({ noSheetSource: v.noSheetSource, formatDiff: v.formatDiff })))
  const questions = useReportQuestions()
  const { previous } = config

  const sourceFile = rt.files.find((f) => f.id === work.sourceFileId)
  const phase = reportPhase({
    aiEnabled: config.chatEnabled,
    loading: rt.loading,
    sourceError: rt.sourceError?.message ?? null,
    planning: rt.planning,
    convertError: rt.convertError && rt.convertError.plan === work.plan ? rt.convertError.message : null,
    converting: !!work.plan && (!work.converted || reconverting),
    hasTable,
    noSheetSource,
    sourceName: work.sourceFileId ? (sourceFile?.name ?? "") : null,
  })
  const sourceSheets = work.plan?.plan.sheets ?? []
  const notes: ReportProps["notes"] = [
    ...(rt.previousUnsaved
      ? [{ text: "前の画面の変更を保存できませんでした（保存した時点の続きから開いています）。要る変更はもう一度してください。", tone: "warning" as const, testId: "previous-unsaved" }]
      : []),
    ...(rt.closedMissing
      ? [{ text: `中身の記録が無い変更案を ${rt.closedMissing} 件閉じました（未決の項目は却下にしました。要るものはチャットでもう一度頼んでください）。`, tone: "warning" as const, testId: "closed-missing" }]
      : []),
    ...(rt.unreadable
      ? [{ text: `中身の記録を読めない変更案が ${rt.unreadable} 件あります（記録は残しています。決められないので、続くときは管理者に知らせてください）。`, tone: "warning" as const, testId: "unreadable-proposals" }]
      : []),
    ...(work.plan?.notice ? [{ text: work.plan.notice, tone: "warning" as const }] : []),
    // 計画が税込・税抜を決めたら聞き返さない。決めたことと直し方だけ伝える
    ...(work.taxBy === "plan" && work.tax !== "unknown"
      ? [{ text: `Excel の見出し・注記から、金額は${TAX_LABELS[work.tax]}とみなしました。違えば「7割と金額」で直してください。`, testId: "plan-tax-note" }]
      : []),
    // 使うシートのメモは報告の最初の行（どのファイルのどのシートか）と重なるので出さない
    ...(work.plan?.plan.notes ?? []).filter((n) => !n.startsWith("使うシート「")).map((text) => ({ text })),
    ...(sources && sources.duplicates > 0
      ? [{ text: `シートをまたいで同じ行が ${sources.duplicates} 件あったので、1件にまとめました。`, tone: "warning" as const, testId: "duplicate-notice" }]
      : []),
    ...(unmarked > 0 ? [{ text: `業種の記号（○）が無い ${unmarked} 行は出しません。`, testId: "unmarked-notice" }] : []),
    ...(work.aiNotice ? [{ text: `AI で変換できなかった値があります（${work.aiNotice}）。黄色のセルを確かめてください。`, tone: "warning" as const, testId: "ai-notice" }] : []),
  ]
  const previousSheets = rt.previousSheets
  return (
    <CaseReport
      phase={phase}
      source={sourceFile ? `「${sourceFile.name}」${sourceSheets.length ? `のシート「${sourceSheets.join("」「")}」` : ""}` : null}
      planByAi={work.plan?.source === "ai"}
      notes={notes}
      counts={shown && output ? { rows: shown.length, csv: output.length } : null}
      questions={questions}
      onAnswer={onAnswer}
      previous={
        previous && hasTable && (formatDiff || (previousSheets && "error" in previousSheets) || !previous.source)
          ? {
              fiscalYear: previous.fiscalYear,
              lines: formatDiff?.lines ?? null,
              error: formatDiff ? null : previous.source ? ((previousSheets as { error: string } | null)?.error ?? null) : "去年の案件に表のファイルが無いので比べられません。",
              changed: !!formatDiff && !formatDiff.diff.same,
            }
          : null
      }
      location={location.sites > 0 ? { open: () => actions.showTab("location"), sites: location.sites } : null}
      onRetry={() => onRetry(phase.kind === "failed" && phase.retry === "source" ? "source" : "convert")}
      uploads={rt.notes}
      chat={chat}
    />
  )
}

/** チャットの流れの最後に出す「AI で案を出す」の結果と変更案 */
function FixTail() {
  const proposalActions = useProposalActions()
  const view = useTable((t) => t.view)
  const contents = useCase((s) => s.contents)
  const busy = useCase((s) => s.runtime.busy.rule)
  const fix = useCase((s) => derive(s).panels.fix)
  const suggest = useGyoshuSuggest()
  return <FixSuggestionPanel state={suggest.state} proposals={fix} changes={contents} view={view} actions={proposalActions} busy={busy} onRetry={suggest.canSuggest ? suggest.run : null} />
}
