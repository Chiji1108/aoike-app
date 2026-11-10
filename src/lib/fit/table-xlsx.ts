import ExcelJS from "exceljs"
import { OFFICE_NAME } from "../constants"
import { parseDate } from "../period"

/**
 * 表を1枚の Excel にする（請求の明細・事件簿）。日付の列は日付のセル、円の列は桁区切り。ExcelJS はブラウザだけで読み込む
 */
export type TableColumn = { header: string; width: number; type?: "text" | "date" | "yen" }

export async function tableXlsx(sheetName: string, title: string, columns: readonly TableColumn[], rows: readonly (string | number | null)[][], footer?: (string | number | null)[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.creator = OFFICE_NAME
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", xSplit: 0, ySplit: 2 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } })
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width
  })
  ws.addRow([title]).getCell(1).font = { bold: true, size: 13 }
  const header = ws.addRow(columns.map((c) => c.header))
  header.eachCell((c) => {
    c.font = { bold: true }
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } }
    c.border = { bottom: { style: "thin" } }
  })
  const write = (values: readonly (string | number | null)[], bold = false) => {
    const row = ws.addRow(values.map((v, i) => (v !== null && columns[i]?.type === "date" && typeof v === "string" ? parseDate(v) : v)))
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      cell.numFmt = c.type === "date" ? "yyyy/m/d" : c.type === "yen" ? "#,##0" : "@"
      if (bold) cell.font = { bold: true }
    })
  }
  rows.forEach((r) => write(r))
  if (footer) write(footer, true)
  return new Uint8Array(await wb.xlsx.writeBuffer())
}
