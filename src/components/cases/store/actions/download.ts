import { createClientOnlyFn } from "@tanstack/react-start"
import { toast } from "sonner"
import { contentTypeOf } from "@/lib/cases/types"
import { csvFileName, datedFileName, toCsvBytes } from "@/lib/convert/csv"
import { finalSheet } from "@/lib/excel/final-sheet"
import { errorMessage } from "@/lib/errors"
import { inquirySheet } from "@/lib/inquiry/inquiry"
import { planMarks } from "@/lib/inquiry/marked"
import { saveFile } from "@/lib/save-file"
import { KOJI_KEIREKI } from "@/lib/spec/koji-keireki"
import { setWork } from "../create-case-store"
import type { CaseEnv } from "../env"
import { keepFile } from "./files"

const SPEC = KOJI_KEIREKI

/** 最後の Excel を書く ExcelJS は、ダウンロードするときにブラウザで読み込む */
const loadFinalXlsx = createClientOnlyFn(() => import("@/lib/excel/final-xlsx"))
/** 問い合わせの Excel（印付き・記入用Excel）を書く ExcelJS も同じ */
const loadInquiryXlsx = createClientOnlyFn(() => Promise.all([import("@/lib/inquiry/marked-xlsx"), import("@/lib/inquiry/inquiry-xlsx")]))

/** CSV（控え）をダウンロードする。CP932 の検査を通した値をそのまま書き、案件のファイルに残す */
export function downloadCsv(env: CaseEnv) {
  const { output, reconverting } = env.table(env.store.getState())
  // 変換し直している間は前の行なので書き出さない（控えにも残さない）
  if (!output || reconverting) return
  const bytes = toCsvBytes(SPEC, output)
  const name = csvFileName(SPEC, env.config.customerName, new Date())
  saveFile(bytes, name, "text/csv")
  // Excel で開いて保存すると文字コードが変わり、建設業.NET で文字化けする（都道府県も読めず選ぶ欄の先頭になる）
  toast.info("CSV は Excel で開いて保存しないでください（文字化けします）。そのまま建設業.NET に取り込んでください。直すときは Excel をダウンロードして直し、📎でアップロードし直します。", { duration: 10000 })
  void keepFile(env, "csv", new Blob([bytes as BlobPart], { type: "text/csv" }), name)
}

/** 最後の Excel をダウンロードする（lib/excel/final-sheet.ts。値は CSV と同じ。直して上げ直せる照合用の隠しシート付き）。案件のファイルに残す */
export async function downloadFinalExcel(env: CaseEnv) {
  const { config, store } = env
  const s = store.getState()
  const { view, output, reconverting } = env.table(s)
  if (!view || !output || reconverting) return
  try {
    const { finalXlsx } = await loadFinalXlsx()
    // 照合用の鍵はサーバーが案件ごとに決めたもの（Excel には書かない）
    const bytes = await finalXlsx(await finalSheet(view, { caseId: config.caseId, sourceFileId: store.getState().work.sourceFileId, excelKey: config.excelKey }))
    const name = datedFileName(SPEC.fileNamePrefix, config.customerName, new Date(), "xlsx")
    saveFile(bytes, name, contentTypeOf(name))
    void keepFile(env, "final_sheet", new Blob([bytes as BlobPart], { type: contentTypeOf(name) }), name)
  } catch (e) {
    toast.error(errorMessage(e, "Excel を作れませんでした"))
  }
}

/**
 * 問い合わせの Excel をダウンロードし、案件のファイルに残す。印付きにできれば変換の元に印を付け（lib/inquiry/marked.ts）、
 * 書いてみて元を壊さずに書けなければ、理由を知らせて記入用Excelにする（押したときの表・添付で書く）
 */
export async function downloadInquiry(env: CaseEnv) {
  const { config, store } = env
  const s = store.getState()
  const { output, currentSource } = env.table(s)
  const { attachment, placement, placementId, activeCells } = env.view(s)
  if (!output) return
  try {
    const [{ markedXlsx }, { inquiryXlsx }] = await loadInquiryXlsx()
    const type = contentTypeOf("x.xlsx")
    const save = (bytes: Uint8Array, name: string) => {
      saveFile(bytes, name, type)
      void keepFile(env, "inquiry_sheet", new Blob([bytes as BlobPart], { type }), name)
    }
    if (attachment.kind === "marked" && currentSource && placement && placementId) {
      const marks = await planMarks(currentSource.sheets, placement, { caseId: config.caseId, sourceFileId: currentSource.fileId, excelKey: config.excelKey })
      const out = await markedXlsx(currentSource, marks, config.excelKey, config.customerName)
      if (out.ok) return save(out.bytes, datedFileName("確認のお願い", config.customerName, new Date(), "xlsx"))
      // 同じ元・同じ場所では記入用Excelにする（保存する。メールの本文も合わせる）
      setWork(store, (w) => ({ ...w, markFailure: { fileId: currentSource.fileId, key: placementId, reason: out.reason } }))
      toast.warning(`${out.reason}、記入用Excelにしました（メールの本文も記入用Excelに合わせました）`)
    }
    save(await inquiryXlsx(inquirySheet(output, activeCells), config.customerName), datedFileName("記入のお願い", config.customerName, new Date(), "xlsx"))
  } catch (e) {
    toast.error(errorMessage(e, "問い合わせの Excel を作れませんでした"))
  }
}
