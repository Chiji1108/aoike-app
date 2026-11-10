import { useMemo } from "react"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { FileSpreadsheet, Printer } from "lucide-react"
import { z } from "zod"
import { AppShell, FIT, PageHeader } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { FIT_NAME, OFFICE_NAME } from "@/lib/constants"
import { bookRows, bookYears } from "@/lib/fit/ledger"
import { formatDate, formatYen } from "@/lib/fit/procedure"
import { reiwaOf, todayIso } from "@/lib/period"
import { XLSX_TYPE, saveFile } from "@/lib/save-file"
import { listProceduresFn } from "@/server/fit-fns"

export const Route = createFileRoute("/_authed/fit/book")({
  validateSearch: z.object({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  }),
  loader: () => listProceduresFn(),
  head: () => ({ meta: [{ title: `事件簿 | ${FIT_NAME}` }] }),
  component: BookPage,
})

/** 2026 → 令和8年 */
const eraYear = (y: number) => `令和${reiwaOf(y)}年`

const HEADERS = ["事件簿番号", "受付日", "受任日", "事件の名称", "依頼者氏名", "依頼者住所", "報酬額（税込）", "結果"]

/** FIT 専用の事件簿（行政書士法第9条の帳簿）を年ごとに。Excel と印刷で出す */
function BookPage() {
  const { rows: sources } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const thisYear = Number(todayIso().slice(0, 4))
  const years = useMemo(() => bookYears(sources, thisYear), [sources, thisYear])
  const year = search.year ?? thisYear
  const rows = useMemo(() => bookRows(sources, year), [sources, year])
  const title = `事件簿（FIT 申請）${year}年（${eraYear(year)}）`

  async function exportExcel() {
    const { tableXlsx } = await import("@/lib/fit/table-xlsx")
    const bytes = await tableXlsx(
      `${year}年`,
      `${OFFICE_NAME} ${title}`,
      [
        { header: HEADERS[0]!, width: 12 },
        { header: HEADERS[1]!, width: 11, type: "date" },
        { header: HEADERS[2]!, width: 11, type: "date" },
        { header: HEADERS[3]!, width: 36 },
        { header: HEADERS[4]!, width: 18 },
        { header: HEADERS[5]!, width: 36 },
        { header: HEADERS[6]!, width: 13, type: "yen" },
        { header: HEADERS[7]!, width: 12 },
      ],
      rows.map((r) => [r.number, r.receivedOn, r.acceptedOn, r.title, r.name, r.address || null, r.fee, r.result]),
    )
    saveFile(bytes, `FIT事件簿_${year}.xlsx`, XLSX_TYPE)
  }

  return (
    <AppShell tool={FIT}>
      <div className="no-print">
        <PageHeader
          title="事件簿"
          description="FIT 申請の事件簿（帳簿）です。暦年（年末締め）で区切ります。手続は消さないので、すべての番号が並びます。"
          actions={
            <div className="flex gap-2">
              <Button variant="outline" size="lg" className="h-10 px-4" onClick={() => window.print()}>
                <Printer />
                印刷
              </Button>
              <Button size="lg" className="h-10 px-4" onClick={exportExcel} data-testid="book-export">
                <FileSpreadsheet />
                Excel に
              </Button>
            </div>
          }
        />
        <div className="mb-4 flex items-center gap-3">
          <NativeSelect
            aria-label="年"
            value={String(year)}
            onChange={(e) =>
              void navigate({
                search: { year: Number(e.target.value) },
                replace: true,
              })
            }
            className="w-44 [&_select]:h-9"
            data-testid="book-year"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}年（{eraYear(y)}）
              </option>
            ))}
          </NativeSelect>
          <span className="text-sm text-muted-foreground num">{rows.length}件</span>
        </div>
      </div>

      <div className="print-fit-book">
        <h1 className="mb-2 hidden text-base font-semibold print:block">
          {OFFICE_NAME} {title}
        </h1>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{year}年の手続はありません。</p>
        ) : (
          <div className="overflow-auto rounded-xl border bg-card print:overflow-visible print:rounded-none print:border-0">
            <table className="w-full text-sm print:text-[9pt]" data-testid="book-table">
              <thead className="bg-muted text-xs text-muted-foreground print:bg-transparent print:text-black">
                <tr>
                  {HEADERS.map((h) => (
                    <th key={h} className="border-b px-2 py-2 text-left font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t break-inside-avoid" data-testid="book-row">
                    <td className="px-2 py-1.5 num whitespace-nowrap">
                      <Link to="/fit/cases/$caseId" params={{ caseId: r.caseId }} className="text-brand hover:underline print:text-black print:no-underline">
                        {r.number}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 num whitespace-nowrap">{formatDate(r.receivedOn)}</td>
                    <td className="px-2 py-1.5 num whitespace-nowrap">{formatDate(r.acceptedOn)}</td>
                    <td className="px-2 py-1.5">{r.title}</td>
                    <td className="px-2 py-1.5">{r.name}</td>
                    <td className="px-2 py-1.5">{r.address}</td>
                    <td className="px-2 py-1.5 text-right num whitespace-nowrap">{formatYen(r.fee)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
