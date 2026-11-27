import { toast } from "sonner"
import type { UploadNote } from "@/components/cases/case-report"
import { isSheetFile, type CaseFile, type FileKind } from "@/lib/cases/types"
import { viewKindOf } from "@/lib/chat/view-kind"
import { errorMessage } from "@/lib/errors"
import { setRuntime, setUi } from "../create-case-store"
import type { CaseEnv } from "../env"
import { openSource } from "./source"
import { chatArrived } from "./ui"

/** アップロードしたファイルをどう扱ったかを報告に残す（最後の10件）。チャットの窓をたたんでいれば未読の印を付ける */
export function note(env: CaseEnv, n: UploadNote) {
  setRuntime(env.store, (r) => ({ notes: [...r.notes.slice(-9), n] }))
  chatArrived(env, n.tone === "error" ? "error" : "new")
}

/** ファイルを案件に残す（一覧に足す）。残せなければ知らせて undefined */
export async function keepFile(env: CaseEnv, kind: FileKind, blob: Blob, name: string) {
  try {
    const saved = await env.deps.uploadFile(kind, blob, name)
    setRuntime(env.store, (r) => ({ files: [...r.files, saved] }))
    return saved
  } catch (e) {
    toast.error(errorMessage(e, `${name} を案件に保存できませんでした`))
    return undefined
  }
}

/** 「変換の元にしますか」を聞く（今の変換の結果と手直しが消えるので）。聞いている間に付けたものは列に足し、1つずつ聞く */
const askSource = (env: CaseEnv, file: CaseFile) =>
  setUi(env.store, (u) => ({ dialogs: { ...u.dialogs, pendingSources: [...u.dialogs.pendingSources.filter((f) => f.id !== file.id), file] } }))

/**
 * 届いたファイルを付ける（チャットの📎でアップロードしたファイル、画面にドラッグしたファイル）。どれも届いたファイルとして保存する
 * （顧客の回答のファイルもチャットの AI が読む）。変換の元がまだ無ければ最初の表を変換の元にし、もう元があれば変換の元にするか聞く
 */
export async function attach(env: CaseEnv, list: readonly File[]) {
  const { store } = env
  let hasSource = !!store.getState().work.sourceFileId
  for (const f of list) {
    const saved = await keepFile(env, "source", f, f.name)
    if (!saved) continue
    if (!isSheetFile(saved.name)) {
      // HEIC（iPhone の写真）は Claude が見られない（lib/chat/view-file.ts）。保存はして、JPEG で付け直すよう知らせる
      if (viewKindOf(saved.name)?.kind === "heic") note(env, { name: f.name, text: "届いたファイルとして保存しました。HEIC の写真はチャットの AI が見られないので、JPEG で保存し直して付けてください", tone: "error" })
      else note(env, { name: f.name, text: "届いたファイルとして保存しました（チャットの AI は読めます）" })
      continue
    }
    if (!hasSource) {
      hasSource = true
      // PDF から足した行があれば、変換の元にすると消えるので確かめる
      if (store.getState().work.added.length) askSource(env, saved)
      else await openSource(env, saved, true)
    } else askSource(env, saved)
  }
}

/** 一覧のファイルを変換の元にする（変換した・手直しした・足した行があれば、消えるので聞く） */
export function chooseSource(env: CaseEnv, file: CaseFile) {
  const w = env.store.getState().work
  if (w.converted || w.edits.size || w.added.length) askSource(env, file)
  else void openSource(env, file, true)
}

/**
 * 「変換の元にしますか」に答える（yes なら変換の元にする。いいえは付けるだけ）。答えたファイルを列から外し、残りがあれば次を聞く。
 * もう答えたファイル（ボタンを押したあとにダイアログが閉じる知らせ）は何もしない
 */
export function confirmSource(env: CaseEnv, fileId: string, yes: boolean) {
  const file = env.store.getState().ui.dialogs.pendingSources.find((f) => f.id === fileId)
  if (!file) return
  setUi(env.store, (u) => ({ dialogs: { ...u.dialogs, pendingSources: u.dialogs.pendingSources.filter((f) => f.id !== fileId) } }))
  if (yes) void openSource(env, file, true)
}
