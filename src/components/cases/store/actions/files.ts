import { toast } from "sonner"
import type { UploadNote } from "@/components/cases/case-report"
import type { CaseWork } from "@/lib/cases/state"
import { isSheetFile, type CaseFile, type FileKind } from "@/lib/cases/types"
import { uploadKind, warnsUnlinked } from "@/lib/cases/upload-kind"
import { viewKindOf } from "@/lib/chat/view-kind"
import { baseRows } from "@/lib/cases/view"
import { decisionOf, discard, newProposal, type ChatChange } from "@/lib/chat/proposals"
import type { AddressBook } from "@/lib/convert/address"
import { convertRows, resolveRows, type RowResult } from "@/lib/convert/convert"
import type { AiCache } from "@/lib/convert/pipeline"
import type { SheetGrid } from "@/lib/convert/plan"
import { collectSourceRows } from "@/lib/convert/sources"
import { changeSignature, readFinalSheet, recount, withoutKnown, type FinalReport } from "@/lib/excel/final-import"
import { errorMessage } from "@/lib/errors"
import { mergeAnswers, outsideCells, readAnswers, type AnswerReport } from "@/lib/inquiry/inquiry"
import { readMarked } from "@/lib/inquiry/marked"
import { KOJI_KEIREKI, type KojiFieldId } from "@/lib/spec/koji-keireki"
import { setRuntime, setUi, setWork } from "../create-case-store"
import type { CaseEnv } from "../env"
import { receiveProposal } from "./proposals"
import { ensureAddresses, mergeAiCache, openSource, serverAi } from "./source"

const SPEC = KOJI_KEIREKI

/** アップロードしたファイルをどう扱ったかを報告に残す（最後の10件） */
export function note(env: CaseEnv, n: UploadNote) {
  setRuntime(env.store, (r) => ({ notes: [...r.notes.slice(-9), n] }))
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

/** 待っている間に変換の元・列の対応が変わった（画面を離れた）ので取り込みをやめたとき（上げたファイルは案件に残る） */
const STALE_IMPORT = { error: "取り込んでいる間に変換の元か列の対応が変わったので、取り込みをやめました。もう一度アップロードしてください" }

/** 変換の結果（手直し・置換の前）。元のファイル・計画・端数・AI の結果・引いた住所から作る（AI は呼ばない） */
function convertedRows(sheets: SheetGrid[], w: CaseWork, addresses: AddressBook) {
  if (!w.converted || !w.plan) return null
  const { plan } = w.plan
  return resolveRows(convertRows(SPEC, collectSourceRows(sheets, plan).rows, plan, { rounding: w.rounding, addresses }), w.aiCache)
}

/**
 * 直した最後の Excel を取り込む: 照合用のシートのダウンロードしたときの値との差分を変更案にしてサーバーに置き（チャットの変更案と同じく、開き直しても残る）、
 * 上げたファイルを案件に残す。差分は取り込み始めたときの表と比べる。待っている間に変換の元が変わったら捨てる
 */
async function readFinalFile(env: CaseEnv, f: File, sheets: readonly SheetGrid[]): Promise<{ report: FinalReport } | { error: string } | undefined> {
  const { store, deps, config } = env
  const start = store.getState()
  const t = env.table(start)
  const against = t.hasTable ? t.view : null
  if (!against) return { error: "表がまだありません。変換が済んでからアップロードしてください" }
  const generation = start.runtime.gen.case
  const failures = new Set<string>()
  const cache: AiCache = new Map(start.work.aiCache)
  // 件数の上限は readFinalSheet が AI を呼ぶ前に確かめる。案件のファイルに残すのは読めたあと
  const result = await readFinalSheet(
    sheets,
    against,
    { caseId: config.caseId, sourceFileId: start.work.sourceFileId, excelKey: config.excelKey },
    { rounding: start.work.rounding, cache, callAi: serverAi(env, failures), lookup: (raws) => ensureAddresses(env, [...raws]) },
  )
  if (generation !== store.getState().runtime.gen.case) return STALE_IMPORT
  if ("error" in result) return result
  if (failures.size) toast.warning(`AI を使えなかった値があります: ${[...failures].join(" / ")}`)
  setWork(store, (w) => ({ ...w, aiCache: mergeAiCache(w.aiCache, start.work.aiCache, cache) }))
  // 開いている（未決の）・却下した直した Excel の変更案と同じ項目は除く（同じ Excel をもう一度上げても二重にせず、却下したものを出し直さない。
  // 承認した項目は、表がもうその値なので readFinalSheet が出さない）
  const { work, contents } = store.getState()
  const known = new Set(work.rejectedExcel)
  for (const p of work.proposals) {
    if (p.origin.kind !== "excel" || p.state !== "open") continue
    contents.get(p.id)?.forEach((c, i) => {
      if (decisionOf(p, i) !== "applied") known.add(changeSignature(c))
    })
  }
  const { changes, skipped } = withoutKnown(result.changes, known)
  const report = recount(result.report, changes, skipped)
  if (!changes.length) return { report }
  const saved = await keepFile(env, "edit_sheet", f, f.name)
  // 保存を待っている間に元が変わったら、前の元の行への変更なので入れない
  const stale = () => generation !== store.getState().runtime.gen.case
  if (!saved) return undefined
  if (stale()) return STALE_IMPORT
  const proposal = newProposal(crypto.randomUUID(), { kind: "excel", fileId: saved.id }, changes, null)
  await deps.recordProposal({ proposal, changes })
  // 記録している間に元が変わったら、閉じた変更案として足す（サーバーの記録から開き直しても、また開かない）
  receiveProposal(store, { proposal: stale() ? discard(proposal) : proposal, changes }, "replace")
  if (stale()) return STALE_IMPORT
  return { report }
}

/** チャット欄・画面にアップロードした直した Excel。結果はチャット欄の報告の下と通知に出す */
export async function importFinal(env: CaseEnv, f: File, sheets: readonly SheetGrid[]) {
  let r: { report: FinalReport } | { error: string } | undefined
  try {
    r = await readFinalFile(env, f, sheets)
  } catch (e) {
    r = { error: errorMessage(e, "Excel を取り込めませんでした") }
  }
  if (!r) return
  if ("error" in r) {
    toast.error(r.error)
    note(env, { name: f.name, text: r.error, tone: "error" })
    return
  }
  const { report } = r
  setRuntime(env.store, () => ({ finalResult: { name: f.name, report } }))
  const n = report.cells + report.added + report.excluded
  const left = report.conflicts.length + report.ambiguous.length + report.invalid.length + report.refused.length + report.extraColumns.length
  if (!n && report.skipped) toast.info("前に出した・却下した変更と同じなので、変更案にしていません（チャット欄）")
  else if (n) toast.success(`直した Excel の変更 ${n} 件を変更案にしました${left ? `（取り込めなかったもの ${left} 件はチャット欄）` : ""}`)
  else if (left) toast.warning(`直した Excel の変更を取り込めませんでした（${left} 件。理由はチャット欄）`)
  else toast.success("直した Excel に変わったところはありませんでした")
}

/**
 * 返ってきた Excel（印付きの Excel・記入用Excel）を読み、顧客の回答の変更案にする（チャットの record_answers と同じく、職員が承認すると表に入り、
 * 承認は取り消せる。注文者・工事名の記入は元データと同じ変換・AI に通す）。読んだ結果は answers に入る。
 * 読んでいる間に値が変わったセル（手直し・置換・変換のやり直し）の回答は変更案にせず、結果の changed に入る
 */
async function readAnswerFile(env: CaseEnv, f: File, kind: "marked" | "answer", against: RowResult<KojiFieldId>[]) {
  const { store, deps, config } = env
  const start = store.getState()
  const generation = start.runtime.gen.case
  // 照合に使う計画・元のファイル・引いた住所は、取り込み始めたときのものにそろえる（against と同じ時点）
  const planAtStart = start.work.plan
  const sourceAtStart = start.runtime.source
  const sourceFileId = start.work.sourceFileId
  const addressesAtStart = env.table(start).addresses
  if (start.work.converted && !addressesAtStart) return { error: "住所を読み込んでいます。少し待ってから取り込んでください" }
  const { readWorkbook } = await import("@/lib/convert/workbook")
  const sheets = readWorkbook(f.name, new Uint8Array(await f.arrayBuffer()))
  const failures = new Set<string>()
  const cacheStart = store.getState().work.aiCache
  const cache: AiCache = new Map(cacheStart)
  // 住所は変換と同じ仕組みで引く（住所データを読めなければ、その値は読めない記入として出す。取り込み全体は止めない）
  const ai = {
    ctx: { rounding: store.getState().work.rounding },
    lookup: (raws: Iterable<string>) => ensureAddresses(env, [...raws]),
    cache,
    callAi: serverAi(env, failures),
    fields: planAtStart?.plan.fields ?? {},
  }
  let report: AnswerReport
  let outside: number
  if (kind === "marked") {
    if (!sourceFileId) return { error: "変換の元がありません。印付きの Excel は変換の元に印を付けたものです" }
    const read = await readMarked(sheets, against, sourceAtStart?.fileId === sourceFileId ? sourceAtStart.sheets : null, { caseId: config.caseId, sourceFileId, excelKey: config.excelKey, plan: planAtStart?.plan ?? null }, ai)
    if ("error" in read) return read
    report = read.report
    outside = read.outside
  } else {
    const read = await readAnswers(sheets, against, ai)
    if ("error" in read) return read
    report = read
    outside = outsideCells(sheets, against)
  }
  if (generation !== store.getState().runtime.gen.case) return STALE_IMPORT
  if (store.getState().work.plan !== planAtStart) return { error: "取り込んでいる間に列の対応が変わりました。もう一度取り込んでください" }
  // 読んでいる間に値が変わったセルの回答は外す（今の変換の結果・一括置換・手直しと比べる）
  const { work: w, contents } = store.getState()
  const converted = sourceAtStart && addressesAtStart ? (convertedRows(sourceAtStart.sheets, w, addressesAtStart) ?? []) : []
  const merged = mergeAnswers(report, against, { rows: baseRows({ rows: converted, added: w.added }), replacements: w.replacements, edits: w.edits }).report
  // 開いている顧客の回答の変更案・却下した項目と同じものは除く（同じ Excel を2回上げても二重にせず、却下したものを出し直さない）
  const known = new Set(w.rejectedExcel)
  for (const p of w.proposals) {
    if (p.origin.kind !== "answer" || p.state !== "open") continue
    contents.get(p.id)?.forEach((c, i) => {
      if (decisionOf(p, i) === "pending") known.add(changeSignature(c))
    })
  }
  const { changes } = withoutKnown(
    merged.edits.map(([key, edit]): ChatChange => {
      const at = key.lastIndexOf(":")
      return { kind: "cell", rowKey: key.slice(0, at), field: key.slice(at + 1) as KojiFieldId, edit }
    }),
    known,
  )
  // 決まった欄で読めなかった記入を AI に読ませるときは、保存したファイルを AI に渡す
  const saved = await keepFile(env, "answer", f, f.name)
  // 保存を待っている間に元や列の対応が変わったら、前の元の行への答えなので入れない
  const stale = () => generation !== store.getState().runtime.gen.case || store.getState().work.plan !== planAtStart
  if (!saved) return undefined
  if (stale()) return STALE_IMPORT
  if (changes.length) {
    const proposal = newProposal(crypto.randomUUID(), { kind: "answer", fileId: saved.id }, changes, null)
    await deps.recordProposal({ proposal, changes })
    // 記録している間に元が変わったら、閉じた変更案として足す（サーバーの記録から開き直しても、また開かない）
    receiveProposal(store, { proposal: stale() ? discard(proposal) : proposal, changes }, "replace")
    if (stale()) return STALE_IMPORT
  }
  setWork(store, (x) => ({ ...x, aiCache: mergeAiCache(x.aiCache, cacheStart, cache), answers: merged }))
  // 色付きの欄の外（印の無いセルの書き換え・別の列・メモ・別のシート）に記入があるか、読めなかった記入があれば、このファイルを AI に読ませられる
  const readable = outside > 0 || merged.invalid.length > 0 || merged.unreadable.length > 0
  return { aiFailures: [...failures], proposed: changes.length, outside, forAi: readable ? saved : null }
}

/** 返ってきた Excel を取り込む（チャットの📎・画面にドラッグしたファイル）。結果は報告と「問い合わせ」のタブと通知に出す */
export async function importAnswers(env: CaseEnv, f: File, kind: "marked" | "answer") {
  const fail = (text: string) => {
    toast.error(text)
    note(env, { name: f.name, text, tone: "error" })
  }
  const t = env.table(env.store.getState())
  const against = t.hasTable ? t.shown : null
  if (!against) return fail("表がまだありません。変換が済んでから取り込んでください")
  try {
    const read = await readAnswerFile(env, f, kind, against)
    if (!read) return
    if ("error" in read) return fail(read.error)
    const forAi = env.config.chatEnabled ? read.forAi : null
    const text = [
      read.proposed ? `顧客の回答 ${read.proposed} 件を変更案にしました（チャット欄で承認すると表に入ります）` : "表に入れる顧客の回答はありませんでした（結果は「問い合わせ」のタブ）",
      read.outside ? `色付きの欄の外の記入が ${read.outside} 件あります（入れていません）` : "",
      forAi ? "チャットの「AI で読む」で読めます" : "",
    ]
      .filter(Boolean)
      .join("。")
    toast.success(text)
    note(env, { name: f.name, text })
    if (forAi) setRuntime(env.store, (r) => ({ hints: { ...r.hints, answer: [...r.hints.answer.filter((h) => h.fileId !== forAi.id), { fileId: forAi.id, name: forAi.name }] } }))
    if (read.aiFailures.length) toast.warning(`AI を使えず変更案にしていない記入があります（${read.aiFailures.join(" / ")}）`)
  } catch (e) {
    fail(errorMessage(e, "回答のファイルを読み込めませんでした"))
  }
}

/** 変換の元に読み込めるか（PDF などは保存と一覧だけ） */
const isPdf = (name: string) => /\.pdf$/i.test(name)

/** 「変換の元にしますか」を聞く（今の変換の結果と手直しが消えるので）。聞いている間に付けたものは列に足し、1つずつ聞く */
const askSource = (env: CaseEnv, file: CaseFile) =>
  setUi(env.store, (u) => ({ dialogs: { ...u.dialogs, pendingSources: [...u.dialogs.pendingSources.filter((f) => f.id !== file.id), file] } }))

/**
 * 届いたファイルを付ける（チャットの📎でアップロードしたファイル、画面にドラッグしたファイル）。種類は決まった印で見分ける（lib/cases/upload-kind.ts）:
 * この画面でダウンロードした最後の Excel は差分を変更案に、印付きの Excel・記入用Excel は顧客の回答の変更案にし、ほかの表は届いたファイルとして保存する。
 * 変換の元がまだ無ければ最初の表を変換の元にし、もう元があれば変換の元にするか聞く。照合用のシートの無い最後の Excel の形の表は、
 * 変換の元があれば直した Excel と取り違えないよう、表に戻せないと伝えて聞く（前の編集用の Excel も同じ。lib/cases/upload-kind.ts の warnsUnlinked）
 */
export async function attach(env: CaseEnv, list: readonly File[]) {
  const { store } = env
  let hasSource = !!store.getState().work.sourceFileId
  for (const f of list) {
    let sheets: SheetGrid[] | null = null
    if (isSheetFile(f.name)) {
      try {
        const { readWorkbook } = await import("@/lib/convert/workbook")
        sheets = readWorkbook(f.name, new Uint8Array(await f.arrayBuffer()))
      } catch (e) {
        const text = errorMessage(e, "読めませんでした")
        toast.error(`${f.name}: ${text}`)
        note(env, { name: f.name, text, tone: "error" })
        continue
      }
    }
    const kind = uploadKind(sheets)
    if (kind === "final" && sheets) {
      await importFinal(env, f, sheets)
      continue
    }
    if (kind === "answer" || kind === "marked") {
      setUi(store, () => ({ tab: "inquiry" }))
      await importAnswers(env, f, kind)
      continue
    }
    const saved = await keepFile(env, "source", f, f.name)
    if (!saved) continue
    if (isPdf(saved.name) || !isSheetFile(saved.name)) {
      // HEIC（iPhone の写真）は Claude が見られない（lib/chat/view-file.ts）。保存はして、JPEG で付け直すよう知らせる
      if (viewKindOf(saved.name)?.kind === "heic") note(env, { name: f.name, text: "届いたファイルとして保存しました。HEIC の写真はチャットの AI が見られないので、JPEG で保存し直して付けてください", tone: "error" })
      else note(env, { name: f.name, text: "届いたファイルとして保存しました（チャットの AI は読めます）" })
      continue
    }
    if (warnsUnlinked(kind, hasSource)) {
      note(env, { name: f.name, text: "ダウンロードした Excel の形ですが照合用のシートが無いので、直した Excel としては表に戻せません。変換の元にするかを選んでください" })
      hasSource = true
      askSource(env, saved)
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
