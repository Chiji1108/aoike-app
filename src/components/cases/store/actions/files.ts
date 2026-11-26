import { toast } from "sonner"
import type { UploadNote } from "@/components/cases/case-report"
import type { CaseWork } from "@/lib/cases/state"
import type { FileKind } from "@/lib/cases/types"
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
import { setRuntime, setWork } from "../create-case-store"
import type { CaseEnv } from "../env"
import { receiveProposal } from "./proposals"
import { ensureAddresses, mergeAiCache, serverAi } from "./source"

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
  if (generation !== store.getState().runtime.gen.case) return undefined
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
  if (!saved || stale()) return undefined
  const proposal = newProposal(crypto.randomUUID(), { kind: "excel", fileId: saved.id }, changes, null)
  await deps.recordProposal({ proposal, changes })
  // 記録している間に元が変わったら、閉じた変更案として足す（サーバーの記録から開き直しても、また開かない）
  receiveProposal(store, { proposal: stale() ? discard(proposal) : proposal, changes }, "replace")
  if (stale()) return undefined
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
  if (generation !== store.getState().runtime.gen.case) return undefined
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
  if (!saved || stale()) return undefined
  if (changes.length) {
    const proposal = newProposal(crypto.randomUUID(), { kind: "answer", fileId: saved.id }, changes, null)
    await deps.recordProposal({ proposal, changes })
    // 記録している間に元が変わったら、閉じた変更案として足す（サーバーの記録から開き直しても、また開かない）
    receiveProposal(store, { proposal: stale() ? discard(proposal) : proposal, changes }, "replace")
    if (stale()) return undefined
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
