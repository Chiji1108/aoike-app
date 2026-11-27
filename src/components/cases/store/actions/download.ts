import { createClientOnlyFn } from "@tanstack/react-start"
import { toast } from "sonner"
import { contentTypeOf } from "@/lib/cases/types"
import { csvFileName, datedFileName, toCsvBytes } from "@/lib/convert/csv"
import { finalSheetRows } from "@/lib/excel/final-sheet"
import { errorMessage } from "@/lib/errors"
import { saveFile } from "@/lib/save-file"
import { KOJI_KEIREKI } from "@/lib/spec/koji-keireki"
import type { CaseEnv } from "../env"
import { keepFile } from "./files"

const SPEC = KOJI_KEIREKI

/** 最後の Excel を書く ExcelJS は、ダウンロードするときにブラウザで読み込む */
const loadFinalXlsx = createClientOnlyFn(() => import("@/lib/excel/final-xlsx"))

/** CSV（控え）をダウンロードする。CP932 の検査を通した値をそのまま書き、案件のファイルに残す */
export function downloadCsv(env: CaseEnv) {
  const { output, reconverting } = env.table(env.store.getState())
  // 変換し直している間は前の行なので書き出さない（控えにも残さない）
  if (!output || reconverting) return
  const bytes = toCsvBytes(SPEC, output)
  const name = csvFileName(SPEC, env.config.customerName, new Date())
  saveFile(bytes, name, "text/csv")
  // Excel で開いて保存すると文字コードが変わり、建設業.NET で文字化けする（都道府県も読めず選ぶ欄の先頭になる）
  toast.info("CSV は Excel で開いて保存しないでください（文字化けします）。そのまま建設業.NET に取り込んでください。", { duration: 10000 })
  void keepFile(env, "csv", new Blob([bytes as BlobPart], { type: "text/csv" }), name)
}

/** 最後の Excel をダウンロードする（lib/excel/final-sheet.ts。値は CSV と同じ）。案件のファイルに残す */
export async function downloadFinalExcel(env: CaseEnv) {
  const { config, store } = env
  const { output, reconverting } = env.table(store.getState())
  if (!output || reconverting) return
  try {
    const { finalXlsx } = await loadFinalXlsx()
    const bytes = await finalXlsx(finalSheetRows(output))
    const name = datedFileName(SPEC.fileNamePrefix, config.customerName, new Date(), "xlsx")
    saveFile(bytes, name, contentTypeOf(name))
    void keepFile(env, "final_sheet", new Blob([bytes as BlobPart], { type: contentTypeOf(name) }), name)
  } catch (e) {
    toast.error(errorMessage(e, "Excel を作れませんでした"))
  }
}
