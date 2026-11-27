import { rowFix } from "@/components/convert/status"
import { askFacts, askImpact, askPrompt, askWording } from "@/lib/cases/ask-impact"
import { layoutOf } from "@/lib/cases/layout"
import { isSheetFile, type CaseFile } from "@/lib/cases/types"
import { selectionAdvice } from "@/lib/cases/selection-advice"
import { activeView, type WorkView } from "@/lib/cases/steps"
import { caseTodo, reportQuestionStates } from "@/lib/cases/todo"
import { editKey, type RowResult } from "@/lib/convert/convert"
import { manualIncludedCount, summarizeKoji } from "@/lib/convert/koji-selection"
import { askKey, type PlanAsk, type PlanAskKind } from "@/lib/convert/plan"
import { askTargets, sourceKey } from "@/lib/convert/sources"
import { collectInquiries } from "@/lib/inquiry/inquiry"
import type { KojiFieldId } from "@/lib/spec/koji-keireki"
import type { CaseState } from "./create-case-store"
import type { CaseConfig } from "./env"
import { memoLast, type TableDerived } from "./table"

const NO_ROWS: RowResult<KojiFieldId>[] = []
const NO_ASKS: PlanAsk[] = []
const NO_FILES: CaseFile[] = []

/** 計画の聞き返しの種類ごとの、表の絞り込みの名前と答えの選択肢（exclude は対象の行を載せない。keep は今のまま） */
export const ASK_KINDS: Record<PlanAskKind, { label: string; options: { value: "exclude" | "keep"; label: string }[] }> = {
  unfinished: { label: "未成の工事", options: [{ value: "exclude", label: "完成だけ載せる" }, { value: "keep", label: "未成も載せる" }] },
  doubtful: { label: "載せるか迷う行", options: [{ value: "exclude", label: "載せない" }, { value: "keep", label: "載せる" }] },
}

/**
 * 案件の表から作る派生（表の鎖〔table.ts〕のあとの段）: 行の片付けること・問い合わせ・件数（todo）・計画の聞き返し・並べ方。
 * ストアごとに作り、各段は入力の参照で1つだけ覚える（前の画面の useMemo と同じ依存）。同じ状態なら同じ結果（同じ参照）を返すので、
 * 部品の selector も action（業種の決定・聞き返しの答えなど）も、その時点の状態から同じものを読む
 */
export function createCaseView(table: (s: CaseState) => TableDerived, config: CaseConfig) {
  /** 行の片付けること（職員が直すセルと、顧客に聞くセル）。表の絞り込み・行の理由・次にやること・ダウンロードの前の確認で同じもの */
  const rowFixesOf = memoLast((shown: TableDerived["shown"], dismissed: CaseState["work"]["dismissed"]) => new Map((shown ?? []).map((r) => [r.key, rowFix(r, (f) => !dismissed.has(editKey(r.key, f)))])))
  const inquiriesOf = memoLast((output: TableDerived["output"], tax: CaseState["work"]["tax"]) => (output ? collectInquiries(output, { tax }) : []))
  const summaryOf = memoLast((edited: TableDerived["edited"], selected: TableDerived["selected"], tax: CaseState["work"]["tax"], basis: CaseState["work"]["basis"], rule7Tax: CaseState["work"]["rule7Tax"]) =>
    edited && selected ? summarizeKoji(edited, selected, { tax, basis, rule7Tax }) : [],
  )
  /** 計画の聞き返しと、その対象の表の行（元の Excel のセルで決める。答えで載せないにした行も数える） */
  const askRowsOf = memoLast((sources: TableDerived["sources"], shown: TableDerived["shown"], planAsks: readonly PlanAsk[], plan: TableDerived["plan"]) => {
    if (!sources || !shown || !planAsks.length) return []
    const rf = plan!.rowFilter
    return planAsks.map((a, i) => {
      // 計画の取り込みと同じ数え方（askTargets）。行は元の行の分け方（記号の列で分けた行）ごと
      const targets = new Set(askTargets(a, sources.rows, rf).map(sourceKey))
      const rows = shown.filter((r) => targets.has(sourceKey(r)))
      // id は画面の並び（表の絞り込み・欄の印）、key は答えと取り消しの単位（並び順に依らない。lib/convert/plan.ts の askKey）
      return { id: `plan-ask-${i}`, key: askKey(a), label: ASK_KINDS[a.kind].label, keys: new Set(rows.map((r) => r.key)), rows }
    })
  })
  /**
   * 聞き返しの「載せない」側の答えで、載せる件数と7割がどう変わるか（今の7割の選び方・入れ外しで選び直す。表・ダウンロードの前の確認と同じ計算）と、
   * 対象がデータの大半になるときの事実（決まった処理で数える）
   */
  const askEffectsOf = memoLast(
    (
      askRows: ReturnType<typeof askRowsOf>,
      edited: TableDerived["edited"],
      shown: TableDerived["shown"],
      selected: TableDerived["selected"],
      summary: ReturnType<typeof summaryOf>,
      planAsks: readonly PlanAsk[],
      manual: CaseState["work"]["manual"],
      tax: CaseState["work"]["tax"],
      basis: CaseState["work"]["basis"],
      rule7Tax: CaseState["work"]["rule7Tax"],
      selection: CaseState["work"]["selection"],
    ) =>
      askRows.map((r, i) => {
        const impact = edited && shown && selected ? askImpact(edited, { manual, tax, basis, rule7Tax, selection }, r.keys, { inclusion: selected, summary }) : null
        return {
          impact,
          facts: shown ? askFacts(planAsks[i]!.kind, shown, r.keys) : undefined,
          // カードの言葉と「AI に聞く」の質問（行や設定が変わったときだけ作り直す）
          wording: askWording(impact, r.keys.size),
          prompt: askPrompt(planAsks[i]!.text, r.rows, impact?.targets ?? null),
        }
      }),
  )
  const askIdsOf = memoLast((askRows: ReturnType<typeof askRowsOf>) => askRows.map((r) => ({ id: r.id, key: r.key })))
  /** 載せる工事の既定の案（lib/cases/selection-advice.ts）。載せうる行は除外していない行 */
  const selectionAdviceOf = memoLast((shown: TableDerived["shown"], inclusion: TableDerived["inclusion"], summary: ReturnType<typeof summaryOf>) => {
    const rows = (shown ?? []).filter((r) => inclusion.get(r.key)?.reason !== "excluded").length
    return selectionAdvice({ previous: config.previous ? { selection: config.previous.selection } : null, rows, summary })
  })
  /** 報告の聞き返しと答えたか（lib/cases/todo.ts。報告・ダウンロードの前の確認・「答える」で同じもの） */
  const questionStatesOf = memoLast(
    (
      hasTable: boolean,
      selectionAnswered: boolean,
      tax: CaseState["work"]["tax"],
      taxBy: CaseState["work"]["taxBy"],
      reportAnswers: CaseState["work"]["reportAnswers"],
      asks: readonly { id: string; key: string }[],
    ) => reportQuestionStates({ hasTable, selectionAnswered, tax, taxBy, reportAnswers, asks }),
  )
  /**
   * 残りの件数（lib/cases/todo.ts が1回だけ数える）。次にやること・ダウンロードの前の確認・表の「直す」・業種のタブ・タブの数・
   * チャットの答えを待つ印は、これを読むだけにする。表ができる前も、答える（変更案・聞き返し）は数える
   */
  const todoOf = memoLast(
    (
      shown: TableDerived["shown"],
      output: TableDerived["output"],
      inclusion: TableDerived["inclusion"],
      rowFixes: ReturnType<typeof rowFixesOf>,
      proposals: CaseState["work"]["proposals"],
      contents: CaseState["contents"],
      questions: ReturnType<typeof questionStatesOf>,
      inquiries: ReturnType<typeof inquiriesOf>,
      dismissed: CaseState["work"]["dismissed"],
      inquiring: boolean,
    ) => caseTodo({ shown: shown ?? NO_ROWS, inclusion, rowFixes, exportRows: output?.length ?? 0, proposals, contents, questions, inquiries, dismissed, inquiring }),
  )
  /** 7割ルールのまま手で載せた行の数（多ければ表の上で全件を勧める） */
  const manualIncludedOf = memoLast((inclusion: TableDerived["inclusion"]) => manualIncludedCount(inclusion))
  /** 届いた表のファイル（ファイルの一覧が変わったときだけ作り直す） */
  const sheetFilesOf = memoLast((files: CaseState["runtime"]["files"]) => files.filter((f) => f.kind === "source" && isSheetFile(f.name)))
  const layoutOfInput = memoLast((wide: boolean, hasTable: boolean, workReady: boolean, workChoice: boolean | null, chatCollapsed: boolean) =>
    layoutOf({ wide, hasTable, workReady, workChoice, chatCollapsed }),
  )

  let last: { state: CaseState; out: CaseView } | null = null
  return function view(s: CaseState): CaseView {
    if (last?.state === s) return last.out
    const t = table(s)
    const w = s.work
    const rt = s.runtime
    const rowFixes = rowFixesOf(t.shown, w.dismissed)
    const inquiries = inquiriesOf(t.output, w.tax)
    const summary = summaryOf(t.edited, t.selected, w.tax, w.basis, w.rule7Tax)
    const planAsks = w.plan?.plan.asks ?? NO_ASKS
    const askRows = askRowsOf(t.sources, t.shown, planAsks, t.plan)
    // 載せる工事を聞くかは去年で決まっているかだけで決まる（行や額が変わっても、聞き返しが出たり消えたりしない。変わるのはすすめる側だけ）
    const advice = selectionAdviceOf(t.shown, t.inclusion, summary)
    const questionStates = questionStatesOf(t.hasTable, w.selectionAnswered, w.tax, w.taxBy, w.reportAnswers, askIdsOf(askRows))
    /**
     * 変換の元（作業の sourceFileId）を選んでいない案件のうち、AI に一から表を作らせるもの（noSheetSource: 届いたファイルに表のファイルが無いか、
     * もう AI が表を作っている〔足した行がある〕）と、届いた表のファイルから元を選んでもらうもの（sourceChoices）
     */
    const sheetFiles = sheetFilesOf(rt.files)
    const noSheetSource = !w.sourceFileId && rt.files.some((f) => f.kind === "source") && (!sheetFiles.length || w.added.length > 0)
    // 読んでいる・読めなかった（報告がやり直しを出す）間は選んでもらわない
    const sourceChoices = !w.sourceFileId && !noSheetSource && !rt.loading && !rt.sourceError ? sheetFiles : NO_FILES
    const out: CaseView = {
      rowFixes,
      inquiries,
      summary,
      planAsks,
      askRows,
      askEffects: askEffectsOf(askRows, t.edited, t.shown, t.selected, summary, planAsks, w.manual, w.tax, w.basis, w.rule7Tax, w.selection),
      questionStates,
      selectionAdvice: advice,
      todo: todoOf(t.shown, t.output, t.inclusion, rowFixes, w.proposals, s.contents, questionStates, inquiries, w.dismissed, rt.status === "inquiring"),
      manualIncluded: manualIncludedOf(t.inclusion),
      noSheetSource,
      sourceChoices,
      // チャットに送れるか（変換した、または変換の元の表が無い）
      chatReady: !!t.rows && !t.reconverting && (noSheetSource || (w.converted && !!rt.source && !!t.grid && !!t.plan)),
      chatCanSend: false,
      layout: layoutOfInput(s.ui.wide, t.hasTable, !!t.output && !!t.shown, s.ui.workChoice, s.ui.chat.collapsed),
      view: "table",
      tool: null,
      visible: null,
    }
    out.view = activeView(s.ui.tab, out.todo)
    out.tool = s.ui.tool
    // 今目に見えている画面（作業の画面を開いていなければ無し。道具を開いていれば道具、なければ段か表）
    out.visible = out.layout.workShown ? (out.tool ?? out.view) : null
    // チャットに指示を送れるか（1つの真実: 送る準備ができ、会話を読み終え、送っている途中でない）。「答える」の段の「AI に聞く」とチャットの欄が同じ値を読む
    out.chatCanSend = out.chatReady && s.ui.chatTurn.loaded && !s.ui.chatTurn.sending
    // 中身が前と同じ参照なら前の結果を返す（selector が描画ごとに新しいものを返さない）
    const same = last && (Object.keys(out) as (keyof CaseView)[]).every((k) => Object.is(out[k], last!.out[k]))
    last = { state: s, out: same ? last!.out : out }
    return last.out
  }
}

export type CaseView = {
  rowFixes: Map<string, ReturnType<typeof rowFix<KojiFieldId>>>
  inquiries: ReturnType<typeof collectInquiries>
  summary: ReturnType<typeof summarizeKoji>
  planAsks: readonly PlanAsk[]
  askRows: { id: string; key: string; label: string; keys: Set<string>; rows: NonNullable<TableDerived["shown"]> }[]
  askEffects: { impact: ReturnType<typeof askImpact> | null; facts: string | undefined; wording: ReturnType<typeof askWording>; prompt: ReturnType<typeof askPrompt> }[]
  questionStates: ReturnType<typeof reportQuestionStates>
  selectionAdvice: ReturnType<typeof selectionAdvice>
  todo: ReturnType<typeof caseTodo>
  manualIncluded: number
  noSheetSource: boolean
  /** 元を選んでもらう届いた表のファイル（元を選んでいない・表を一から作るのでもないときだけ） */
  sourceChoices: readonly CaseFile[]
  chatReady: boolean
  /** チャットに指示を送れるか（chatReady と ui.chatTurn から作る） */
  chatCanSend: boolean
  layout: ReturnType<typeof layoutOf>
  /** 作業の画面に開いているもの（段・表・道具。職員が選ぶまでは今の段。lib/cases/steps.ts） */
  view: ReturnType<typeof activeView>
  /** 開いている道具（段の並びの外に重ねて開く。ui.tool） */
  tool: CaseState["ui"]["tool"]
  /** 今目に見えている画面（道具を開いていれば道具、なければ段か表。作業の画面を閉じていれば null）。表の測り方・問い合わせの案内が読む */
  visible: WorkView | null
}
