import ExcelJS from "exceljs"
import { OFFICE_NAME } from "../constants"
import { parseDate } from "../period"
import { WEEKLY_COLUMNS, WEEKLY_DATE_COLUMNS, isUpdated, type WeeklyRow } from "./weekly"

/**
 * SHARP への週次の案件表の Excel。「全件」と「今週の変更」（前回から足した・変わった行だけ）の2シート。
 * どちらのシートでも、足した行は薄い青、前回から変わったセルは黄色にする。ExcelJS はブラウザだけで読み込む
 */
const WIDTHS = [14, 14, 16, 16, 11, 11, 11, 30, 11, 16, 11, 16, 12, 11]
const ADDED = "FFDDEBF7"
const CHANGED = "FFFFF2CC"

const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } })

function addSheet(wb: ExcelJS.Workbook, name: string, rows: WeeklyRow[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 0, ySplit: 1 }] })
  WIDTHS.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })
  const header = ws.addRow([...WEEKLY_COLUMNS])
  header.height = 30
  header.eachCell((c) => {
    c.font = { bold: true }
    c.alignment = { wrapText: true, vertical: "middle" }
    c.fill = fill("FFF2F2F2")
    c.border = { bottom: { style: "thin" } }
  })
  for (const r of rows) {
    const row = ws.addRow(r.values.map((v, i) => (v !== null && WEEKLY_DATE_COLUMNS.has(i) ? parseDate(v) : v)))
    r.values.forEach((_, i) => {
      const cell = row.getCell(i + 1)
      if (WEEKLY_DATE_COLUMNS.has(i)) cell.numFmt = "yyyy/m/d"
      else cell.numFmt = "@"
      if (r.added) cell.fill = fill(ADDED)
      else if (r.changed[i]) cell.fill = fill(CHANGED)
    })
  }
}

export async function weeklyXlsx(rows: WeeklyRow[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.creator = OFFICE_NAME
  addSheet(wb, "全件", rows)
  addSheet(wb, "今週の変更", rows.filter(isUpdated))
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

/** ファイル名（出した日） */
export const weeklyFileName = (date: string) => `FIT案件表_${OFFICE_NAME}_${date}.xlsx`
