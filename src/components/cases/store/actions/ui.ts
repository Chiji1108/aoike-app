import type { StepId } from "@/components/cases/next-steps"
import type { WorkTab } from "@/components/cases/work-tabs"
import type { FixActionId, TableFilter } from "@/components/convert/status"
import type { ChatAction } from "@/lib/chat/messages"
import { setRuntime, setUi, type ChatTarget } from "../create-case-store"
import type { CaseEnv } from "../env"

/** チャットの案内のうち、案件を終えるときの振り返り・問い合わせのメールの下書き（返ってきた Excel の案内はファイルの id） */
export const REVIEW_SUGGESTION = "review"
export const INQUIRY_SUGGESTION = "inquiry-text"

/** チャットの欄の最初の答えを待つもの */
export const PENDING_TARGET: ChatTarget = { target: "[data-pending]" }

/** 作業の画面をチャットの横に並べられる幅か（画面が matchMedia で見て入れる） */
export function setWide(env: CaseEnv, wide: boolean) {
  setUi(env.store, () => ({ wide }))
}

/** 作業の画面のタブを切り替える（開いているかは変えない） */
export function setTab(env: CaseEnv, tab: WorkTab) {
  setUi(env.store, () => ({ tab }))
}

/** 作業の画面をそのタブで開く */
export function showTab(env: CaseEnv, tab: WorkTab) {
  setUi(env.store, () => ({ tab, workChoice: true }))
}

/** 作業の画面を開く・閉じる（職員が決めた。閉じても隠すだけ） */
export function setWorkShown(env: CaseEnv, open: boolean) {
  setUi(env.store, () => ({ workChoice: open }))
}

/**
 * チャットから作業のタブを開く。押したとき（click）は開く。道具の結果が届いたとき（auto）は、広い画面で職員が閉じていなければ開き、
 * 職員が閉じた・狭い画面ではタブだけ切り替える（勝手に開き直さない。返事の途中でチャットを覆わない。「表を開く」で開くとそのタブ）
 */
export function openTab(env: CaseEnv, tab: WorkTab, how: "auto" | "click") {
  setUi(env.store, (u) => (how === "click" || (u.wide && u.workChoice !== false) ? { tab, workChoice: true } : { tab }))
}

/** 表の絞り込みを選ぶ */
export function setFilter(env: CaseEnv, filter: TableFilter) {
  setUi(env.store, () => ({ filter }))
}

/** 計画の聞き返しの対象の行を表で見る */
export function viewAsk(env: CaseEnv, askId: string) {
  setUi(env.store, () => ({ filter: { kind: "all", ask: askId }, tab: "table", workChoice: true }))
}

/**
 * チャットの欄の移り先へ移り、その中のボタンに合わせる（狭い画面では作業の画面を閉じる）。
 * 動かすのは描いたあと（focus-effects.tsx）なので、閉じた作業の画面・ダウンロードの前の確認がフォーカスを戻したあとに移る
 */
export function goChat(env: CaseEnv, to: ChatTarget) {
  setUi(env.store, (u) => ({ ...(u.wide ? {} : { workChoice: false }), focus: { kind: "chat", ...to } }))
}

/** 次にやることの段へ移る。答えるはチャットの最初の答えを待つものへ（狭い画面では作業の画面を閉じる） */
export function goStep(env: CaseEnv, id: StepId) {
  if (id === "export") return openExport(env)
  if (id === "inquiry") return showTab(env, "inquiry")
  if (id === "gyoshu") return showTab(env, "gyoshu")
  if (id === "fix") return setUi(env.store, () => ({ filter: { kind: "fix" }, tab: "table", workChoice: true }))
  goChat(env, PENDING_TARGET)
}

/**
 * 直し方の操作（status.ts の FIX_ACTIONS）。業種は業種のタブ（1行から開いたときはその行の選ぶ欄へ）、
 * 工事場所は工事場所のタブ（費用の目安を見てから職員が調べ始める）、顧客に聞くものは問い合わせのタブ
 */
export function runFixAction(env: CaseEnv, action: FixActionId, keys: readonly string[]) {
  if (action === "findLocation") return showTab(env, "location")
  if (action === "askCustomer") return showTab(env, "inquiry")
  setUi(env.store, () => ({ tab: "gyoshu", workChoice: true, ...(keys.length === 1 ? { focus: { kind: "gyoshuRow", key: keys[0]! } } : {}) }))
}

/** 返事のボタン（ダウンロードの前の確認・問い合わせ） */
export function chatAction(env: CaseEnv, a: ChatAction) {
  if (a === "export") openExport(env)
  else showTab(env, "inquiry")
}

/** ダウンロードの前の確認を開く（閉じたあとのフォーカスは開いたボタンに戻す） */
export function openExport(env: CaseEnv) {
  setUi(env.store, (u) => ({ dialogs: { ...u.dialogs, export: { open: true, returnTo: null } } }))
}

/** ダウンロードの前の確認を閉じる */
export function closeExport(env: CaseEnv) {
  setUi(env.store, (u) => ({ dialogs: { ...u.dialogs, export: { open: false, returnTo: null } } }))
}

/** ダウンロードの前の確認を閉じてチャットの移り先へ移る（確認は閉じると開いたボタンにフォーカスを戻すので、その代わりに移り先のボタンへ） */
export function exportToChat(env: CaseEnv, to: ChatTarget) {
  setUi(env.store, (u) => ({ dialogs: { ...u.dialogs, export: { open: false, returnTo: to } } }))
  goChat(env, to)
}

/** 案件の削除の確認を開く・閉じる */
export function setDeleteOpen(env: CaseEnv, open: boolean) {
  setUi(env.store, (u) => ({ dialogs: { ...u.dialogs, delete: open } }))
}

/** ファイルをドラッグしている */
export function setDragging(env: CaseEnv, dragging: boolean) {
  setUi(env.store, () => ({ dragging }))
}

/** チャットに指示を送れるか（チャットの欄が知らせる） */
export function setChatCanSend(env: CaseEnv, chatCanSend: boolean) {
  setUi(env.store, () => ({ chatCanSend }))
}

/** 案内を送った（返ってきた Excel の案内はファイルの id、振り返りは review、問い合わせのメールの下書きは inquiry-text） */
export function suggestionSent(env: CaseEnv, id: string) {
  setRuntime(env.store, (r) => ({
    hints:
      id === REVIEW_SUGGESTION
        ? { ...r.hints, review: false }
        : id === INQUIRY_SUGGESTION
          ? { ...r.hints, inquiry: "sent" }
          : { ...r.hints, answer: r.hints.answer.filter((h) => h.fileId !== id) },
  }))
}
