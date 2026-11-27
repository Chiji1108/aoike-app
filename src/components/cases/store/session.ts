import type { UploadNote } from "@/components/cases/case-report"
import type { WorkTab } from "@/components/cases/work-tabs"
import type { StepId } from "@/lib/cases/steps"
import type { FixActionId, TableFilter } from "@/components/convert/status"
import type { GyoshuDecision } from "@/components/convert/gyoshu-panel"
import { caseContext, NO_SOURCE_CONTEXT } from "@/lib/chat/context"
import type { ChatAction } from "@/lib/chat/messages"
import { toWire } from "@/lib/chat/wire"
import type { CellEdit } from "@/lib/convert/convert"
import type { Rule7Tax, SelectionMode, TaxMode } from "@/lib/convert/koji-selection"
import { sheetShapeOf } from "@/lib/convert/plan-patch"
import type { Rounding } from "@/lib/convert/transforms"
import type { InquiryText } from "@/lib/inquiry/text"
import type { ProposalRecord } from "@/lib/chat/proposals"
import { addressCache } from "@/lib/convert/address"
import type { FileKind, CaseFile, CaseStatus } from "@/lib/cases/types"
import type { MappingPlan, SheetGrid } from "@/lib/convert/plan"
import type { KojiFieldId } from "@/lib/spec/koji-keireki"
import { changeStatus } from "./actions/case"
import { downloadCsv, downloadFinalExcel, downloadInquiry } from "./actions/download"
import { attach, chooseSource, confirmSource, importAnswers, importFinal, keepFile, note } from "./actions/files"
import { decideProposal, receiveProposal } from "./actions/proposals"
import * as table from "./actions/table"
import * as ui from "./actions/ui"
import { addCost, changePlan, convert, ensureAddresses, loadPreviousSheets, needsConversion, openSource, retry, setCost, startPlanning, supersedeConversion } from "./actions/source"
import { createCaseView } from "./case-view"
import { createCaseStore, initialCaseState, setRuntime, setUi, type CaseState, type ChatSize, type ChatTarget, type Source } from "./create-case-store"
import type { CaseDeps } from "./deps"
import type { CaseEnv, SessionPage } from "./env"
import { createCaseSync, type PeerChannel } from "./sync"
import { createTableDerive } from "./table"

/**
 * 案件の画面の1回分（案件ごとに1つ。CaseWorkspace が作る）: ストア・表の派生・待つ処理（action）・保存と同期をまとめる。
 * 自動の処理（住所の値が変わったら引く・計画が決まって変換していなければ変換する）は、画面の effect ではなくストアの変化を見て始める
 */
export function createCaseSession(page: SessionPage, deps: CaseDeps, channel: () => PeerChannel | null) {
  const store = createCaseStore(initialCaseState(page, deps.chatPrefs.load()))
  const addresses = addressCache(deps.lookupAddresses)
  const config = { chatEnabled: page.chatEnabled, excelKey: page.excelKey, caseId: page.kase.id, customerName: page.customer.name, previous: page.previous }
  const tableOf = createTableDerive(addresses)
  const env: CaseEnv = {
    store,
    deps,
    config,
    table: tableOf,
    view: createCaseView(tableOf, config),
    addresses,
    previousLoad: { current: null },
  }
  const sync = createCaseSync(store, { caseId: page.kase.id, save: deps.saveState, version: page.state?.version ?? 0, saved: page.state ? store.getState().work : null, channel })

  const actions = {
    openSource: (file: CaseFile, replan: boolean) => openSource(env, file, replan),
    startPlanning: (src: Source, requiredSheet?: string) => startPlanning(env, src, requiredSheet),
    changePlan: (p: MappingPlan<KojiFieldId>) => changePlan(env, p),
    retry: (what: "source" | "convert") => retry(env, what),
    supersedeConversion: () => void supersedeConversion(env),
    keepFile: (kind: FileKind, blob: Blob, name: string) => keepFile(env, kind, blob, name),
    note: (n: UploadNote) => note(env, n),
    importFinal: (f: File, sheets: readonly SheetGrid[]) => importFinal(env, f, sheets),
    importAnswers: (f: File, kind: "marked" | "answer") => importAnswers(env, f, kind),
    decideProposal: (id: string, indices: number[], decision: "applied" | "rejected") => decideProposal(env, id, indices, decision),
    /** 取り消して（計画を戻したら変換し直す）結果を知らせる（what は通知の言葉。承認・答え・業種の決定など） */
    undoWithNotice: (group: string, what?: string) => table.undoWithNotice(env, group, what),
    /** サーバーが置いた変更案の記録を足す（もう作業にあれば足さない。決め終わったものを開き直さない） */
    receiveRecorded: (r: ProposalRecord) => receiveProposal(store, r, "ifUnknown"),
    /** チャットの返事の変更案（同じ id があれば置き換えて最後に回す） */
    receiveChat: (r: ProposalRecord) => receiveProposal(store, r, "replace"),
    answerProposal: (id: string, a: "yes" | "no") => table.answerProposal(env, id, a),
    changeStatus: (s: CaseStatus) => changeStatus(env, s),
    addCost: (usd: number) => addCost(env, usd),
    setCost: (usd: number) => setCost(env, usd),
    // ファイル
    attach: (files: readonly File[]) => attach(env, files),
    chooseSource: (f: CaseFile) => chooseSource(env, f),
    confirmSource: (fileId: string, yes: boolean) => confirmSource(env, fileId, yes),
    downloadCsv: () => downloadCsv(env),
    downloadFinalExcel: () => downloadFinalExcel(env),
    downloadInquiry: () => downloadInquiry(env),
    // 表の手直し・業種・7割と金額・報告の聞き返し（actions/table.ts）
    editCells: (rowKey: string, changes: readonly [KojiFieldId, CellEdit][]) => table.editCells(env, rowKey, changes),
    replaceValue: (field: KojiFieldId, from: string, text: string) => table.replaceValue(env, field, from, text),
    toggleRow: (key: string, included: boolean) => table.toggleRow(env, key, included),
    toggleRange: (keys: readonly string[], included: boolean, skipped: number) => table.toggleRange(env, keys, included, skipped),
    confirmCell: (rowKey: string, field: KojiFieldId) => table.confirmCell(env, rowKey, field),
    decideGyoshu: (decisions: readonly GyoshuDecision[], how: "plan" | "pick") => table.decideGyoshu(env, decisions, how),
    changeSelection: (mode: SelectionMode) => table.changeSelection(env, mode),
    toggleInquiry: (key: string, ask: boolean) => table.toggleInquiry(env, key, ask),
    setInquiryText: (next: (prev: InquiryText) => InquiryText) => table.setInquiryText(env, next),
    setTax: (t: TaxMode) => table.setTaxMode(env, t),
    setRule7Tax: (t: Rule7Tax) => table.setRule7Tax(env, t),
    setRounding: (r: Rounding) => table.setRounding(env, r),
    setBasis: (code: string, side: "total" | "motouke", v: number | undefined) => table.setBasis(env, code, side, v),
    clearManual: () => table.clearManual(env),
    closeAllHint: () => table.closeAllHint(env),
    answerReport: (id: string, value: string) => table.answerReport(env, id, value),
    closeAskConfirm: (ok: boolean) => table.closeAskConfirm(env, ok),
    // 画面（actions/ui.ts）
    setWide: (wide: boolean) => ui.setWide(env, wide),
    setTab: (t: WorkTab) => ui.setTab(env, t),
    showTab: (t: WorkTab) => ui.showTab(env, t),
    setWorkShown: (open: boolean) => ui.setWorkShown(env, open),
    openTab: (t: WorkTab, how: "auto" | "click") => ui.openTab(env, t, how),
    setFilter: (f: TableFilter) => ui.setFilter(env, f),
    viewAsk: (askId: string) => ui.viewAsk(env, askId),
    goChat: (to: ChatTarget) => ui.goChat(env, to),
    goStep: (id: StepId) => ui.goStep(env, id),
    runFixAction: (action: FixActionId, keys: readonly string[]) => ui.runFixAction(env, action, keys),
    chatAction: (a: ChatAction) => ui.chatAction(env, a),
    openExport: () => ui.openExport(env),
    setDeleteOpen: (open: boolean) => ui.setDeleteOpen(env, open),
    setDownloadsOpen: (open: boolean) => ui.setDownloadsOpen(env, open),
    setDragging: (dragging: boolean) => ui.setDragging(env, dragging),
    setChatCanSend: (canSend: boolean) => ui.setChatCanSend(env, canSend),
    suggestionSent: (id: string) => ui.suggestionSent(env, id),
    setChatOpen: (open: boolean) => ui.setChatOpen(env, open),
    resizeChat: (size: ChatSize | null, save: boolean) => ui.resizeChat(env, size, save),
    chatArrived: (tone: "new" | "error") => ui.chatArrived(env, tone),
    dismissChatHint: () => ui.dismissChatHint(env),
  }

  /** 今の表（チャットと工事場所の調査に送る。大きいので送るときだけ、その時点の状態から作る） */
  const tableWire = () => {
    const { work: w } = store.getState()
    const { rows } = env.table(store.getState())
    return rows ? toWire({ rows, added: w.added, edits: w.edits, replacements: w.replacements, manual: w.manual, tax: w.tax, basis: w.basis, rule7Tax: w.rule7Tax, selection: w.selection, rounding: w.rounding, dismissed: w.dismissed, inquiryText: w.inquiryText }) : null
  }

  /** チャットに送る表と文脈（送る瞬間の状態から作る。送れないときは null） */
  const chatRequest = () => {
    const s = store.getState()
    const { rows, grid, plan } = env.table(s)
    const { chatReady, formatDiff } = env.view(s)
    const { source } = s.runtime
    const { previous } = config
    if (!rows || !chatReady) return null
    return {
      table: tableWire()!,
      context: source && grid && plan ? caseContext(source.sheets, grid, plan, previous && formatDiff ? { fiscalYear: previous.fiscalYear, lines: formatDiff.lines } : undefined) : NO_SOURCE_CONTEXT,
      sourceFileId: s.work.sourceFileId,
      plan: grid && s.work.plan ? { plan: s.work.plan.plan, shape: sheetShapeOf(grid) } : null,
    }
  }

  /** 去年と今年の元の Excel の見出し（「去年のやり方で直す」で、去年のコードの文字列のうち見出しの名前は伏せない） */
  const carryoverHeaders = () => {
    const s = store.getState()
    const { previousSide } = env.view(s)
    const { grid, plan } = env.table(s)
    const prevHeader = previousSide?.sheets.find((x) => x.name === previousSide.sheet)?.rows[previousSide.headerRow] ?? []
    const curHeader = grid && plan ? (grid.rows[plan.headerRow] ?? []) : []
    return [...new Set([...prevHeader, ...curHeader].map((h) => h.trim()).filter(Boolean))]
  }
  /** 去年の元の Excel の配置技術者の列の値（「去年のやり方で直す」で去年のコードから個人名を消す。去年の計画のシートと列があるときだけ） */
  const carryoverNames = () => {
    const { previous } = config
    const { previousSide } = env.view(store.getState())
    if (!previous || !previousSide || previousSide.sheet !== previous.sheet || previous.headerRow === null) return []
    const rows = previousSide.sheets.find((x) => x.name === previousSide.sheet)?.rows.slice(previous.headerRow + 1) ?? []
    return [...new Set(rows.flatMap((r) => previous.engineerColumns.map((c) => (r[c] ?? "").trim()).filter(Boolean)))].slice(0, 20_000)
  }

  return {
    store,
    table: env.table,
    view: env.view,
    config,
    actions,
    tableWire,
    chatRequest,
    carryoverHeaders,
    carryoverNames,
    settle: sync.settle,
    /**
     * 画面につなぐ（保存の層・別のタブとの道・自動で始める処理）。変換の元をまだ読んでいなければ読み、計画が無ければ立てる。去年の Excel も読み始める。
     * 返す関数で外す: 自動保存は待っている変更を送ってそのあとは受けず、自動で始める処理をやめ、世代を上げて待っている元・計画・変換の結果を捨てる
     * （画面を離れたあとに AI の結果を入れて保存しない。開き直した画面が読み直す）
     */
    connect() {
      const disconnectSync = sync.connect()
      const unwatch = watch(env)
      const { work, runtime } = store.getState()
      const file = runtime.files.find((f) => f.id === work.sourceFileId)
      if (file && (!runtime.source || (!work.plan && env.config.chatEnabled))) void openSource(env, file, !work.plan)
      // 去年の Excel は開いたときから読み始める（計画の AI に添えるのと、去年との違いに使う。1回だけ読む）
      void loadPreviousSheets(env)
      return () => {
        unwatch()
        setRuntime(store, (r) => ({
          gen: { ...r.gen, source: r.gen.source + 1, case: r.gen.case + 1, conversion: r.gen.conversion + 1 },
          loading: null,
          planDraft: null,
          converting: false,
        }))
        disconnectSync()
      }
    },
  }
}

export type CaseSession = ReturnType<typeof createCaseSession>
export type CaseActions = CaseSession["actions"]

/**
 * ストアの変化を見て始める処理（前の画面の effect の代わり。どの action のあとでも漏れない）:
 * 住所の値の集まりが変わったら新しい値を引き、計画が決まって変換していなければ変換する（計画が変わったときも）。
 * 作業の画面で問い合わせのタブを開いたら、問い合わせのメールの下書きの案内を出す。チャットが見えたら未読の印を消す。
 * 変化を知らせている最中にストアを変えないよう、次の microtask で今の状態を確かめてから始める
 */
function watch(env: CaseEnv): () => void {
  const { store } = env
  let watching = true
  let lastSig: string | null = null
  let lastNeeds = false
  let lastPlan = store.getState().work.plan
  let hintSaved = false
  const check = (s: CaseState) => {
    const t = env.table(s)
    if (t.addressSig !== lastSig) {
      lastSig = t.addressSig
      const values = t.addressValues
      if (values)
        queueMicrotask(() => {
          if (watching) void ensureAddresses(env, values)
        })
    }
    const needs = needsConversion(env, s)
    const planChanged = s.work.plan !== lastPlan
    if (needs && (!lastNeeds || planChanged))
      queueMicrotask(() => {
        if (watching && needsConversion(env, store.getState())) void convert(env)
      })
    lastNeeds = needs
    lastPlan = s.work.plan
    // チャットが見えている（窓を開いた・中央に大きく出した）なら未読の印を消す（たたんだまま作業の画面を閉じた・狭い画面になったときも）
    if (s.ui.chat.unread && !env.view(s).layout.chatCollapsed)
      queueMicrotask(() => {
        const now = store.getState()
        if (watching && now.ui.chat.unread && !env.view(now).layout.chatCollapsed) setUi(store, (u) => ({ chat: { ...u.chat, unread: null } }))
      })
    // 「チャットはここにあります」を初めて出したら、端末に覚える（次に開いたときは出さない。この画面では消すまで出す）
    if (!hintSaved && s.ui.chat.hint && env.view(s).layout.chat === "window" && !s.ui.chat.collapsed) {
      hintSaved = true
      queueMicrotask(() => {
        if (watching) ui.saveChatPrefs(env, { hintShown: true })
      })
    }
    // 作業の画面で問い合わせのタブを見たら、チャットに「AI でメールの下書きを作る」を出す（一度送ったら、この画面では出さない）
    if (s.runtime.hints.inquiry === "hidden" && env.view(s).view === "inquiry" && env.view(s).layout.workShown)
      queueMicrotask(() => {
        if (watching && store.getState().runtime.hints.inquiry === "hidden") setRuntime(store, (r) => ({ hints: { ...r.hints, inquiry: "shown" } }))
      })
  }
  // つないだときの状態でも確かめる（外していた間に決まった計画も変換する）
  check(store.getState())
  const unsubscribe = store.subscribe(check)
  return () => {
    watching = false
    unsubscribe()
  }
}
