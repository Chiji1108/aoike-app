import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { Link, createFileRoute, notFound, useRouter } from "@tanstack/react-router"
import { Ellipsis, FileText, FileUp, Loader2, PanelRightClose, Paperclip, Trash2, TriangleAlert, X } from "lucide-react"
import { toast } from "sonner"
import { AppShell, CSV } from "@/components/app-shell"
import { CaseReport, type ReportChat, type ReportProps, type ReportQuestion } from "@/components/cases/case-report"
import { reportPhase } from "@/lib/cases/phase"
import { WORK_TABS, type WorkTab } from "@/components/cases/work-tabs"
import { DeleteDialog } from "@/components/cases/delete-dialog"
import { AnswerImportPanel, FinalImportPanel } from "@/components/convert/final-import-panel"
import { ExportDialog, type ExportQuestion } from "@/components/convert/export-dialog"
import { InquiryPanel } from "@/components/convert/inquiry-panel"
import { LocationPanel, useLocationSearch } from "@/components/convert/location-panel"
import { PreviewTable } from "@/components/convert/preview-table"
import { ReplacePanel } from "@/components/convert/replace-panel"
import { CONFIRM_LABEL, rowFix, shortLabel, type FixActionId, type TableFilter } from "@/components/convert/status"
import { GyoshuPanel, type GyoshuDecision } from "@/components/convert/gyoshu-panel"
import { choicesOf } from "@/lib/spec/choices"
import { FixSuggestionPanel, useGyoshuSuggestion } from "@/components/convert/fix-suggestion"
import { NextSteps, type StepId } from "@/components/cases/next-steps"
import { CaseSessionContext, useCase, useCaseSession } from "@/components/cases/store/context"
import { setWork as setStoreWork, type PeerState } from "@/components/cases/store/create-case-store"
import { commit, receiveProposal, type Committed } from "@/components/cases/store/actions/proposals"
import { previousSideOf } from "@/components/cases/store/actions/source"
import { derive } from "@/components/cases/store/derive"
import { serverDeps } from "@/components/cases/store/deps"
import type { CasePageData } from "@/components/cases/store/env"
import { createCaseSession } from "@/components/cases/store/session"
import { broadcastChannel } from "@/components/cases/store/sync"
import { GyoshuSummaryTable, RoundingNote } from "@/components/convert/summary-panel"
import type { ProposalActions, UndoState } from "@/components/chat/proposal-card"
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
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Segmented } from "@/components/segmented"
import type { SaveStatus } from "@/lib/cases/autosave"
import type { CaseWork } from "@/lib/cases/state"
import { awaitsAnswer, caseTodo, pendingGyoshuItems, reportQuestionStates, tabBadge } from "@/lib/cases/todo"
import { setTax } from "@/lib/cases/tax"
import { ATTACH_ACCEPT, CASE_STATUSES, CASE_STATUS_LABELS, contentTypeOf, FILE_KIND_LABELS, fileUrl, isSheetFile, onlyNonSheetSources, type CaseFile } from "@/lib/cases/types"
import { CONFIRM_UNDO, GYOSHU_UNDO, RANGE_UNDO, SELECTION_UNDO } from "@/lib/cases/undo"
import { uploadKind, warnsUnlinked } from "@/lib/cases/upload-kind"
import { askFacts, askImpact, askPrompt, askWording, needsConfirm } from "@/lib/cases/ask-impact"
import { carryoverReady } from "@/lib/chat/carryover"
import { caseContext, NO_SOURCE_CONTEXT } from "@/lib/chat/context"
import { viewKindOf } from "@/lib/chat/view-kind"
import type { ChatAction } from "@/lib/chat/messages"
import { answer, approvedChange, decide, type OpenProposal, type Proposal, type ProposalOrigin, type ProposalRecord } from "@/lib/chat/proposals"
import { toWire } from "@/lib/chat/wire"
import { editKey, editSession, staffEdit, type CellEdit, type RowResult } from "@/lib/convert/convert"
import { csvFileName, datedFileName, toCsvBytes } from "@/lib/convert/csv"
import { compareFormats, describeFormatDiff } from "@/lib/convert/format-diff"
import { ALL_HINT_MANUAL, manualIncludedCount, RULE7_TAX_LABELS, SELECTION_LABELS, SELECTION_MODES, summarizeKoji, TAX_LABELS, type Rule7Tax, type SelectionMode, type TaxMode } from "@/lib/convert/koji-selection"
import { hasExclusion, type MappingPlan, type PlanAsk, type PlanAskKind, type SheetGrid, type ValueFilter } from "@/lib/convert/plan"
import { applyPlanPatch, sheetShapeOf } from "@/lib/convert/plan-patch"
import { askTargets, sameHeader, sourceKey } from "@/lib/convert/sources"
import { ROUNDING_LABELS, ROUNDINGS, type Rounding } from "@/lib/convert/transforms"
import { finalSheet } from "@/lib/excel/final-sheet"
import { Cost, useUsdJpy } from "@/components/cost"
import { CASE_COST_NOTICE_USD } from "@/lib/cost"
import type { UsdJpy } from "@/lib/fx"
import { errorMessage } from "@/lib/errors"
import { saveFile } from "@/lib/save-file"
import { aiAnswerPrompt, collectInquiries, inquiryKey, inquirySheet, type CellInquiry } from "@/lib/inquiry/inquiry"
import { chooseAttachment, placeMarks, placementKey, planMarks } from "@/lib/inquiry/marked"
import { INQUIRY_TEXT_PROMPT } from "@/lib/inquiry/text"
import { REVIEW_PROMPT } from "@/lib/chat/review"
import { KOJI_KEIREKI, type KojiFieldId } from "@/lib/spec/koji-keireki"
import { cn } from "@/lib/utils"
import { getCasePageFn } from "@/server/cases"
import { createClientOnlyFn } from "@tanstack/react-start"

export const Route = createFileRoute("/_authed/csv/cases/$caseId")({
  loader: async ({ params }) => {
    const page = await getCasePageFn({ data: { id: params.caseId } })
    if (!page) throw notFound()
    return page
  },
  component: CasePage,
})

/** 最後の Excel を書く ExcelJS は、ダウンロードするときにブラウザで読み込む */
const loadFinalXlsx = createClientOnlyFn(() => import("@/lib/excel/final-xlsx"))
/** 問い合わせの Excel（印付き・記入用Excel）を書く ExcelJS も同じ */
const loadInquiryXlsx = createClientOnlyFn(() => Promise.all([import("@/lib/inquiry/marked-xlsx"), import("@/lib/inquiry/inquiry-xlsx")]))

/** チャット（Markdown の描画・AI SDK）は画面を開いたあとに読み込む */
const ChatPanel = lazy(() => import("@/components/chat/chat-panel").then((m) => ({ default: m.ChatPanel })))

const SPEC = KOJI_KEIREKI
const NO_ROWS: RowResult<KojiFieldId>[] = []
const NO_ASKS: PlanAsk[] = []

/** 計画の聞き返しの種類ごとの、表の絞り込みの名前と答えの選択肢（exclude は対象の行を載せない。keep は今のまま） */
const ASK_KINDS: Record<PlanAskKind, { label: string; options: { value: "exclude" | "keep"; label: string }[] }> = {
  unfinished: { label: "未成の工事", options: [{ value: "exclude", label: "完成だけ載せる" }, { value: "keep", label: "未成も載せる" }] },
  doubtful: { label: "載せるか迷う行", options: [{ value: "exclude", label: "載せない" }, { value: "keep", label: "載せる" }] },
}
/** ダウンロードの前の確認で答える変更案の印（報告の聞き返しの id と分ける） */
const EXPORT_PROPOSAL = "proposal:"
/** 変更案の出どころの名前（ダウンロードの前の確認の「答える」） */
const PROPOSAL_ORIGIN: Record<ProposalOrigin["kind"], string> = { chat: "チャットの変更案", excel: "Excel で直した分", answer: "顧客の回答", location: "工事場所", fix: "業種の AI の案" }
/** 報告の聞き返しの答えの取り消しの記録（cases/undo.ts）の印 */
const reportUndoId = (questionId: string) => `report:${questionId}`
/** 業種の選ぶ欄の選択肢 */
const GYOSHU_CHOICES = choicesOf(KOJI_KEIREKI.fields.find((f) => f.id === "gyoshu")!)!

type Plan = MappingPlan<KojiFieldId>

/** 作業の画面をチャットの横に並べる画面の幅（これより狭い画面ではチャットを画面いっぱいにし、作業の画面は上に重ねて開く） */
const WIDE_QUERY = "(min-width: 1280px)"
/** チャットの案内のうち、案件を終えるときの振り返り（返ってきた Excel の案内はファイルの id） */
const REVIEW_SUGGESTION = "review"
const INQUIRY_SUGGESTION = "inquiry-text"

/** 画面の幅がクエリに合うか（サーバーで描くときは false） */
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const m = window.matchMedia(query)
    setMatches(m.matches)
    const on = (e: MediaQueryListEvent) => setMatches(e.matches)
    m.addEventListener("change", on)
    return () => m.removeEventListener("change", on)
  }, [query])
  return matches
}

/** 変換の元に読み込めるか（PDF などは保存と一覧だけ） */
const isPdf = (name: string) => /\.pdf$/i.test(name)

function CasePage() {
  const page = Route.useLoaderData()
  return <CaseWorkspace key={page.kase.id} {...page} />
}

/** 案件の画面。案件の1回分（ストア・表の派生・action・保存）を案件ごとに1つ作って渡す（key={kase.id} なので案件が変われば作り直す） */
function CaseWorkspace(page: CasePageData) {
  const [session] = useState(() => createCaseSession(page, serverDeps(page.kase.id), broadcastChannel(page.kase.id)))
  // 保存の層と別のタブとの道をつなぐ（初めてつないだときに変換の元・去年の Excel を読み始める）
  useEffect(() => session.connect(), [session])
  return (
    <CaseSessionContext.Provider value={session}>
      <CaseWorkspaceBody {...page} />
    </CaseSessionContext.Provider>
  )
}

function CaseWorkspaceBody({ kase, customer, chatEnabled, previous, excelKey }: CasePageData) {
  const router = useRouter()
  const session = useCaseSession()
  const { store, actions } = session
  /** 案件のファイル・状態・AI の費用の合計（ストアの runtime。変えるのは action） */
  const files = useCase((s) => s.runtime.files)
  const status = useCase((s) => s.runtime.status)
  const costUsd = useCase((s) => s.runtime.costUsd)
  /** 案件の作業（ストア。保存するもの）と変更案の中身 */
  const work = useCase((s) => s.work)
  const contents = useCase((s) => s.contents)
  /** 欄に出す変更案・未決の有無（ストアの派生。描画でも action でも同じもの） */
  const derived = useCase(derive)
  /** 開いたときに中身の記録が無く閉じた変更案・記録を読めなかった変更案の数（報告に出す） */
  const closedMissing = useCase((s) => s.runtime.closedMissing)
  const unreadableProposals = useCase((s) => s.runtime.unreadable)
  /** 作業を変える（next はその時点の作業から作る。値をそのまま入れるときも、その時点の作業に重ねない値だけ） */
  const setWork = (next: CaseWork | ((w: CaseWork) => CaseWork)) => setStoreWork(store, typeof next === "function" ? next : () => next)
  /** 最新の作業（待っている間に変わったかを確かめる。前の描画の値を使わない） */
  const latestWork = () => store.getState().work
  const { edits, replacements, manual, dismissed, answers, tax, basis, rule7Tax, selection: selectionMode, rounding, aiNotice } = work
  const update = <K extends keyof CaseWork>(key: K, next: (prev: CaseWork[K]) => CaseWork[K]) => setWork((w) => ({ ...w, [key]: next(w[key]) }))
  /** 値をその場で読んでから入れる（イベントの値を updater の中で読まない） */
  const set = <K extends keyof CaseWork>(key: K, value: CaseWork[K]) => update(key, () => value)
  /** 変換の元・計画・変換の途中（ストアの runtime。待つ処理は actions/source.ts） */
  const loadingSource = useCase((s) => s.runtime.loading)
  const sourceError = useCase((s) => s.runtime.sourceError)
  const uploadNotes = useCase((s) => s.runtime.notes)
  const planning = useCase((s) => s.runtime.planDraft !== null)
  const convertError = useCase((s) => s.runtime.convertError)
  const [exportOpen, setExportOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pendingSource, setPendingSource] = useState<CaseFile | null>(null)
  const [filter, setFilter] = useState<TableFilter | null>(null)
  /** 作業の画面のタブ */
  const [tab, setTab] = useState<WorkTab>("table")
  /** 最後に上げ直した最後の Excel の結果・チャットの案内（ストアの runtime） */
  const finalResult = useCase((s) => s.runtime.finalResult)
  const answerHints = useCase((s) => s.runtime.hints.answer)
  const reviewHint = useCase((s) => s.runtime.hints.review)
  /** 問い合わせの欄を開いた（チャットに「AI で文面を作る」を出す。一度送ったら、この画面では出さない） */
  const [inquiryHint, setInquiryHint] = useState(false)
  const inquiryHintSent = useRef(false)
  const wide = useMediaQuery(WIDE_QUERY)
  /**
   * 職員が作業の画面を開いた（true）・閉じた（false）か。決めるまで（null）は、表があれば広い画面では開き、狭い画面では閉じておく
   * （狭い画面で開くとチャットを覆うので、チャットの「表を開く」で開く）
   */
  const [workChoice, setWorkChoice] = useState<boolean | null>(null)

  /** 保存の状態と、同じブラウザの別のタブ（sync.ts） */
  const saveStatus = useCase((s) => s.sync.status)
  const peer = useCase((s) => s.sync.peer)

  /** 表（変換の鎖。ストアごとの派生 table.ts。action も同じものを読む） */
  const source = useCase((s) => s.runtime.source)
  const { plan, grid, sources, rows, reconverting, hasTable, unmarked, roundingTotals, edited, selected, view, shown, inclusion, letters, output, currentSource } = useCase(session.table)

  /** 去年の案件の元の Excel（形を比べる・列の計画の参考。読めなければ理由） */
  const previousSheets = useCase((s) => s.runtime.previous)
  /** 去年の比べるシートと見出しの行。去年の Excel を読んだときに1回だけ決める */
  const previousSide = useMemo(() => (previous && Array.isArray(previousSheets) ? previousSideOf(previous, previousSheets) : null), [previousSheets])
  /** 去年と今年の元の Excel の見出し（「去年のやり方で直す」で、去年のコードの文字列のうち見出しの名前は伏せない） */
  const carryoverHeaders = () => {
    const prevHeader = previousSide?.sheets.find((s) => s.name === previousSide.sheet)?.rows[previousSide.headerRow] ?? []
    const curHeader = grid && plan ? (grid.rows[plan.headerRow] ?? []) : []
    return [...new Set([...prevHeader, ...curHeader].map((h) => h.trim()).filter(Boolean))]
  }
  /** 去年の元の Excel の配置技術者の列の値（「去年のやり方で直す」で去年のコードから個人名を消す。去年の計画のシートと列があるときだけ） */
  const previousEngineerNames = () => {
    if (!previous || !previousSide || previousSide.sheet !== previous.sheet || previous.headerRow === null) return []
    const rows = previousSide.sheets.find((s) => s.name === previousSide.sheet)?.rows.slice(previous.headerRow + 1) ?? []
    return [...new Set(rows.flatMap((r) => previous.engineerColumns.map((c) => (r[c] ?? "").trim()).filter(Boolean)))].slice(0, 20_000)
  }
  /** 去年の元の Excel と今年の元の Excel の形の違い（lib/convert/format-diff.ts）。報告とチャットの文脈に出す。今年のシートか見出しの行が変わったときだけ比べ直す */
  const currentSheet = grid?.name ?? null
  const currentHeaderRow = plan?.headerRow ?? null
  const formatDiff = useMemo(() => {
    if (!previousSide || !source || currentSheet === null || currentHeaderRow === null) return null
    const diff = compareFormats(previousSide, { sheets: source.sheets, sheet: currentSheet, headerRow: currentHeaderRow })
    return { diff, lines: describeFormatDiff(diff) }
  }, [previousSide, source, currentSheet, currentHeaderRow])

  /**
   * 届いたファイルを付ける（チャットの📎でアップロードしたファイル、画面にドラッグしたファイル）。種類は決まった印で見分ける（lib/cases/upload-kind.ts）:
   * この画面でダウンロードした最後の Excel は差分を変更案に、印付きの Excel・記入用Excel は顧客の回答の変更案にし、ほかの表は届いたファイルとして保存する。
   * 変換の元がまだ無ければ最初の表を変換の元にし、もう元があれば変換の元にするか聞く。照合用のシートの無い最後の Excel の形の表は、
   * 変換の元があれば直した Excel と取り違えないよう、表に戻せないと伝えて聞く（前の編集用の Excel も同じ。lib/cases/upload-kind.ts の warnsUnlinked）
   */
  async function attach(list: readonly File[]) {
    let hasSource = !!latestWork().sourceFileId
    for (const f of list) {
      let sheets: SheetGrid[] | null = null
      if (isSheetFile(f.name)) {
        try {
          const { readWorkbook } = await import("@/lib/convert/workbook")
          sheets = readWorkbook(f.name, new Uint8Array(await f.arrayBuffer()))
        } catch (e) {
          const text = errorMessage(e, "読めませんでした")
          toast.error(`${f.name}: ${text}`)
          actions.note({ name: f.name, text, tone: "error" })
          continue
        }
      }
      const kind = uploadKind(sheets)
      if (kind === "final" && sheets) {
        await actions.importFinal(f, sheets)
        continue
      }
      if (kind === "answer" || kind === "marked") {
        setTab("inquiry")
        await actions.importAnswers(f, kind)
        continue
      }
      const saved = await actions.keepFile("source", f, f.name)
      if (!saved) continue
      if (isPdf(saved.name) || !isSheetFile(saved.name)) {
        // HEIC（iPhone の写真）は Claude が見られない（lib/chat/view-file.ts）。保存はして、JPEG で付け直すよう知らせる
        if (viewKindOf(saved.name)?.kind === "heic") actions.note({ name: f.name, text: "届いたファイルとして保存しました。HEIC の写真はチャットの AI が見られないので、JPEG で保存し直して付けてください", tone: "error" })
        else actions.note({ name: f.name, text: "届いたファイルとして保存しました（チャットの AI は読めます）" })
        continue
      }
      if (warnsUnlinked(kind, hasSource)) {
        actions.note({ name: f.name, text: "ダウンロードした Excel の形ですが照合用のシートが無いので、直した Excel としては表に戻せません。変換の元にするかを選んでください" })
        hasSource = true
        setPendingSource(saved)
        continue
      }
      if (!hasSource) {
        hasSource = true
        // PDF から足した行があれば、変換の元にすると消えるので確かめる
        if (latestWork().added.length) setPendingSource(saved)
        else await actions.openSource(saved, true)
      } else setPendingSource(saved)
    }
  }

  function chooseSource(f: CaseFile) {
    if (work.converted || work.edits.size || work.added.length) setPendingSource(f)
    else void actions.openSource(f, true)
  }

  /** 表の手直し（1回の手直しで決める項目をまとめて。主任技術者・監理技術者は2列を一緒に） */
  function edit(rowKey: string, changes: readonly [KojiFieldId, CellEdit][]) {
    update("edits", (prev) => {
      const next = new Map(prev)
      for (const [field, e] of changes) next.set(editKey(rowKey, field), e)
      return next
    })
  }

  function replace(field: KojiFieldId, from: string, text: string) {
    const to = text.trim() ? staffEdit(text, letters) : undefined
    update("replacements", (prev) => {
      const { [from]: _, ...rest } = prev[field] ?? {}
      return { ...prev, [field]: to ? { ...rest, [from]: to } : rest }
    })
  }

  const added = work.added
  /** 欄に出す変更案（開いているものと、承認を取り消せるもの） */
  const { excel: excelProposals, answer: answerProposals, location: locationProposals, fix: fixProposals } = derived.panels
  /**
   * 行の片付けること（職員が直すセルと、顧客に聞くセル）。表の絞り込み・行の理由・次にやること・ダウンロードの前の確認で同じものを使う
   * （行か外した問い合わせが変わったときだけ1回数える）
   */
  const rowFixes = useMemo(() => new Map((shown ?? []).map((r) => [r.key, rowFix(r, (f) => !dismissed.has(editKey(r.key, f)))])), [shown, dismissed])
  const inquiries = useMemo(() => (output ? collectInquiries(output, { tax }) : []), [output, tax])
  /** 外していないセルの問い合わせ（添付の Excel に色を付けるもの） */
  const activeCells = useMemo(() => inquiries.filter((q): q is CellInquiry => q.kind === "cell" && !dismissed.has(inquiryKey(q))), [inquiries, dismissed])
  /** 印を付ける場所（印付きにできる元のときだけ。添付の判定とダウンロードで同じものを使う） */
  const placement = useMemo(
    () => (currentSource?.markable.ok && plan && output ? placeMarks(currentSource.sheets, plan, output, activeCells) : null),
    [currentSource, plan, output, activeCells],
  )
  const placementId = useMemo(() => (placement ? placementKey(placement) : null), [placement])
  /** 添付する Excel（変換の元に印を付けられれば印付き。書けない元・前に書いてみて書けなかった同じ場所なら、理由を添えて記入用Excel） */
  const markFailure = work.markFailure
  const attachment = useMemo(() => {
    const failed = currentSource && markFailure && markFailure.fileId === currentSource.fileId && markFailure.key === placementId ? markFailure.reason : null
    return chooseAttachment(currentSource ? (failed ? { ok: false, reason: failed } : currentSource.markable) : null, placement, output ?? NO_ROWS, activeCells)
  }, [currentSource, markFailure, placementId, placement, output, activeCells])
  const summary = useMemo(() => (edited && selected ? summarizeKoji(edited, selected, { tax, basis, rule7Tax }) : []), [edited, selected, tax, basis, rule7Tax])

  /** 計画の聞き返しと、その対象の表の行（元の Excel のセルで決める。答えで載せないにした行も数える） */
  const planAsks = work.plan?.plan.asks ?? NO_ASKS
  const askRows = useMemo(() => {
    if (!sources || !shown || !planAsks.length) return []
    const rf = plan!.rowFilter
    return planAsks.map((a, i) => {
      // 計画の取り込みと同じ数え方（askTargets）。行は元の行の分け方（記号の列で分けた行）ごと
      const targets = new Set(askTargets(a, sources.rows, rf).map(sourceKey))
      const rows = shown.filter((r) => targets.has(sourceKey(r)))
      return { id: `plan-ask-${i}`, label: ASK_KINDS[a.kind].label, keys: new Set(rows.map((r) => r.key)), rows }
    })
  }, [sources, shown, planAsks, plan])
  /**
   * 聞き返しの「載せない」側の答えで、載せる件数と7割がどう変わるか（今の7割の選び方・入れ外しで選び直す。表・ダウンロードの前の確認と同じ計算）と、
   * 対象がデータの大半になるときの事実（決まった処理で数える）
   */
  const askEffects = useMemo(
    () =>
      askRows.map((r, i) => {
        const impact = edited && shown && selected ? askImpact(edited, { manual, tax, basis, rule7Tax, selection: selectionMode }, r.keys, { inclusion: selected, summary }) : null
        return {
          impact,
          facts: shown ? askFacts(planAsks[i]!.kind, shown, r.keys) : undefined,
          // カードの言葉と「AI に聞く」の質問（行や設定が変わったときだけ作り直す）
          wording: askWording(impact, r.keys.size),
          prompt: askPrompt(planAsks[i]!.text, r.rows, impact?.targets ?? null),
        }
      }),
    [askRows, edited, shown, selected, summary, planAsks, manual, tax, basis, rule7Tax, selectionMode],
  )

  /** チャットに指示を送れるか（チャットの欄が知らせる。ダウンロードの前の確認の「AI に聞く」） */
  const [chatCanSend, setChatCanSend] = useState(false)
  /** 載せる件数が大きく減る答えを押したときの確かめ（押す前に何件減るか・7割に届くかを出す） */
  const [confirmAsk, setConfirmAsk] = useState<{ id: string; option: string; title: string; lines: string[] } | null>(null)

  const fx = useUsdJpy()
  /** ルールの追記・工事場所を保存している間（変更案の承認を止める） */
  const savingRule = useCase((s) => s.runtime.busy.rule)

  /** サーバーが置いた変更案の記録を足す（もう作業にあれば足さない。決め終わったものを開き直さない） */
  const addRecorded = (r: ProposalRecord) => receiveProposal(store, r, "ifUnknown")
  const { pendingReview, pendingInquiryText, undecidedLocation } = derived
  // 未決の工事場所の項目がある変更案（一括調査のものも、チャットの「この現場ってどこ？」のものも）を決めるまで、次の一括調査を始めさせない
  const locationSearch = useLocationSearch({ caseId: kase.id, view, table: tableWire, undecided: undecidedLocation, onRecord: addRecorded, onCaseCost: actions.setCost })
  const gyoshuSuggestion = useGyoshuSuggestion({ caseId: kase.id, onRecord: addRecorded, onCaseCost: actions.addCost })

  /** 取り消せる操作をした通知（取り消せるときだけ「取り消す」を出す。記録が大きすぎて取り消せないときはそう伝える） */
  function notifyCommitted(text: string, committed: Committed, onUndo: () => void) {
    if (committed === "tooLarge") toast.warning(`${text}（変更が大きすぎて取り消しの記録に残せないので、取り消せません）`)
    else toast.success(text, committed === "undoable" ? { action: { label: "取り消す", onClick: onUndo } } : undefined)
  }

  /**
   * 業種の一覧で決める（1回の操作を1つの取り消しの記録に）。値は職員が決めた手直し（表で選んだのと同じ staffEdit）。
   * 案が AI の案の変更案の未決の項目なら、案のまま決めた行はその項目を承認（承認と同じ値・注意書き）、違う値を選んだ行はその項目を却下にする。
   * 取り消すと値を戻す（変更案の項目は決めたまま。チャットの承認の取り消しと同じ）。項目はそのときの作業から引く
   */
  function decideGyoshu(decisions: readonly GyoshuDecision[], how: "plan" | "pick") {
    if (!decisions.length) return
    const id = `${GYOSHU_UNDO}${crypto.randomUUID()}`
    const committed = commit(store, { group: id, kind: "op" }, ({ work: w, contents }) => {
      const pending = pendingGyoshuItems(w.proposals, contents)
      const edits = new Map(w.edits)
      const decided = new Map<string, { applied: number[]; rejected: number[] }>()
      for (const d of decisions) {
        const item = pending.get(d.key)
        const same = item?.edit.value === d.value
        if (item) {
          const x = decided.get(item.proposalId) ?? { applied: [], rejected: [] }
          ;(same ? x.applied : x.rejected).push(item.index)
          decided.set(item.proposalId, x)
        }
        // 案のまま決めた AI の案は、承認したときと同じ値（推定の印を外し、根拠を注意書きに残す）
        const approved = item && same ? approvedChange(w.proposals.find((x) => x.id === item.proposalId)!, { kind: "cell", rowKey: d.key, field: "gyoshu", edit: item.edit }) : null
        edits.set(editKey(d.key, "gyoshu"), approved?.kind === "cell" ? approved.edit : staffEdit(d.value, letters))
      }
      const proposals = w.proposals.map((p) => {
        const x = decided.get(p.id)
        return x ? decide(decide(p, x.applied, "applied"), x.rejected, "rejected") : p
      })
      return { ...w, edits, proposals }
    })
    const text = how === "plan" ? `${decisions.length} 行の業種を案のまま決めました` : "業種を決めました"
    notifyCommitted(text, committed, () => undoProposal(id, "業種の決定"))
  }
  /** 直前に業種の一覧で決めたもの・「これでよい」にしたもの（取り消せるもの） */
  const { gyoshu: lastGyoshuUndo, confirm: lastConfirmUndo } = derived.lastOp

  /**
   * 「これでよい」: 要確認・AI の推定の値を、職員が同じ値を手で入れた手直し（by staff）にする（表で手で入れたのと同じ editSession）。取り消しの記録に残す
   */
  function confirmCell(rowKey: string, field: KojiFieldId) {
    const cell = shown?.find((r) => r.key === rowKey)?.cells[field]
    if (!cell) return
    const session = editSession(cell, letters)
    const id = `${CONFIRM_UNDO}${crypto.randomUUID()}`
    const committed = commit(store, { group: id, kind: "op" }, ({ work: w }) => ({ ...w, edits: new Map(w.edits).set(editKey(rowKey, field), session.read(session.text)) }))
    notifyCommitted(`${shortLabel(field)}を確かめた値にしました`, committed, () => undoProposal(id, `「${CONFIRM_LABEL}」`))
  }

  /**
   * 載せる工事の選び方を変える（7割と金額のタブの「載せる工事」・表の「載せる」の見出しのチェック・「全件にしますか？」で同じ）。
   * 取り消しの記録に残し、通知の「取り消す」で戻せる（承認の取り消しと同じ記録）
   */
  function changeSelection(mode: SelectionMode) {
    if (latestWork().selection === mode) return
    const id = `${SELECTION_UNDO}${crypto.randomUUID()}`
    const committed = commit(store, { group: id, kind: "op" }, ({ work: w }) => ({ ...w, selection: mode }))
    notifyCommitted(`載せる工事を${SELECTION_LABELS[mode]}にしました`, committed, () => undoProposal(id, "載せる工事の切り替え"))
  }
  /** 表の Shift＋クリックで範囲をまとめて入れ外しする（1回の操作を1つの取り消しの記録に） */
  function toggleRange(keys: readonly string[], included: boolean, skippedExcluded: number) {
    const skipped = skippedExcluded ? `（除外の ${skippedExcluded} 行は入れていません）` : ""
    if (!keys.length) {
      toast.info(`範囲の行はもう${included ? "載せています" : "外しています"}${skipped}`)
      return
    }
    const id = `${RANGE_UNDO}${crypto.randomUUID()}`
    const committed = commit(store, { group: id, kind: "op" }, ({ work: w }) => {
      const manual = new Map(w.manual)
      for (const k of keys) manual.set(k, included)
      return { ...w, manual }
    })
    notifyCommitted(`${keys.length} 行を${included ? "載せました" : "外しました"}${skipped}`, committed, () => undoProposal(id, "まとめての入れ外し"))
  }
  /** 7割ルールのまま手で載せた行の数（多ければ表の上で全件を勧める） */
  const manualIncluded = useMemo(() => manualIncludedCount(inclusion), [inclusion])
  const allHint =
    selectionMode === "rule7" && !work.allHintClosed && manualIncluded >= ALL_HINT_MANUAL
      ? { count: manualIncluded, onAll: () => changeSelection("all"), onClose: () => set("allHintClosed", true) }
      : null

  /** 変換の元の表が無く（PDF だけ）、AI に一から表を作らせる案件か */
  const noSheetSource = !work.sourceFileId && onlyNonSheetSources(files)
  /** チャットに送れるか（変換した、または変換の元の表が無い） */
  const chatReady = !!rows && !reconverting && (noSheetSource || (work.converted && !!source && !!grid && !!plan))

  /** 今の表（チャットと工事場所の調査に送る。大きいので送るときだけ作る） */
  function tableWire() {
    return rows ? toWire({ rows, added, edits, replacements, manual, tax, basis, rule7Tax, selection: selectionMode, rounding, dismissed, inquiryText: work.inquiryText }) : null
  }

  function chatRequest() {
    if (!rows || !chatReady) return null
    return {
      table: tableWire()!,
      context: source && grid && plan ? caseContext(source.sheets, grid, plan, previous && formatDiff ? { fiscalYear: previous.fiscalYear, lines: formatDiff.lines } : undefined) : NO_SOURCE_CONTEXT,
      sourceFileId: work.sourceFileId,
      plan: grid && work.plan ? { plan: work.plan.plan, shape: sheetShapeOf(grid) } : null,
    }
  }

  const updateProposal = (id: string, next: (p: Proposal) => Proposal) => update("proposals", (ps) => ps.map((p) => (p.id === id ? next(p) : p)))

  /**
   * 変更案の承認（報告の聞き返しの答えも同じ記録）を取り消す（その変更案の、まだ取り消していない記録を新しい順に）。承認のあとに変えた値は残して知らせる
   */
  function undoProposal(proposalId: string, what = "承認") {
    const r = actions.undo(proposalId)
    if (!r) {
      toast.info(`${what}を取り消せません（取り消しの記録がもう無いか、取り消し済みです）`)
      return
    }
    const { reverted, kept } = r
    if (kept) toast.warning(`${what}を取り消しました（${reverted} 件を戻し、${what}のあとに変えた ${kept} 件はそのままにしました）`)
    else toast.success(`${what}を取り消しました（${reverted} 件を戻しました）`)
  }

  const undoState = (proposalId: string): UndoState | null => derived.undoStates.get(proposalId) ?? null

  const proposalActions: Omit<ProposalActions, "canSend"> = {
    decide: (id, indices, d) => void actions.decideProposal(id, indices, d),
    answer: (id, a) => updateProposal(id, (p) => answer(p, a)),
    undo: undoProposal,
    undoState,
    awaiting: (id) => awaitsAnswer(todo, id),
  }

  /** CSV（控え）をダウンロードする。CP932 の検査を通した値をそのまま書き、案件のファイルに残す */
  function downloadCsv() {
    if (!output) return
    const bytes = toCsvBytes(SPEC, output)
    const name = csvFileName(SPEC, customer.name, new Date())
    saveFile(bytes, name, "text/csv")
    // Excel で開いて保存すると文字コードが変わり、建設業.NET で文字化けする（都道府県も読めず選ぶ欄の先頭になる）
    toast.info("CSV は Excel で開いて保存しないでください（文字化けします）。そのまま建設業.NET に取り込んでください。直すときは Excel をダウンロードして直し、📎でアップロードし直します。", { duration: 10000 })
    void actions.keepFile("csv", new Blob([bytes as BlobPart], { type: "text/csv" }), name)
  }

  /** 最後の Excel をダウンロードする（lib/excel/final-sheet.ts。値は CSV と同じ。直して上げ直せる照合用の隠しシート付き）。案件のファイルに残す */
  async function downloadFinalExcel() {
    if (!view || !output) return
    try {
      const { finalXlsx } = await loadFinalXlsx()
      // 照合用の鍵はサーバーが案件ごとに決めたもの（Excel には書かない）
      const bytes = await finalXlsx(await finalSheet(view, { caseId: kase.id, sourceFileId: latestWork().sourceFileId, excelKey }))
      const name = datedFileName(SPEC.fileNamePrefix, customer.name, new Date(), "xlsx")
      saveFile(bytes, name, contentTypeOf(name))
      void actions.keepFile("final_sheet", new Blob([bytes as BlobPart], { type: contentTypeOf(name) }), name)
    } catch (e) {
      toast.error(errorMessage(e, "Excel を作れませんでした"))
    }
  }

  /**
   * 問い合わせの Excel をダウンロードし、案件のファイルに残す。印付きにできれば変換の元に印を付け（lib/inquiry/marked.ts）、
   * 書いてみて元を壊さずに書けなければ、理由を知らせて記入用Excelにする
   */
  async function downloadInquiry() {
    if (!output) return
    const [{ markedXlsx }, { inquiryXlsx }] = await loadInquiryXlsx()
    const type = contentTypeOf("x.xlsx")
    const save = (bytes: Uint8Array, name: string) => {
      saveFile(bytes, name, type)
      void actions.keepFile("inquiry_sheet", new Blob([bytes as BlobPart], { type }), name)
    }
    if (attachment.kind === "marked" && currentSource && placement && placementId) {
      const marks = await planMarks(currentSource.sheets, placement, { caseId: kase.id, sourceFileId: currentSource.fileId, excelKey })
      const out = await markedXlsx(currentSource, marks, excelKey, customer.name)
      if (out.ok) return save(out.bytes, datedFileName("確認のお願い", customer.name, new Date(), "xlsx"))
      // 同じ元・同じ場所では記入用Excelにする（保存する。メールの本文も合わせる）
      set("markFailure", { fileId: currentSource.fileId, key: placementId, reason: out.reason })
      toast.warning(`${out.reason}、記入用Excelにしました（メールの本文も記入用Excelに合わせました）`)
    }
    save(await inquiryXlsx(inquirySheet(output, activeCells), customer.name), datedFileName("記入のお願い", customer.name, new Date(), "xlsx"))
  }

  /** 作業の画面を開いているか（表ができてから） */
  const workShown = hasTable && (workChoice ?? wide)
  useEffect(() => {
    if (workShown && tab === "inquiry" && !inquiryHintSent.current) setInquiryHint(true)
  }, [workShown, tab])

  /** 作業の画面をそのタブで開く */
  function showTab(t: WorkTab) {
    setTab(t)
    setWorkChoice(true)
  }

  /**
   * チャットから作業のタブを開く。押したとき（click）は開く。道具の結果が届いたとき（auto）は、広い画面で職員が閉じていなければ開き、
   * 職員が閉じた・狭い画面ではタブだけ切り替える（勝手に開き直さない。返事の途中でチャットを覆わない。「表を開く」で開くとそのタブ）
   */
  function openTab(t: WorkTab, how: "auto" | "click") {
    if (how === "click" || (wide && workChoice !== false)) showTab(t)
    else setTab(t)
  }

  /**
   * 直し方の操作（status.ts の FIX_ACTIONS）。業種は AI の案を頼んで結果をチャットの流れに出す（狭い画面では作業の画面を閉じて見せる）、
   * 工事場所は工事場所のタブ（費用の目安を見てから職員が調べ始める）、顧客に聞くものは問い合わせのタブ
   */
  function runFixAction(action: FixActionId, keys: readonly string[]) {
    if (action === "findLocation") return showTab("location")
    if (action === "askCustomer") return showTab("inquiry")
    showTab("gyoshu")
    // 1行から開いたときは、その行の選ぶ欄へ
    if (keys.length === 1)
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`[data-testid="gyoshu-list"] li[data-key="${CSS.escape(keys[0]!)}"]`)
        row?.scrollIntoView({ block: "nearest" })
        row?.querySelector<HTMLElement>('[data-testid="gyoshu-pick"]')?.focus({ preventScroll: true })
      })
  }
  /** 業種の AI の案を頼む（業種の一覧から。結果は一覧の「案」と、チャットの流れの最後の変更案に出る） */
  function suggestGyoshu(keys: readonly string[]) {
    if (shown && canSuggest) void gyoshuSuggestion.run(shown, keys)
  }
  function onChatAction(a: ChatAction) {
    if (a === "export") setExportOpen(true)
    else showTab("inquiry")
  }

  // ---- 変換の報告（チャットの最初の返事） ----
  const sourceFile = files.find((f) => f.id === work.sourceFileId)
  const phase = reportPhase({
    aiEnabled: chatEnabled,
    loading: loadingSource,
    sourceError: sourceError?.message ?? null,
    planning,
    convertError: convertError && convertError.plan === work.plan ? convertError.message : null,
    converting: !!work.plan && (!work.converted || reconverting),
    hasTable,
    noSheetSource,
    sourceName: work.sourceFileId ? (sourceFile?.name ?? "") : null,
  })
  const sourceSheets = work.plan?.plan.sheets ?? []
  const reportNotes: ReportProps["notes"] = [
    ...(closedMissing
      ? [{ text: `中身の記録が無い変更案を ${closedMissing} 件閉じました（未決の項目は却下にしました。要るものはチャットでもう一度頼んでください）。`, tone: "warning" as const, testId: "closed-missing" }]
      : []),
    ...(unreadableProposals
      ? [{ text: `中身の記録を読めない変更案が ${unreadableProposals} 件あります（記録は残しています。決められないので、続くときは管理者に知らせてください）。`, tone: "warning" as const, testId: "unreadable-proposals" }]
      : []),
    ...(work.plan?.notice ? [{ text: work.plan.notice, tone: "warning" as const }] : []),
    // 計画が税込・税抜を決めたら聞き返さない。決めたことと直し方だけ伝える
    ...(work.taxBy === "plan" && tax !== "unknown"
      ? [{ text: `Excel の見出し・注記から、金額は${TAX_LABELS[tax]}とみなしました。違えば「7割と金額」で直してください。`, testId: "plan-tax-note" }]
      : []),
    // 使うシートのメモは報告の最初の行（どのファイルのどのシートか）と重なるので出さない
    ...(work.plan?.plan.notes ?? []).filter((n) => !n.startsWith("使うシート「")).map((text) => ({ text })),
    ...(sources && sources.duplicates > 0
      ? [{ text: `シートをまたいで同じ行が ${sources.duplicates} 件あったので、1件にまとめました。`, tone: "warning" as const, testId: "duplicate-notice" }]
      : []),
    ...(unmarked > 0 ? [{ text: `業種の記号（○）が無い ${unmarked} 行は出しません。`, testId: "unmarked-notice" }] : []),
    ...(aiNotice ? [{ text: `AI で変換できなかった値があります（${aiNotice}）。黄色のセルを確かめてください。`, tone: "warning" as const, testId: "ai-notice" }] : []),
  ]
  /** 答えを取り消せる聞き返しの、取り消し（答えの記録が戻せるときだけ） */
  const undoAnswer = (id: string) => (undoState(reportUndoId(id))?.can ? () => undoProposal(reportUndoId(id), "答え") : null)
  /** 報告の聞き返しと答えたか（lib/cases/todo.ts。報告・ダウンロードの前の確認・「答える」で同じもの） */
  const askIds = useMemo(() => askRows.map((r) => r.id), [askRows])
  const questionStates = useMemo(
    () => reportQuestionStates({ hasTable, tax, taxBy: work.taxBy, reportAnswers: work.reportAnswers, askIds }),
    [hasTable, tax, work.taxBy, work.reportAnswers, askIds],
  )
  const questions: ReportQuestion[] = questionStates.map(({ id, answered }) => {
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
    const label = answered ? (kind.options.find((o) => o.value === work.reportAnswers[id])?.label ?? null) : null
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
      view: () => {
        setFilter({ kind: "all", ask: r.id })
        showTab("table")
      },
      undo: label !== null ? undoAnswer(id) : null,
    }
  })
  /**
   * 残りの件数（lib/cases/todo.ts が1回だけ数える）。次にやること・ダウンロードの前の確認・表の「直す」・業種のタブ・タブの数・
   * チャットの答えを待つ印は、これを読むだけにする。表ができる前も、答える（変更案・聞き返し）は数える
   */
  /** 問い合わせを送ったか（案件が問い合わせ中か、問い合わせの Excel・メールの下書き〔件名〕を出した） */
  const inquirySent = status === "inquiring" || files.some((f) => f.kind === "inquiry_sheet") || work.inquiryText.subject !== null
  const todo = useMemo(
    () =>
      caseTodo({
        shown: shown ?? NO_ROWS,
        inclusion,
        rowFixes,
        exportRows: output?.length ?? 0,
        proposals: work.proposals,
        contents,
        questions: questionStates,
        inquiries,
        dismissed,
        answersRead: work.answers !== null,
        inquirySent,
      }),
    [shown, output, inclusion, rowFixes, work.proposals, contents, questionStates, inquiries, dismissed, work.answers, inquirySent],
  )
  /**
   * 表の絞り込み。職員が選ぶまでは、直す行があればその行だけ（無ければすべて）。もう無い聞き返し（計画を立て直した）は「すべて」に戻し、
   * 行が無くなった理由（直し終えた）は理由を外す（絞り込みから抜けられなくならないように）
   */
  const chosenFilter: TableFilter = filter ?? { kind: todo.fix.rows > 0 ? "fix" : "all" }
  const tableFilter: TableFilter =
    chosenFilter.ask && !askRows.some((a) => a.id === chosenFilter.ask)
      ? { kind: "all" }
      : chosenFilter.reason && !(todo.fix.byKind[chosenFilter.reason] > 0)
        ? { kind: chosenFilter.kind }
        : chosenFilter
  /**
   * AI で案を出せるか（AI が使える・頼んでいる最中でない・一覧の外の行に前の案の未決が無い）。一覧の行の未決は一覧の「案」に出ていて、
   * 頼むのは案の無い行だけなので重ならない
   */
  const canSuggest = chatEnabled && gyoshuSuggestion.running === null && !todo.answer.some((a) => a.kind === "proposal" && a.origin === "fix")
  const suggestBlocked = canSuggest ? undefined : !chatEnabled ? "AI を使えません" : gyoshuSuggestion.running !== null ? "AI が案を考えています" : "前の AI の案がチャットに残っています（承認か却下してください）"

  /**
   * 聞き返しに答える。税込・税抜の答えは取り消しの記録（cases/undo.ts）に残す（取り消すと聞き返しを開き直し、税の設定も戻る）
   */
  function answerReport(id: string, value: string) {
    if (id === "tax") {
      // 「分からない（顧客に聞く）」も職員が決めた値（計画のし直しで上書きしない）
      const next = value === "included" || value === "excluded" ? value : "unknown"
      commit(store, { group: reportUndoId(id), kind: "approval" }, ({ work: w }) => ({ ...setTax(w, next, "staff"), reportAnswers: { ...w.reportAnswers, tax: value === "ask" ? "ask" : next } }))
      return
    }
    if (value === "keep") return answerAsk(id, value)
    if (value !== "exclude") return
    const i = askRows.findIndex((r) => r.id === id)
    const effect = askEffects[i]
    if (effect?.impact && needsConfirm(effect.impact)) {
      const { before, after, shortBefore, shortAfter } = effect.impact
      const newlyShort = shortAfter.filter((g) => !shortBefore.includes(g))
      setConfirmAsk({
        id,
        option: ASK_KINDS[planAsks[i]!.kind].options.find((o) => o.value === "exclude")!.label,
        title: `載せる工事が ${before} 件から ${after} 件に減ります`,
        lines: [
          effect.facts,
          after === 0 ? "載せる工事がなくなります。" : newlyShort.length ? `7割に届かなくなります: ${newlyShort.join("・")}` : "7割には届きます（決算書の額を入れていない業種は、表の合計で見ています）。",
        ].filter((x): x is string => !!x),
      })
      return
    }
    answerAsk(id, value)
  }

  /**
   * 計画の聞き返しに答える。「載せない」側は対象の行を計画の出さない行に足して変換し直す（チャットの set_plan と同じ差分・確かめ方）。
   * 答えと足した分は取り消しの記録（税の答えと同じ記録）に残し、取り消すと答えと足した分だけを戻す（もう同じ除外があれば足さない）
   */
  function answerAsk(id: string, value: "exclude" | "keep") {
    const ask = planAsks[askRows.findIndex((r) => r.id === id)]
    if (!ask || !work.plan) return
    const added: ValueFilter[] = value === "exclude" && !hasExclusion(work.plan.plan.rowFilter, ask) ? [{ column: ask.column, values: ask.values }] : []
    const patch = { excludeRows: { add: added, remove: [] }, reason: ASK_KINDS[ask.kind].label }
    if (added.length) {
      if (!grid || !source) {
        toast.error("変換の元のファイルを読んでいます。読み終えてから答えてください")
        return
      }
      // 今の計画で確かめて知らせる。反映は下で、そのときの計画に重ねる（間に変わった計画を古い計画で上書きしない）
      const r = applyPlanPatch(SPEC, work.plan.plan, patch, sheetShapeOf(grid), source.sheets)
      if (!r.ok) {
        toast.error(`答えを反映できません: ${r.problems.join(" / ")}`)
        return
      }
      actions.supersedeConversion()
    }
    commit(store, { group: reportUndoId(id), kind: "approval", exclusions: added }, ({ work: w }) => {
      if (!w.plan) return w
      let plan = w.plan
      if (added.length) {
        const r = applyPlanPatch(SPEC, w.plan.plan, patch, sheetShapeOf(grid!), source!.sheets)
        // 間に変わった計画には重ねられない: 答えずに残す（聞き返しは開いたまま）
        if (!r.ok) return w
        plan = { ...w.plan, plan: r.plan }
      }
      return { ...w, ...(added.length ? { plan, converted: false } : {}), reportAnswers: { ...w.reportAnswers, [id]: value } }
    })
  }
  const locationSites = locationSearch.sites
  const caseReport = (chat: ReportChat | null) => (
    <CaseReport
      phase={phase}
      source={sourceFile ? `「${sourceFile.name}」${sourceSheets.length ? `のシート「${sourceSheets.join("」「")}」` : ""}` : null}
      planByAi={work.plan?.source === "ai"}
      notes={reportNotes}
      counts={shown && output ? { rows: shown.length, csv: output.length } : null}
      questions={questions}
      onAnswer={answerReport}
      previous={
        previous && hasTable && (formatDiff || (previousSheets && "error" in previousSheets) || !previous.source)
          ? {
              fiscalYear: previous.fiscalYear,
              lines: formatDiff?.lines ?? null,
              error: formatDiff ? null : previous.source ? (previousSheets as { error: string } | null)?.error ?? null : "去年の案件に表のファイルが無いので比べられません。",
              changed: !!formatDiff && !formatDiff.diff.same,
            }
          : null
      }
      location={locationSites > 0 ? { open: () => showTab("location"), sites: locationSites } : null}
      onRetry={() => actions.retry(phase.kind === "failed" && phase.retry === "source" ? "source" : "convert")}
      uploads={uploadNotes}
      chat={chat}
    />
  )
  const report = (chat: ReportChat | null) => (
    <>
      {caseReport(chat)}
      <FinalImportPanel result={finalResult} view={view} proposals={excelProposals} changes={contents} actions={proposalActions} busy={savingRule} />
      <AnswerImportPanel view={view} proposals={answerProposals} changes={contents} actions={proposalActions} busy={savingRule} />
    </>
  )
  /** チャットの流れの最後に出す「AI で案を出す」の結果と変更案 */
  const fixPanel = (
    <FixSuggestionPanel
      state={gyoshuSuggestion}
      proposals={fixProposals}
      changes={contents}
      view={view}
      actions={proposalActions}
      busy={savingRule}
      onRetry={canSuggest ? suggestGyoshu : null}
    />
  )

  const chatPanel = chatEnabled ? (
    <Suspense fallback={<div className="h-full" />}>
      <ChatPanel
        caseId={kase.id}
        ready={chatReady}
        empty={files.length === 0}
        request={chatRequest}
        proposals={work.proposals}
        changes={contents}
        view={view}
        actions={proposalActions}
        busy={savingRule}
        fx={fx}
        report={report}
        tail={fixPanel}
        onFiles={(fs) => void attach(fs)}
        onAction={onChatAction}
        onOpenTab={openTab}
        work={hasTable ? { shown: workShown, open: () => setWorkChoice(true) } : null}
        plan={work.plan?.plan ?? null}
        carryover={
          previous && {
            fiscalYear: previous.fiscalYear,
            // 去年の Excel があれば、読み終えて違いを文脈に入れられるまで待つ（読めなかった・無いときは待たない）
            ready: carryoverReady({
              previousSource: !!previous.source,
              currentSource: !!work.sourceFileId,
              previousSheets: previousSheets === null ? "loading" : "error" in previousSheets ? "error" : previousSide ? "loaded" : "noSheet",
              // 今年の元と計画はあるのに比べるシートが無いときは、違いを作れないので待たない
              formatDiff: formatDiff !== null ? true : source && plan && !grid ? "unavailable" : false,
            }),
            names: previousEngineerNames,
            headers: carryoverHeaders,
          }
        }
        onProposal={(r) => receiveProposal(store, r, "replace")}
        onCaseCost={actions.setCost}
        onCanSendChange={setChatCanSend}
        location={locationSearch}
        suggestions={[
          ...(todo.inquiry.left > 0
            ? answerHints.map((h) => ({
                id: h.fileId,
                fileName: h.name,
                text: `返ってきた Excel「${h.name}」に、色付きの欄の外（印の無いセル・別の列・メモ・別のシート）の記入や読めなかった記入があり、まだ答えの無い問い合わせが ${todo.inquiry.left} 件あります。`,
                label: "AI で読む",
                prompt: aiAnswerPrompt(h.name),
              }))
            : []),
          ...(inquiryHint && todo.inquiry.active > 0 && !pendingInquiryText && work.inquiryText.subject === null
            ? [
                {
                  id: INQUIRY_SUGGESTION,
                  text: `問い合わせ ${todo.inquiry.active} 件の、顧客へのメールの件名と前置きを AI が下書きできます。承認した文をメールに使います。`,
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
        ]}
        beforeSend={session.settle}
        onSuggestionSent={(id) => {
          if (id === REVIEW_SUGGESTION) actions.dropHint("review")
          else if (id === INQUIRY_SUGGESTION) {
            inquiryHintSent.current = true
            setInquiryHint(false)
          } else actions.dropHint({ fileId: id })
        }}
      />
    </Suspense>
  ) : null

  /**
   * 画面のどこにドラッグしたファイルも、📎と同じくアップロードする（重ねて開いた作業の画面も同じ要素の中）。
   * 印は、画面の外へ出た（relatedTarget が画面の中でない）・離した・ドラッグをやめた（窓の外を含む）ときに必ず消す
   */
  const [dragging, setDragging] = useState(false)
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files")
  useEffect(() => {
    if (!dragging) return
    const stop = () => setDragging(false)
    const leaveWindow = (e: DragEvent) => {
      if (!e.relatedTarget) stop()
    }
    window.addEventListener("drop", stop)
    window.addEventListener("dragend", stop)
    window.addEventListener("dragleave", leaveWindow)
    return () => {
      window.removeEventListener("drop", stop)
      window.removeEventListener("dragend", stop)
      window.removeEventListener("dragleave", leaveWindow)
    }
  }, [dragging])
  const dropFiles = {
    onDragEnter: (e: React.DragEvent) => {
      if (hasFiles(e)) setDragging(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
    },
    onDragOver: (e: React.DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (e.dataTransfer.files.length) void attach([...e.dataTransfer.files])
    },
  }

  /** 次にやることの段へ移る。答えるはチャットの最初の答えを待つものへ（狭い画面では作業の画面を閉じる） */
  function goStep(id: StepId) {
    if (id === "export") return setExportOpen(true)
    if (id === "inquiry") return showTab("inquiry")
    if (id === "gyoshu") return showTab("gyoshu")
    if (id === "fix") {
      setFilter({ kind: "fix" })
      return showTab("table")
    }
    goChat("[data-pending]")
  }
  /**
   * チャットの欄の target（無ければ最初の答えを待つもの）へ移り、その中の focus のボタンに合わせる（狭い画面では作業の画面を閉じる）。
   * 閉じた作業の画面・ダウンロードの前の確認がフォーカスを戻したあとに移る
   */
  function goChat(target: string, focus?: string) {
    if (!wide) setWorkChoice(false)
    requestAnimationFrame(() => {
      const t = chatTarget(target, focus)
      if (!t) return
      t.el.scrollIntoView({ block: "center", behavior: "smooth" })
      t.button?.focus({ preventScroll: true })
    })
  }
  /** チャットの欄の target（無ければ最初の答えを待つもの）と、その中の focus のボタン（決めたボタンが無ければ無し。ほかのボタン〔答え〕に合わせて Enter で答えないように） */
  function chatTarget(target: string, focus?: string) {
    const chat = '[data-testid="chat-column"]'
    const el = document.querySelector<HTMLElement>(`${chat} ${target}`) ?? document.querySelector<HTMLElement>(`${chat} [data-pending]`)
    return el && { el, button: el.querySelector<HTMLElement>(focus ?? "button:not([disabled])") }
  }
  /** ダウンロードの前の確認を閉じてから移る */
  const fromExport = (run: () => void) => () => {
    setExportOpen(false)
    run()
  }
  /** 閉じたあとにフォーカスを合わせる先（チャットへ移るとき。確認は閉じると開いたボタンにフォーカスを戻すので、その代わりに） */
  const exportFinalFocus = useRef<(() => HTMLElement | null) | null>(null)
  /** ダウンロードの前の確認を閉じてチャットの target へ移る */
  const exportToChat = (target: string, focus?: string) => () => {
    exportFinalFocus.current = () => chatTarget(target, focus)?.button ?? null
    setExportOpen(false)
    goChat(target, focus)
  }

  /**
   * ダウンロードの前の確認で答えるもの。報告の聞き返しはその場で答える（「表で見る」「AI に聞く」は確認を閉じて移る。AI に聞くはチャットのその聞き返しへ）。
   * チャットのものは「答える」に数えるもの（承認待ちの変更案・AI の聞き返し・一覧の外の業種の AI の案）と、この確認で答えて閉じたもの
   */
  const exportQuestions: ExportQuestion[] = questions.map((q) => ({
    question: { ...q, view: q.view && fromExport(q.view), prompt: undefined },
    // 報告と同じ条件（チャットが使え、返事の途中でない）で押せる
    go:
      q.prompt && chatEnabled
        ? { label: "AI に聞く", disabled: !chatCanSend, run: exportToChat(`[data-testid="case-report"] [data-question="${q.id}"]`, '[data-testid="report-question-ask"]:not([disabled])') }
        : null,
  }))
  const ANSWER_LABELS = { yes: "はい", no: "いいえ" } as const
  const exportChatAsks: ExportQuestion[] = [
    ...work.proposals.filter((p) => p.origin.kind !== "fix").flatMap(exportProposal),
    // 業種の AI の案は、一覧の外の行に未決があるものだけ（一覧の行は「業種を決める」に数える）
    ...work.proposals.filter((p) => p.origin.kind === "fix").flatMap(exportProposal),
  ]
  /** 変更案のうち、答えるもの（todo.ts が数えたもの）と、この確認で答えて閉じたもの */
  function exportProposal(p: Proposal): ExportQuestion[] {
    const item = todo.answer.find((a) => a.kind === "proposal" && a.proposalId === p.id)
    if (item?.kind === "proposal" && p.state === "open") return [exportChatAsk(p, item.waiting)]
    return p.state === "closed" && p.origin.kind !== "fix" && p.origin.kind !== "location" && p.question?.answer ? [exportAnswered(p, p.question.text, p.question.answer)] : []
  }
  /** この確認で答えて閉じたもの（いいえで全部を却下）。チャットのカードと同じく、取り消せる記録があれば取り消せる */
  function exportAnswered(p: Proposal, text: string, a: "yes" | "no"): ExportQuestion {
    return { question: { id: `${EXPORT_PROPOSAL}${p.id}`, text, options: [], answered: ANSWER_LABELS[a], undo: undoState(p.id)?.can ? () => undoProposal(p.id) : null }, go: null }
  }
  /** 答えるものの変更案（waiting は todo.ts が数えた承認待ちの項目の数） */
  function exportChatAsk(p: OpenProposal, waiting: number): ExportQuestion {
    const id = `${EXPORT_PROPOSAL}${p.id}`
    const go = (label: string) => ({ label, run: exportToChat(`[data-proposal="${p.id}"]`) })
    const q = p.question
    // 変更案の付いた聞き返しはここで答える（はいで承認できるようになり、いいえで全部を却下）。変更案の無い聞き返しは答えを AI に送るのでチャットで
    if (q && q.answer === null)
      return p.count > 0
        ? { question: { id, text: q.text, detail: `${PROPOSAL_ORIGIN[p.origin.kind]}（${p.count} 件）は、答えてからチャットで承認します`, options: [{ value: "no", label: "いいえ" }, { value: "yes", label: "はい" }], answered: null }, go: go("チャットで見る") }
        : { question: { id, text: q.text, detail: "答えると AI が続けます", options: [], answered: null }, go: go("チャットで答える") }
    return { question: { id, text: `${PROPOSAL_ORIGIN[p.origin.kind]}の承認待ち ${waiting} 件`, detail: "中身をチャットで確かめて、承認か却下します", options: [], answered: null }, go: go("チャットで確かめる") }
  }
  function answerFromExport(id: string, value: string) {
    if (!id.startsWith(EXPORT_PROPOSAL)) return answerReport(id, value)
    if (value === "yes" || value === "no") proposalActions.answer(id.slice(EXPORT_PROPOSAL.length), value)
  }

  /** 作業の画面（表と、7割・問い合わせ・工事場所・一括置換のタブ）。広い画面ではチャットの右、狭い画面では上に重ねて開く */
  const workPanel =
    hasTable && output && shown ? (
      <section className="flex h-full min-h-0 flex-col bg-background" aria-label="作業の画面" data-testid="work-panel">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-xs" data-testid="case-toolbar">
          <FileChips files={files} sourceFileId={work.sourceFileId} loading={!!loadingSource || planning} onChoose={chooseSource} />
          {source && grid && plan && source.sheets.length > 1 && (
            <SheetChooser sheets={source.sheets} primary={grid} plan={plan} onPrimary={(name) => void actions.startPlanning(source, name)} onChange={actions.changePlan} />
          )}
          <div className="ml-auto flex min-w-0 items-center gap-1">
            <NextSteps steps={todo} onGo={goStep} exportDisabled={reconverting} />
            <Button size="icon-sm" variant="ghost" onClick={() => setWorkChoice(false)} aria-label="作業の画面を閉じる" title="作業の画面を閉じる（チャットの「表を開く」で開き直せます）" data-testid="work-close">
              {wide ? <PanelRightClose /> : <X />}
            </Button>
          </div>
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as WorkTab)} className="min-h-0 flex-1 gap-0">
          <TabsList variant="line" className="h-10 w-full shrink-0 justify-start overflow-x-auto rounded-none border-b px-3" aria-label="作業">
            {WORK_TABS.map((t) => {
              const badge = tabBadge(todo, t.id)
              return (
                <TabsTrigger key={t.id} value={t.id} className="flex-none px-2.5" data-testid={`tab-${t.id}`}>
                  {t.label}
                  {badge > 0 && <span className="num rounded-full bg-muted px-1.5 text-xs">{badge}</span>}
                </TabsTrigger>
              )
            })}
          </TabsList>
          <TabsContent value="table" keepMounted className="relative flex min-h-0 flex-col p-4" data-testid="table-section">
            {reconverting && (
              <div className="absolute inset-0 z-30 flex items-start justify-center bg-background/60 pt-24 backdrop-blur-[1px]" data-testid="reconverting">
                <span className="flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm shadow-sm">
                  <Loader2 className="size-4 animate-spin text-violet-600" /> 列の対応を変えたので変換し直しています…
                </span>
              </div>
            )}
            {output.length === 0 && (
              <p className="mb-3 text-sm text-muted-foreground" data-testid="no-rows-note">
                載せる行がありません
              </p>
            )}
            <PreviewTable
              spec={SPEC}
              rows={shown}
              inclusion={inclusion}
              openEditor={(cell) => editSession(cell, letters)}
              onEdit={edit}
              onToggle={(key, included) => update("manual", (prev) => new Map(prev).set(key, included))}
              onToggleRange={toggleRange}
              selection={selectionMode}
              onSelection={changeSelection}
              allHint={allHint}
              filter={tableFilter}
              onFilterChange={setFilter}
              fixes={rowFixes}
              counts={todo.fix}
              asks={askRows}
              onOpenInquiry={() => showTab("inquiry")}
              onFixAction={runFixAction}
              onConfirm={confirmCell}
              confirmUndo={lastConfirmUndo ? () => undoProposal(lastConfirmUndo.proposalId, `「${CONFIRM_LABEL}」`) : null}
            />
          </TabsContent>
          <TabsContent value="gyoshu" keepMounted className="min-h-0 overflow-auto p-4">
            <GyoshuPanel
              items={todo.gyoshu.rows}
              choices={GYOSHU_CHOICES}
              onDecide={decideGyoshu}
              suggest={{ run: suggestGyoshu, blocked: suggestBlocked, running: gyoshuSuggestion.running, last: gyoshuSuggestion.last }}
              undo={lastGyoshuUndo ? { count: lastGyoshuUndo.edits.length, onUndo: () => undoProposal(lastGyoshuUndo.proposalId, "業種の決定") } : null}
            />
          </TabsContent>
          <TabsContent value="selection" keepMounted className="min-h-0 overflow-auto p-4" data-testid="selection-section">
            <SelectionPanel
              rounding={rounding}
              onRounding={(r) => set("rounding", r)}
              tax={tax}
              onTax={(t) => setWork((w) => setTax(w, t, "staff"))}
              rule7Tax={rule7Tax}
              onRule7Tax={(t) => set("rule7Tax", t)}
              selection={selectionMode}
              onSelection={changeSelection}
              manualCount={manual.size}
              onClearManual={() => set("manual", new Map())}
              roundingTotals={roundingTotals}
            >
              <GyoshuSummaryTable summary={summary} basis={basis} rule7Tax={rule7Tax} onBasisChange={(code, side, v) => update("basis", (prev) => ({ ...prev, [code]: { ...prev[code], [side]: v } }))} />
            </SelectionPanel>
          </TabsContent>
          <TabsContent value="inquiry" keepMounted className="min-h-0 overflow-auto px-4 pt-2 pb-4">
            <InquiryPanel
              inquiries={inquiries}
              allRows={shown}
              dismissed={dismissed}
              answers={answers}
              text={work.inquiryText}
              onText={(next) => update("inquiryText", next)}
              attachment={attachment}
              onDownload={downloadInquiry}
              onToggle={(key, ask) =>
                update("dismissed", (prev) => {
                  const next = new Set(prev)
                  if (ask) next.delete(key)
                  else next.add(key)
                  return next
                })
              }
            />
          </TabsContent>
          <TabsContent value="location" keepMounted className="min-h-0 overflow-auto p-4">
            {view && <LocationPanel search={locationSearch} view={view} proposals={locationProposals} changes={contents} actions={proposalActions} busy={savingRule} fx={fx} />}
          </TabsContent>
          <TabsContent value="replace" keepMounted className="min-h-0 overflow-auto p-4" data-testid="replace-details">
            <ReplacePanel spec={SPEC} rows={rows!} letters={letters} replacements={replacements} onChange={replace} />
          </TabsContent>
        </Tabs>
      </section>
    ) : null
  /** 作業の画面をチャットの横に並べるか（狭い画面では重ねて開く） */
  const workInline = wide && workShown && !!workPanel
  /** 狭い画面で作業の画面を重ねて開いているか（開いている間はうしろのチャットと見出しを触れなくする） */
  const workOverlay = !wide && workShown && !!workPanel
  /** 重ねて開いたときは作業の画面へ、閉じたら開く前の場所へフォーカスを戻す */
  const workFrame = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!workOverlay) return
    const before = document.activeElement as HTMLElement | null
    workFrame.current?.focus()
    return () => before?.focus()
  }, [workOverlay])
  const noChatInput = useRef<HTMLInputElement>(null)

  return (
    <AppShell tool={CSV} fill>
      <div className="relative flex min-h-0 flex-1 flex-col" {...dropFiles}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 sm:px-6" inert={workOverlay}>
          <div className="min-w-0">
            <nav className="flex gap-1 text-xs text-muted-foreground">
              <Link to="/csv" className="hover:underline">
                顧客
              </Link>
              <span>/</span>
              <Link to="/csv/customers/$customerId" params={{ customerId: customer.id }} className="truncate hover:underline">
                {customer.name}
              </Link>
            </nav>
            <h1 className="truncate text-lg font-semibold tracking-tight">{`${customer.name} ${kase.fiscalYear}年度`}</h1>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SaveIndicator status={saveStatus} peer={peer} />
            <Segmented label="案件の状態" value={status} options={CASE_STATUSES.map((s) => ({ value: s, label: CASE_STATUS_LABELS[s] }))} onChange={(s) => void actions.changeStatus(s)} testId="case-status" />
            <CaseMenu usd={costUsd} fx={fx} onDelete={() => setDeleteOpen(true)} />
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className={cn("min-h-0 min-w-0", workInline ? "w-[400px] shrink-0 border-r 2xl:w-[440px]" : "mx-auto w-full max-w-3xl xl:border-x")} inert={workOverlay} data-testid="chat-column">
            {chatPanel ?? (
              // チャットが使えない（APIキーが無い）ときは、報告と📎と同じアップロードの入口をチャットの代わりに出す
              <div className="grid h-full content-start gap-3 overflow-auto p-4">
                {report(null)}
                <Button size="sm" className="w-fit" onClick={() => noChatInput.current?.click()} data-testid="chat-attach">
                  <Paperclip /> アップロード
                </Button>
                <input
                  ref={noChatInput}
                  type="file"
                  multiple
                  accept={ATTACH_ACCEPT}
                  className="sr-only"
                  data-testid="chat-file-input"
                  onChange={(e) => {
                    if (e.target.files?.length) void attach([...e.target.files])
                    e.target.value = ""
                  }}
                />
              </div>
            )}
          </div>
          {/*
            作業の画面は表がある間ずっと置いたまま、閉じても隠すだけにする（表の検索・並べ替え・表示する列・工事場所の調査・置換の欄を消さない）。
            広い画面ではチャットの右、狭い画面では画面の上に重ねる。幅が変わっても同じ要素のまま
          */}
          {workPanel && (
            <div
              ref={workFrame}
              hidden={!workShown}
              tabIndex={-1}
              className={cn("min-h-0 min-w-0 outline-none", wide ? "flex-1" : "fixed inset-0 z-50 bg-background shadow-xl")}
              {...(wide ? {} : { role: "dialog", "aria-modal": true, "aria-label": "作業の画面" })}
              onKeyDown={(e) => {
                // 重ねて開いたときの Escape で閉じる。中の欄が済ませた Escape（セルの手直しをやめるなど。preventDefault の印）と、
                // 画面の外に開いたメニューの Escape は見送る
                if (wide || e.key !== "Escape" || e.defaultPrevented || !e.currentTarget.contains(e.target as Node)) return
                setWorkChoice(false)
              }}
              data-testid="work-frame"
            >
              {workPanel}
            </div>
          )}
        </div>

        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-violet-400 bg-violet-50/70 text-sm font-medium text-violet-800 dark:bg-violet-950/60 dark:text-violet-200" data-testid="drop-overlay">
            <FileUp className="mr-2 size-5" /> 離すとアップロードします
          </div>
        )}
      </div>

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        target={{ caseId: kase.id }}
        title={`${kase.fiscalYear}年度の案件`}
        customerName={customer.name}
        onDeleted={() => router.navigate({ to: "/csv/customers/$customerId", params: { customerId: customer.id } })}
      />

      {output && (
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          output={output}
          summary={summary}
          basis={basis}
          rule7Tax={rule7Tax}
          onBasisChange={(code, side, v) => update("basis", (prev) => ({ ...prev, [code]: { ...prev[code], [side]: v } }))}
          onExcel={() => void downloadFinalExcel()}
          onCsv={downloadCsv}
          steps={todo}
          onGo={(id) => (id === "answer" ? exportToChat("[data-pending]") : fromExport(() => goStep(id)))()}
          finalFocus={() => {
            const f = exportFinalFocus.current
            exportFinalFocus.current = null
            return f?.() ?? true
          }}
          onFixAction={(action, keys) => {
            setExportOpen(false)
            runFixAction(action, keys)
          }}
          questions={exportQuestions}
          amountsUnsettled={tax === "unknown"}
          chatAsks={exportChatAsks}
          onAnswer={answerFromExport}
        />
      )}

      <AlertDialog open={!!confirmAsk} onOpenChange={(open) => !open && setConfirmAsk(null)}>
        <AlertDialogContent data-testid="ask-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAsk?.title}</AlertDialogTitle>
            <AlertDialogDescription className="grid gap-1">
              {confirmAsk?.lines.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="ask-confirm-cancel">やめる</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmAsk) answerAsk(confirmAsk.id, "exclude")
                setConfirmAsk(null)
              }}
              data-testid="ask-confirm-ok"
            >
              {confirmAsk?.option}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingSource} onOpenChange={(open) => !open && setPendingSource(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>変換の元を「{pendingSource?.name}」にしますか</AlertDialogTitle>
            <AlertDialogDescription>
              今の変換の結果と手直しは消えます（設定は残ります）。参考に付けるだけなら「付けるだけ」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="source-keep">付けるだけ</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingSource) void actions.openSource(pendingSource, true)
                setPendingSource(null)
              }}
              data-testid="source-replace"
            >
              変換の元にする
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  )
}

/** 7割と金額の設定（Excel の金額が税込か・端数・載せる工事）と業種ごとの件数と7割 */
function SelectionPanel(p: {
  rounding: Rounding
  onRounding: (r: Rounding) => void
  tax: TaxMode
  onTax: (t: TaxMode) => void
  rule7Tax: Rule7Tax
  onRule7Tax: (t: Rule7Tax) => void
  selection: CaseWork["selection"]
  onSelection: (m: CaseWork["selection"]) => void
  manualCount: number
  onClearManual: () => void
  roundingTotals: { floor: number; round: number } | null
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Field label="Excel の金額" hint="顧客の Excel の金額が税込か税抜か。7割の計算と違えば 1.1 で掛け割りして比べます（金額は変えません）">
          <Segmented label="Excel の金額" value={p.tax} options={(Object.keys(TAX_LABELS) as TaxMode[]).map((v) => ({ value: v, label: TAX_LABELS[v] }))} onChange={p.onTax} testId="tax" />
        </Field>
        <Field label="7割の計算" hint="決算書の完成工事高（基準額）が税抜か税込か。初期値は全体ルールの画面の設定">
          <Segmented label="7割の計算" value={p.rule7Tax} options={(Object.keys(RULE7_TAX_LABELS) as Rule7Tax[]).map((v) => ({ value: v, label: RULE7_TAX_LABELS[v] }))} onChange={p.onRule7Tax} testId="rule7-tax" />
        </Field>
        <Field label="千円未満">
          <Segmented label="千円未満の端数" value={p.rounding} options={ROUNDINGS.map((value) => ({ value, label: ROUNDING_LABELS[value] }))} onChange={p.onRounding} testId="rounding" />
        </Field>
        <Field label="載せる工事" hint="7割ルール: 業種ごとに、元請を金額の大きい順に元請の基準額の7割を超えるまで、続いて残りを合計の基準額の7割を超えるまで載せます。軽微な工事（税込500万円未満、建築一式は1,500万円未満）は10件まで。全件: 7割以上なら件数は自由。顧客が絞ったデータもこちら">
          <Segmented label="載せる工事" value={p.selection} options={SELECTION_MODES.map((m) => ({ value: m, label: SELECTION_LABELS[m] }))} onChange={p.onSelection} testId="selection" />
        </Field>
        {p.manualCount > 0 && (
          <Button variant="outline" size="sm" onClick={p.onClearManual}>
            手動の入れ外し（{p.manualCount}件）を戻す
          </Button>
        )}
      </div>
      {p.roundingTotals && <RoundingNote floor={p.roundingTotals.floor} round={p.roundingTotals.round} current={p.rounding} />}
      {p.children}
      {p.tax === "unknown" && (
        <p className="text-xs font-semibold text-muted-foreground" data-testid="tax-unknown-note">
          Excel の金額が分からないので、税込とみなして判定しています。
        </p>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5" title={hint}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

/**
 * 見出しの「…」: 案件の AI の費用の合計と削除。費用が10ドルを超えたら、ボタンにも注意を出す（止めない）
 */
function CaseMenu({ usd, fx, onDelete }: { usd: number; fx: UsdJpy | null; onDelete: () => void }) {
  const over = usd > CASE_COST_NOTICE_USD
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="案件のメニュー" title={over ? `この案件の AI の費用が ${CASE_COST_NOTICE_USD} ドルを超えました` : "案件のメニュー"} data-testid="case-menu" data-over={over || undefined} />}
      >
        {over ? <TriangleAlert className="text-amber-600" /> : <Ellipsis />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className={over ? "font-medium text-amber-700" : undefined} data-testid="case-cost" data-over={over || undefined}>
            この案件の AI の費用 <Cost usd={usd} fx={fx} />
            {over && <span className="block">{CASE_COST_NOTICE_USD} ドルを超えました（止めません）</span>}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete} data-testid="delete-button">
          <Trash2 /> 案件を削除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * 保存の状態（保存できないときだけ目立たせる）と、同じブラウザの別のタブ（sync.ts）。別のタブで開いている・保存したことは、ぶつかる前に出す
 * （保存がもう止まっている〔別の画面が先に保存した・削除〕ときは、保存の状態の文だけ）
 */
function SaveIndicator({ status, peer }: { status: SaveStatus; peer: PeerState }) {
  const text = {
    saved: "保存しました",
    pending: "保存しています…",
    failed: status.kind === "failed" ? `保存できませんでした（${status.message}）。少し待って送り直します` : "",
    conflict: "別の画面でこの案件が保存されました。再読み込みしてください（この画面の変更は保存しません）",
    tooLarge: "案件の状態が大きすぎて保存できません（次の変更で送り直します）",
    gone: "この案件は削除されたか、削除の途中です（この画面の変更は保存しません）",
  }[status.kind]
  // 保存できているあいだは目立たせない（読み上げには伝える）。保存できないときだけ目立たせる
  const quiet = status.kind === "saved" || status.kind === "pending"
  const stopped = status.kind === "conflict" || status.kind === "gone"
  const peerText = {
    none: null,
    open: "別のタブでもこの案件を開いています（両方で変えると、あとから保存した方は保存できません）",
    saved: "別のタブでこの案件が保存されました。再読み込みしてください（この画面で変えても保存できません）",
  }[peer]
  return (
    <>
      <span role="status" className={quiet ? "sr-only" : "basis-full text-xs font-medium text-red-700"} data-testid="save-status" data-status={status.kind}>
        {text}
      </span>
      {peerText && !stopped && (
        <span role="status" className={cn("basis-full text-xs font-medium", peer === "saved" ? "text-red-700" : "text-amber-700")} data-testid="peer-status" data-peer={peer}>
          {peerText}
        </span>
      )}
    </>
  )
}

/** 案件に付けたファイル（小さく並べる）。表になる届いたファイル（Excel・CSV）は変換の元に選べる（PDF は保存と一覧だけ） */
function FileChips({ files, sourceFileId, loading, onChoose }: { files: CaseFile[]; sourceFileId: string | null; loading: boolean; onChoose: (f: CaseFile) => void }) {
  if (!files.length) return null
  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs" data-testid="file-list">
      {files.map((f) => (
        <li
          key={f.id}
          className={cn("flex max-w-72 items-center gap-1.5 rounded-lg border px-2 py-1", f.id === sourceFileId && "border-violet-300 bg-violet-50 dark:bg-violet-950/30")}
          data-file={f.name}
          data-kind={f.kind}
          title={`${FILE_KIND_LABELS[f.kind]}・${formatSize(f.size)}`}
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <a href={fileUrl(f.id)} className="truncate hover:underline" download={f.name}>
            {f.name}
          </a>
          {f.id === sourceFileId ? (
            <span className="shrink-0 font-medium text-violet-700" data-testid="current-source">
              変換の元
            </span>
          ) : (
            f.kind === "source" &&
            isSheetFile(f.name) && (
              <Button variant="ghost" size="xs" disabled={loading} onClick={() => onChoose(f)}>
                変換の元にする
              </Button>
            )
          )}
        </li>
      ))}
    </ul>
  )
}

const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** 計画の元にするシートを選び直す（計画を立て直す）と、見出しが同じシートを変換に足す */
function SheetChooser({ sheets, primary, plan, onPrimary, onChange }: { sheets: SheetGrid[]; primary: SheetGrid; plan: Plan; onPrimary: (name: string) => void; onChange: (p: Plan) => void }) {
  const others = sheets.filter((s) => s !== primary && sameHeader(s, primary, plan.headerRow))
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="sheet-picker">
      <NativeSelect id="sheet" aria-label="計画の元にするシート" className="h-8 text-xs" value={primary.name} onChange={(e) => onPrimary(e.target.value)}>
        {sheets.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}（{s.rows.length}行）
          </option>
        ))}
      </NativeSelect>
      {others.map((s) => (
        <label key={s.name} className="flex items-center gap-1" title="見出しが同じシート（選ぶと行を結合します）">
          <input
            type="checkbox"
            checked={plan.sheets.includes(s.name)}
            onChange={(e) => onChange({ ...plan, sheets: e.target.checked ? [...plan.sheets, s.name] : plan.sheets.filter((n) => n !== s.name) })}
          />
          ＋{s.name}
        </label>
      ))}
    </div>
  )
}
