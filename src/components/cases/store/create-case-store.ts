import { createStore } from "zustand"
import type { UploadNote } from "@/components/cases/case-report"
import type { TableFilter } from "@/components/convert/status"
import { EMPTY_GRID, type TableGrid } from "@/components/convert/column-filter"
import type { SaveStatus } from "@/lib/cases/autosave"
import { fromSaved, newWork, type CaseWork, type SavedAiCache, type SavedPlan, type SavedWork } from "@/lib/cases/state"
import type { CaseFile, CaseStatus } from "@/lib/cases/types"
import type { StepId, StepView, ToolId } from "@/lib/cases/steps"
import { NO_ADDRESSES, type AddressBook } from "@/lib/convert/address"
import type { Rule7Tax } from "@/lib/convert/koji-selection"
import type { SheetGrid } from "@/lib/convert/plan"
import { withRecorded, type ChatChange, type ProposalRecord } from "@/lib/chat/proposals"

/** 変換の元（読んだファイルのシート） */
export type Source = { fileId: string; name: string; sheets: SheetGrid[] }

/** チャットの欄の中の移り先（target の要素、無ければ最初の答えを待つもの）と、その中でフォーカスを合わせるボタン */
export type ChatTarget = { target: string; button?: string }

/**
 * DOM への頼み（ストアは DOM を触らない。workspace/focus-effects.tsx が描いたあとに動かす）:
 * chat はチャットの欄の target へ移ってボタンに合わせる、gyoshuRow は業種の一覧のその行へ移って選ぶ欄に合わせる、
 * chatWindow は職員が開いたチャットの窓の入力欄へ、chatLauncher は職員がたたんだあとの右下の丸いボタンへ、
 * step は「済みました。次は ◯◯ →」で開いた段の中身へ
 */
export type FocusRequest = ({ kind: "chat" } & ChatTarget) | { kind: "gyoshuRow"; key: string } | { kind: "chatWindow" } | { kind: "chatLauncher" } | { kind: "step"; id: StepId }

/** チャットの窓の大きさ（px。職員が左上の角で変えた。null は決まった大きさ） */
export type ChatSize = { w: number; h: number }

/** 端末ごとに覚えるチャットの窓の設定（たたんだか・大きさ・「チャットはここにあります」を出したか） */
export type ChatPrefs = { collapsed: boolean; size: ChatSize | null; hintShown: boolean }

/**
 * 案件の画面のストア（案件ごとに1つ。CaseWorkspace が作り、context で渡す）。
 * work は保存する作業（自動保存〔sync.ts〕が参照の変化を拾う）、contents は変更案の中身（サーバーが R2 に置いたものの写し。proposal の id → 変更の並び）、
 * runtime は保存しない状態（読んだ元・計画と変換の途中・世代・費用など）、sync は保存の状態。
 * 変えるときは setState((s) => …) の中で s だけを読み、待っている処理は await のあとに getState() で最新を読み直す（前の描画の値・始めに取った値を使わない）
 */
export type CaseState = {
  work: CaseWork
  /**
   * 変更案の中身。開いている変更案には、記録が読めないもの（runtime.unreadable）のほかは必ずある
   * （足すのは receiveProposal だけ。記録の無い開いた変更案は、案件を読むときにサーバーが閉じる〔server/cases.ts の getCasePageFn〕）
   */
  contents: ReadonlyMap<string, readonly ChatChange[]>
  /** 保存しない状態 */
  runtime: {
    /** 案件を読むときに、中身（R2 の記録）が無くサーバーが閉じた変更案の数（報告に1行出す） */
    closedMissing: number
    /** 記録はあるが読めなかった変更案の数（作業にあるものは閉じずに残す。報告に1行出す。カードは決められない） */
    unreadable: number
    /** 離れてすぐ戻ったとき、前の画面の変更を保存できなかった（報告に1行出す） */
    previousUnsaved: boolean
    /** 案件のファイルの一覧（D1・R2 の写し。アップロード・ダウンロードの控えで足す） */
    files: CaseFile[]
    /** 案件の状態（変えるときは楽観的に変え、失敗したら savedStatus に戻す） */
    status: CaseStatus
    /** サーバーが最後に受け付けた案件の状態 */
    savedStatus: CaseStatus
    /** 案件の AI の費用の合計（変換・チャットの分。サーバーの合計に足したものを画面でも足す） */
    costUsd: number
    /** 読んだ変換の元 */
    source: Source | null
    /** 読んでいる変換の元のファイル名 */
    loading: string | null
    /** 変換の元を読めなかった（報告に理由とやり直しを出す） */
    sourceError: { file: CaseFile; message: string } | null
    /** AI が列の対応を考えている間の、見出しからの推定 */
    planDraft: SavedPlan | null
    converting: boolean
    /** 自動の変換が失敗したときの理由と、その計画（同じ計画で何度も変換し直さない） */
    convertError: { message: string; plan: SavedPlan | null } | null
    /**
     * 世代。待っている処理は始めに取り、待ったあとに今の世代と比べて違えば結果を捨てる。
     * source は元のファイルを読む、case は元・計画（計画・回答の結果を捨てる）、conversion は変換、status は案件の状態の変更
     */
    gen: { source: number; case: number; conversion: number; status: number }
    /** 引いた住所（増えたら表を作り直す） */
    addressBook: AddressBook
    /** ルールの追記を保存している間（変更案の承認を止める） */
    busy: { rule: boolean }
    /** アップロードしたファイルをどう扱ったか（報告に出す。最後の10件） */
    notes: UploadNote[]
    /** チャットの「AI でメールの下書きを作る」の案内（hidden はまだ、shown は作業の画面で問い合わせの段を見たので出す、sent は送ったのでこの画面ではもう出さない） */
    inquiryHint: "hidden" | "shown" | "sent"
  }
  /**
   * 画面の状態（保存しない。変えるのは actions/ui.ts などの action だけ）。作業の画面・チャットをどう並べるかは、ここから layoutOf（lib/cases/layout.ts）で決める
   */
  ui: {
    /** 作業の画面をチャットの横に並べられる幅か（画面が matchMedia で見て入れる） */
    wide: boolean
    /** 作業の画面に開いているもの（段・表・道具）。null は表ができる前（今の段。表ができたら今の段に決める。lib/cases/steps.ts の activeView） */
    tab: StepView | null
    /**
     * 開いている道具（工事場所・一括置換）。段の並びの外に重ねて開き、段の並びは tab を選んだまま。閉じる（null）と tab の段・表に戻る。
     * 段・表を選ぶと閉じる
     */
    tool: ToolId | null
    /**
     * 職員が作業の画面を開いた（true）・閉じた（false）か。決めるまで（null）は、表があれば広い画面では開き、狭い画面では閉じておく
     * （狭い画面で開くとチャットを覆うので、チャットの「表を開く」で開く）
     */
    workChoice: boolean | null
    /** 表の絞り込みの理由・聞き返し（kind は開いているもので決まる: 直すの段は直す行、表はすべて。null は選んでいない） */
    filter: TableFilter | null
    /**
     * 表の見え方（検索・並べ替え・列の表示・列のフィルター）。直すの段と表で同じもの（同じ表）。保存しない（開き直すと外れる。Excel と同じ）。
     * 聞き返しの「表で見る」は列のフィルターを外す（その行をすべて見せる）
     */
    grid: TableGrid
    /**
     * ダイアログ: delete は案件の削除、downloads はダウンロードの履歴、pendingSources は「変換の元にしますか」を聞くファイルの列（一度に複数付けたら先頭から1つずつ聞く）
     */
    dialogs: { delete: boolean; downloads: boolean; pendingSources: CaseFile[] }
    /** ファイルをドラッグしている */
    dragging: boolean
    /** DOM への頼み（新しい頼みは新しいオブジェクト。同じ移り先でももう一度動かす） */
    focus: FocusRequest | null
    /**
     * チャットの指示の状態（送れるかの元。送れるかは case-view.ts の chatCanSend がここから作る）: loaded は保存した会話を読み終えた、
     * sending は送り始めて（送る前の保存を待つ間も）から返事が終わるまで。書くのはチャットの欄の会話を読む処理と送る処理だけ
     */
    chatTurn: { loaded: boolean; sending: boolean }
    /** チャットに送る決まった指示（「答える」の段の「AI に聞く」。チャットの欄が送れるときに送って外す。新しい頼みは新しいオブジェクト） */
    chatSend: { text: string } | null
    /**
     * チャットの窓（広い画面で表があるとき）: collapsed はたたんでいる（職員が決めた値は端末ごとに覚える。「答える」などで移るときはその場だけ開く）、
     * unread はたたんでいる間にチャットから届いたもの（new は返事・変更案・アップロードの結果、error は失敗した返事・読めなかったファイル。開くと消す）、
     * size は窓の大きさ、hint は初めて窓にしたときに窓の上に出す「チャットはここにあります（たためます）」（端末ごとに1回。消すと false）
     */
    chat: { collapsed: boolean; unread: "new" | "error" | null; size: ChatSize | null; hint: boolean }
  }
  /** 保存の状態 */
  sync: { status: SaveStatus }
}

export type CaseStore = ReturnType<typeof createCaseStore>

export function createCaseStore(init: CaseState) {
  return createStore<CaseState>()(() => init)
}

/** 作業を変える（next はその時点の作業から作る） */
export function setWork(store: CaseStore, next: (w: CaseWork) => CaseWork) {
  store.setState((s) => ({ work: next(s.work) }))
}

/** 画面の状態を変える（next はその時点の画面の状態から、変える項目だけを作る） */
export function setUi(store: CaseStore, next: (u: CaseState["ui"]) => Partial<CaseState["ui"]>) {
  store.setState((s) => ({ ui: { ...s.ui, ...next(s.ui) } }))
}

/** 保存しない状態を変える（next はその時点の状態から、変える項目だけを作る） */
export function setRuntime(store: CaseStore, next: (r: CaseState["runtime"]) => Partial<CaseState["runtime"]>) {
  store.setState((s) => ({ runtime: { ...s.runtime, ...next(s.runtime) } }))
}

/**
 * 読み込んだ案件からストアの最初の状態を作る。保存した作業が無ければ新しい作業（7割の計算は事務所の設定）。
 * サーバーが記録した変更案のうち、作業にまだ無いもの（返事を受け取り損ねたもの）も作業に入れる。
 * チャットの窓は端末に覚えた設定（chatPrefs）から始める（窓を置く前から覚えた値なので、置いたあとに開き直さない）。
 * closedMissing はサーバーが閉じた記録の無い変更案の数、unreadableProposals は記録を読めなかった変更案（作業に無いものも。閉じない）
 */
export function initialCaseState(page: {
  kase: { status: CaseStatus; costUsd: number }
  files: CaseFile[]
  state: { work: SavedWork; aiCache: SavedAiCache } | null
  proposals: readonly ProposalRecord[]
  unreadableProposals: readonly string[]
  closedMissing: number
  settings: { rule7Tax: Rule7Tax }
  previousUnsaved: boolean
}, chatPrefs: ChatPrefs | null = null): CaseState {
  // 載せる工事は去年から引き継がない（どの案件でも「答える」で1回聞く。去年の選び方はおすすめに出すだけ）
  const w = page.state ? fromSaved(page.state.work, page.state.aiCache) : newWork(null, page.settings.rule7Tax)
  return {
    work: { ...w, proposals: withRecorded(w.proposals, page.proposals) },
    contents: new Map(page.proposals.map((r) => [r.proposal.id, r.changes])),
    runtime: {
      closedMissing: page.closedMissing,
      unreadable: page.unreadableProposals.length,
      previousUnsaved: page.previousUnsaved,
      files: page.files,
      status: page.kase.status,
      savedStatus: page.kase.status,
      costUsd: page.kase.costUsd,
      source: null,
      loading: null,
      sourceError: null,
      planDraft: null,
      converting: false,
      convertError: null,
      gen: { source: 0, case: 0, conversion: 0, status: 0 },
      addressBook: NO_ADDRESSES,
      busy: { rule: false },
      notes: [],
      inquiryHint: "hidden",
    },
    ui: {
      wide: false,
      tab: null,
      tool: null,
      workChoice: null,
      filter: null,
      grid: EMPTY_GRID,
      dialogs: { delete: false, downloads: false, pendingSources: [] },
      dragging: false,
      focus: null,
      chatTurn: { loaded: false, sending: false },
      chatSend: null,
      chat: { collapsed: chatPrefs?.collapsed ?? false, unread: null, size: chatPrefs?.size ?? null, hint: !chatPrefs?.hintShown },
    },
    sync: { status: { kind: "saved" } },
  }
}
