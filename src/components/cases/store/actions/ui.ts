import type { StepId } from "@/lib/cases/steps"
import type { WorkTab } from "@/components/cases/work-tabs"
import type { FixActionId, TableFilter } from "@/components/convert/status"
import type { ChatAction } from "@/lib/chat/messages"
import { setRuntime, setUi, type ChatPrefs, type ChatSize, type ChatTarget } from "../create-case-store"
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
 * チャットの欄の移り先へ移り、その中のボタンに合わせる（狭い画面では作業の画面を閉じる。チャットの窓をたたんでいれば、覚えた設定は変えずにその場だけ開く）。
 * 動かすのは描いたあと（focus-effects.tsx）なので、閉じた作業の画面・ダウンロードの前の確認がフォーカスを戻したあとに移る
 */
export function goChat(env: CaseEnv, to: ChatTarget) {
  const collapsed = env.view(env.store.getState()).layout.chatCollapsed
  setUi(env.store, (u) => ({ ...(u.wide ? {} : { workChoice: false }), ...(collapsed ? { chat: { ...u.chat, collapsed: false } } : {}), focus: { kind: "chat", ...to } }))
}

/**
 * チャットの窓を開く・たたむ（職員が右下のボタン・Escape で決めた）。端末に覚え、フォーカスは開いたら窓の入力欄へ、たたんだら右下のボタンへ移す
 * （職員が開いた・閉じたときだけ。返事が届いても勝手に移さない）
 */
export function setChatOpen(env: CaseEnv, open: boolean) {
  setUi(env.store, (u) => ({ chat: { ...u.chat, collapsed: !open, hint: false }, focus: { kind: open ? "chatWindow" : "chatLauncher" } }))
  saveChatPrefs(env, { collapsed: !open })
}

/** チャットの窓の大きさを変える（null は決まった大きさに戻す）。save なら端末に覚える（引いている間は覚えず、離したときに覚える） */
export function resizeChat(env: CaseEnv, size: ChatSize | null, save: boolean) {
  setUi(env.store, (u) => ({ chat: { ...u.chat, size } }))
  if (save) saveChatPrefs(env, { size })
}

/** 覚えた設定のうち、職員が変えた項目だけを書き換える（「答える」などでその場だけ開いた窓を、たたんだ設定のまま覚えておく） */
export function saveChatPrefs(env: CaseEnv, change: Partial<ChatPrefs>) {
  const { chatPrefs } = env.deps
  chatPrefs.save({ collapsed: false, size: null, hintShown: false, ...chatPrefs.load(), ...change })
}

/** 「チャットはここにあります（たためます）」を消す（職員が消した・窓を開いた／たたんだ） */
export function dismissChatHint(env: CaseEnv) {
  setUi(env.store, (u) => ({ chat: { ...u.chat, hint: false } }))
}

/**
 * チャットから届いた（返事・変更案・アップロードの結果。error は失敗した返事・読めなかったファイル）。窓をたたんでいる間だけ、右下のボタンに未読の印を付ける
 * （職員の表の手直し・止めた返事では呼ばない。失敗の印は開くまで残す）
 */
export function chatArrived(env: CaseEnv, tone: "new" | "error") {
  const s = env.store.getState()
  if (!env.view(s).layout.chatCollapsed || s.ui.chat.unread === "error" || s.ui.chat.unread === tone) return
  setUi(env.store, (u) => ({ chat: { ...u.chat, unread: tone } }))
}

/** 段を開く（どの段にもいつでも行ける。順番は案内だけ）。直すは理由の絞り込みを外して直す行のすべてから */
export function goStep(env: CaseEnv, id: StepId) {
  if (id === "fix") return setUi(env.store, () => ({ filter: { kind: "fix" }, tab: "fix", workChoice: true }))
  showTab(env, id)
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

/** 返事のボタン（ダウンロード・問い合わせの段を開く） */
export function chatAction(env: CaseEnv, a: ChatAction) {
  showTab(env, a === "export" ? "export" : "inquiry")
}

/** ダウンロードの段を開く（前の確認はダイアログでなく段の中身） */
export function openExport(env: CaseEnv) {
  showTab(env, "export")
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
